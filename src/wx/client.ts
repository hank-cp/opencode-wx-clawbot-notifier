import { dirname } from "node:path"
import { writeFileSync } from "node:fs"
import {
  fetchQr,
  getUpdates,
  pollQr,
  sendText,
  StaleTokenError,
  TransportError,
} from "./transport.js"
import { loadAccount, saveAccount, type StoredAccount } from "./account.js"
import type { Logger } from "../logger.js"

export interface ClientOptions {
  accountFile: string
  toUser?: string
  logger: Logger
}

export type LoginResult = "confirmed" | "expired"

interface UserContext {
  contextToken: string
  updatedAt: number
}

/**
 * 微信通知客户端：
 * - 加载/保存扫码登录凭据
 * - 后台长轮询 getupdates，维护「用户 → context_token」缓存
 *   （微信 bot 只能给主动联系过它的用户发消息，且需要该会话的 context_token）
 * - 超时通知通过 sendText 发出
 */
export class WeChatClient {
  private account: StoredAccount | undefined
  private stopped = false
  private pollPromise: Promise<void> | undefined
  private readonly users = new Map<string, UserContext>()

  constructor(private readonly options: ClientOptions) {}

  get loggedIn(): boolean {
    return Boolean(this.account)
  }

  get accountId(): string | undefined {
    return this.account?.accountId
  }

  async start(): Promise<void> {
    this.account = loadAccount(this.options.accountFile)
    if (!this.account) {
      this.options.logger.warn(
        `未找到微信账号凭据 ${this.options.accountFile}，超时通知将无法发送。请运行 /wx-login 扫码登录。`,
      )
      return
    }
    this.options.logger.info(`已加载微信账号 ${this.account.accountId}，启动消息轮询。`)
    this.pollPromise = this.pollLoop()
  }

  private async pollLoop(): Promise<void> {
    let buffer = ""
    while (!this.stopped) {
      try {
        const result = await getUpdates(this.account!, buffer)
        buffer = result.buffer
        for (const msg of result.messages) {
          if (msg.message_type !== 1) continue
          if (typeof msg.from_user_id !== "string" || msg.from_user_id.length === 0) continue
          this.users.set(msg.from_user_id, {
            contextToken: typeof msg.context_token === "string" ? msg.context_token : "",
            updatedAt: Date.now(),
          })
        }
      } catch (error) {
        if (this.stopped) return
        if (error instanceof StaleTokenError) {
          this.options.logger.error(`微信 token 已过期：${error.message}，请运行 /wx-login 重新登录`)
          this.account = undefined
          return
        }
        this.options.logger.warn(
          `消息轮询失败：${error instanceof Error ? error.message : String(error)}`,
        )
        await delay(5_000)
      }
    }
  }

  /** 当前已知的收件人（给 bot 发过消息的用户） */
  knownUsers(): string[] {
    return [...this.users.keys()]
  }

  /** 发送文本通知；toUser 未配置时发给所有已知用户 */
  async sendText(text: string): Promise<void> {
    if (!this.account) {
      throw new TransportError("未登录微信（请先运行 /wx-login），通知无法发送")
    }
    const targets = this.options.toUser ? [this.options.toUser] : this.knownUsers()
    if (targets.length === 0) {
      throw new TransportError(
        "没有已知收件人：请先用微信给 bot 发一条消息，插件才能反向通知你",
      )
    }
    for (const target of targets) {
      const context = this.users.get(target)
      await sendText(this.account, target, text, context?.contextToken ?? "")
      this.options.logger.info(`已发送微信通知给 ${target}`)
    }
  }

  /**
   * 扫码登录流程：拉取二维码 → 保存为 PNG → 轮询扫码状态 → 保存凭据。
   * 由 /wx-login 命令调用。
   */
  async login(onProgress: (message: string) => void): Promise<LoginResult> {
    onProgress("正在获取登录二维码…")
    const ticket = await fetchQr()
    let qrPath: string | undefined
    if (ticket.imageBase64) {
      try {
        qrPath = `${this.options.accountFile}.qrcode.png`
        writeFileSync(qrPath, Buffer.from(ticket.imageBase64, "base64"))
      } catch (error) {
        this.options.logger.warn(
          `保存二维码图片失败：${error instanceof Error ? error.message : String(error)}`,
        )
        qrPath = undefined
      }
    }
    onProgress(qrPath ? `二维码已保存到 ${qrPath}，请用微信扫码。` : "请用微信扫码登录。")

    const deadline = Date.now() + 8 * 60_000
    while (Date.now() < deadline && !this.stopped) {
      const status = await pollQr(ticket.qrcode)
      switch (status.status) {
        case "confirmed": {
          if (!status.token || !status.baseUrl || !status.accountId) {
            throw new TransportError("登录响应缺少必要字段（token/baseurl/ilink_bot_id）")
          }
          this.account = {
            token: status.token,
            baseUrl: status.baseUrl,
            accountId: status.accountId,
            userId: status.userId,
            createdAt: new Date().toISOString(),
          }
          saveAccount(this.options.accountFile, this.account)
          onProgress("登录成功，正在启动消息轮询…")
          this.pollPromise = this.pollLoop()
          return "confirmed"
        }
        case "expired":
          return "expired"
        case "need_verifycode":
          onProgress("登录需要验证码，请按微信提示完成验证后继续等待…")
          break
        default:
          // wait / scaned / binded_redirect / scaned_but_redirect / verify_code_blocked
          break
      }
      await delay(2_000)
    }
    return "expired"
  }

  stop(): void {
    this.stopped = true
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
