import { randomBytes } from "node:crypto"

/**
 * 微信 iLink Bot 网关最小协议层（仅发送通知所需的子集）。
 *
 * 协议依据：
 * - clawbot 微信插件 → 腾讯 iLink Bot 网关（ilinkai.weixin.qq.com）
 * - 参考 Ikaros12643/opencode-wechat-plugin 的 src/client.ts，
 *   并按官方 2.4.10 报文修正（注意：绝不能手动设置 Content-Length，
 *   Node 24 的 undici 会直接报 UND_ERR_INVALID_ARG）。
 */

const BASE = "https://ilinkai.weixin.qq.com"
const BOT_TYPE = "3"
export const LONG_POLL_MS = 35_000
// APP_VERSION = (2 << 16) | (4 << 8) | 10 = 132106
const APP_VERSION = ((2 & 0xff) << 16) | ((4 & 0xff) << 8) | 10

export interface Account {
  token: string
  baseUrl: string
  accountId: string
  userId?: string
}

export interface QrTicket {
  qrcode: string
  imageBase64?: string
}

export type QrStatus =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect"
  | "scaned_but_redirect"

export interface QrStatusResult {
  status: QrStatus
  token?: string
  baseUrl?: string
  accountId?: string
  userId?: string
  redirectHost?: string
}

export class TransportError extends Error {}
/** token 过期（errcode -14），需要重新扫码登录 */
export class StaleTokenError extends TransportError {}

export function randomWechatUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64")
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(APP_VERSION),
  }
  if (token && token.trim().length > 0) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

async function post<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  token?: string,
  timeoutMs = 15_000,
): Promise<T> {
  const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) throw new TransportError(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new TransportError(`Invalid JSON response: ${text.slice(0, 200)}`)
  }
}

// ── 扫码登录 ─────────────────────────────────────────────────────────

export async function fetchQr(): Promise<QrTicket> {
  const r = await post<{ qrcode: string; qrcode_img_content?: string }>(
    BASE,
    `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
    { local_token_list: [] },
    undefined,
    10_000,
  )
  return { qrcode: r.qrcode, imageBase64: r.qrcode_img_content }
}

export async function pollQr(qrcode: string, timeoutMs = LONG_POLL_MS): Promise<QrStatusResult> {
  const q = `qrcode=${encodeURIComponent(qrcode)}`
  const res = await fetch(new URL(`ilink/bot/get_qrcode_status?${q}`, `${BASE}/`), {
    headers: { "iLink-App-ClientVersion": "1" },
    signal: AbortSignal.timeout(timeoutMs),
  })
  // 网关超时（524 等）按 wait 处理
  if (!res.ok) return { status: "wait" }
  const data = (await res.json()) as Record<string, unknown>
  return {
    status: (data.status as QrStatus) ?? "wait",
    token: typeof data.bot_token === "string" ? data.bot_token : undefined,
    baseUrl: typeof data.baseurl === "string" ? data.baseurl : undefined,
    accountId: typeof data.ilink_bot_id === "string" ? data.ilink_bot_id : undefined,
    userId: typeof data.ilink_user_id === "string" ? data.ilink_user_id : undefined,
    redirectHost: typeof data.redirect_host === "string" ? data.redirect_host : undefined,
  }
}

// ── 收消息（长轮询，维护会话 context_token）──────────────────────────

export interface Inbound {
  from_user_id?: string
  context_token?: string
  message_type?: number
}

export interface UpdatesResult {
  messages: Inbound[]
  buffer: string
}

export async function getUpdates(account: Account, buffer: string): Promise<UpdatesResult> {
  try {
    const r = await post<{
      errcode?: number
      errmsg?: string
      msgs?: Inbound[]
      get_updates_buf?: string
    }>(
      account.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: buffer, base_info: { channel_version: "2.4.10" } },
      account.token,
      LONG_POLL_MS + 5_000,
    )
    if (r.errcode === -14) throw new StaleTokenError("bot token expired (errcode -14)")
    return {
      messages: Array.isArray(r.msgs) ? r.msgs : [],
      buffer: typeof r.get_updates_buf === "string" ? r.get_updates_buf : buffer,
    }
  } catch (error) {
    if (error instanceof StaleTokenError) throw error
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { messages: [], buffer }
    }
    throw error
  }
}

// ── 发文本 ───────────────────────────────────────────────────────────

export async function sendText(
  account: Account,
  to: string,
  text: string,
  contextToken: string,
): Promise<string | undefined> {
  const r = await post<{ ret?: number; errcode?: number; errmsg?: string; message_id?: string }>(
    account.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: `opencode-wx-clawbot-notifier:${Date.now()}-${randomBytes(4).toString("hex")}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: { channel_version: "2.4.10", bot_agent: "OpenCode/2.0" },
    },
    account.token,
  )
  if (r.errcode === -14) throw new StaleTokenError("bot token expired (errcode -14)")
  if (typeof r.ret === "number" && r.ret !== 0) {
    throw new TransportError(`sendmessage ret=${r.ret} ${r.errmsg ?? ""}`)
  }
  return r.message_id
}
