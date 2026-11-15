import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { WeChatClient } from "../src/wx/client.js"
import { silentLogger, type Logger } from "../src/logger.js"
import type { StoredAccount } from "../src/wx/account.js"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let originalFetch: typeof fetch
let lastCall: { url: string; headers: Record<string, string>; body: string } | undefined

function installFetchMock(response: unknown): void {
  installFetchRoutes(() => response)
}

/** 按 URL 路由响应，用于登录流程（二维码 → 轮询 → 长轮询）多步 fetch */
function installFetchRoutes(routes: (url: string, init?: RequestInit) => unknown): void {
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value
    }
    lastCall = { url: String(url), headers, body: String(init?.body ?? "") }
    return new Response(JSON.stringify(routes(String(url), init)), { status: 200 })
  }) as typeof fetch
}

const LOGIN_URL = "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=ticket123&b=1"

function installLoginRoutes(): void {
  installFetchRoutes((url) => {
    if (url.includes("get_bot_qrcode")) {
      return { ret: 0, qrcode: "ticket123", qrcode_img_content: LOGIN_URL }
    }
    if (url.includes("get_qrcode_status")) {
      return {
        status: "confirmed",
        bot_token: "tok",
        baseurl: "https://example.com",
        ilink_bot_id: "bot_1",
      }
    }
    if (url.includes("getupdates")) {
      return { errcode: 0, msgs: [] }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

const account: StoredAccount = {
  token: "tok",
  baseUrl: "https://example.com",
  accountId: "bot_1",
  createdAt: "2026-01-01T00:00:00Z",
}

function makeClient(file: string, toUser?: string, logger: Logger = silentLogger): WeChatClient {
  const client = new WeChatClient({ accountFile: file, toUser, logger })
  return client
}

describe("WeChatClient", () => {
  let dir: string
  let accountFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wx-clawbot-client-test-"))
    accountFile = join(dir, "account.json")
    lastCall = undefined
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(dir, { recursive: true, force: true })
  })

  test("sendText throws when not logged in", async () => {
    const client = makeClient(accountFile)
    await client.start() // no account file → not logged in
    await expect(client.sendText("hi")).rejects.toThrow("未登录微信")
  })

  test("sendText uses configured toUser even without cached users", async () => {
    installFetchMock({ ret: 0, message_id: "m1" })
    writeFileSync(accountFile, JSON.stringify(account))
    const client = makeClient(accountFile, "owner@im.wechat")
    await client.start()
    client.stop() // stop polling; we only need sendText
    await client.sendText("通知")
    expect(lastCall?.url).toContain("/ilink/bot/sendmessage")
    const payload = JSON.parse(lastCall!.body)
    expect(payload.msg.to_user_id).toBe("owner@im.wechat")
  })

  test("sendText throws when logged in but no known users", async () => {
    installFetchMock({ ret: 0 })
    writeFileSync(accountFile, JSON.stringify(account))
    const client = makeClient(accountFile)
    await client.start()
    client.stop()
    await expect(client.sendText("hi")).rejects.toThrow("没有已知收件人")
  })
})

describe("WeChatClient login", () => {
  let dir: string
  let accountFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wx-clawbot-login-test-"))
    accountFile = join(dir, "account.json")
    lastCall = undefined
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  async function runLogin(client: WeChatClient): Promise<{ kind: string; text: string }[]> {
    const progress: { kind: string; text: string }[] = []
    await client.login((update) => progress.push(update))
    client.stop() // 停止登录成功后台动起的消息轮询
    return progress
  }

  // T1：登录成功全流程
  test("login renders QR, saves PNG and credentials, then confirms", async () => {
    installLoginRoutes()
    const client = makeClient(accountFile)
    const progress = await runLogin(client)

    expect(progress[0]).toEqual({ kind: "notice", text: "正在获取登录二维码…" })
    const qr = progress.find((m) => m.text.startsWith("请用微信扫描下方二维码登录"))!
    expect(qr.kind).toBe("qr")
    expect(qr.text).toContain(LOGIN_URL)
    expect(qr.text).toContain(`${accountFile}.qrcode.png`)
    expect(qr.text).toContain("█") // 终端二维码块字符
    const success = progress.find((m) => m.text.includes("登录成功"))!
    expect(success.kind).toBe("notice")

    const saved = JSON.parse(readFileSync(accountFile, "utf-8"))
    expect(saved.token).toBe("tok")
    expect(saved.baseUrl).toBe("https://example.com")
    expect(saved.accountId).toBe("bot_1")
  })

  // T2：缺陷 A 回归——父目录不存在时二维码仍能落盘
  test("login saves QR png even when accountFile parent dirs are missing", async () => {
    installLoginRoutes()
    const nestedFile = join(dir, "nested", "sub", "account.json")
    const client = makeClient(nestedFile)
    const progress = await runLogin(client)

    const pngPath = `${nestedFile}.qrcode.png`
    expect(existsSync(pngPath)).toBe(true)
    expect([...readFileSync(pngPath).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(progress.some((m) => m.text.includes("也可打开图片扫码"))).toBe(true)
  })

  // T3：缺陷 B 回归——URL 内容生成的是合法 PNG，而非 base64 解码垃圾
  test("login writes a valid PNG generated from the liteapp URL", async () => {
    installLoginRoutes()
    const client = makeClient(accountFile)
    await runLogin(client)

    const png = readFileSync(`${accountFile}.qrcode.png`)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(png.length).toBeGreaterThan(500) // 排除 30 字节垃圾文件
  })

  // T4：边界——网关未返回 URL 时不生成图片、提示重试、流程不中断
  test("login continues without QR when gateway returns no qrcode_img_content", async () => {
    installFetchRoutes((url) => {
      if (url.includes("get_bot_qrcode")) return { ret: 0, qrcode: "ticket123" }
      if (url.includes("get_qrcode_status")) {
        return {
          status: "confirmed",
          bot_token: "tok",
          baseurl: "https://example.com",
          ilink_bot_id: "bot_1",
        }
      }
      if (url.includes("getupdates")) return { errcode: 0, msgs: [] }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const client = makeClient(accountFile)
    const progress = await runLogin(client)

    expect(progress.some((m) => m.text.includes("网关未返回二维码链接"))).toBe(true)
    expect(existsSync(`${accountFile}.qrcode.png`)).toBe(false)
    expect(JSON.parse(readFileSync(accountFile, "utf-8")).token).toBe("tok") // 流程未被阻断
  })

  // T5：边界——二维码生成失败时 warn + URL 兜底，登录不中断
  test("login survives QR generation failure with URL fallback", async () => {
    const brokenQr = {
      toBuffer: () => Promise.reject(new Error("qrcode render unavailable")),
      toString: () => Promise.reject(new Error("qrcode render unavailable")),
    }
    mock.module("qrcode", () => ({ ...brokenQr, default: brokenQr }))
    installLoginRoutes()
    const warnings: string[] = []
    const logger: Logger = { debug: () => {}, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
    const client = makeClient(accountFile, undefined, logger)
    const progress = await runLogin(client)

    expect(warnings.length).toBeGreaterThan(0)
    const qr = progress.find((m) => m.text.includes("二维码链接"))!
    expect(qr.kind).toBe("qr")
    expect(qr.text).toContain(LOGIN_URL) // URL 兜底
    expect(JSON.parse(readFileSync(accountFile, "utf-8")).token).toBe("tok") // 登录未被阻断
  })

  // T6：边界——网关缺 qrcode 字段时显式报错，不拼出 qrcode=undefined 的轮询 URL
  test("login rejects when gateway response lacks qrcode field", async () => {
    installFetchMock({ ret: 0, qrcode_img_content: LOGIN_URL })
    const client = makeClient(accountFile)
    await expect(client.login(() => {})).rejects.toThrow("缺少 qrcode 字段")
    expect(lastCall?.url).toContain("get_bot_qrcode") // 报错前未发起轮询
  })
})
