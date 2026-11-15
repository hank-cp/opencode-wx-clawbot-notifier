import type { LoginProgress, LoginResult } from "./wx/client.js"
import type { ResolvedOptions } from "./config.js"
import type { Logger } from "./logger.js"
import { formatDuration } from "./format.js"

/**
 * 命令所需的宿主能力：
 * - session.synthetic：一行通知（OpenCode TUI 只渲染带 description 的 synthetic 消息）
 * - session.prompt：完整多行内容（如二维码字符画）以用户消息呈现
 */
export interface CommandHost {
  command: {
    transform(
      callback: (editor: {
        add(definition: {
          name: string
          description?: string
          execute(invocation: { sessionID: string }): Promise<void>
        }): void
      }) => void,
    ): Promise<unknown>
  }
  session: {
    synthetic(input: {
      sessionID: string
      text: string
      description?: string
      resume?: boolean
    }): Promise<unknown>
    prompt(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
  }
}

/** 命令依赖的微信客户端能力（WeChatClient 结构满足；测试可注入假实现） */
export interface CommandClient {
  readonly accountId?: string
  readonly loggedIn: boolean
  /** 通知实际发送的收件人（含固定 toUser 配置） */
  recipients(): string[]
  /** 给 bot 发过消息的用户（用于判断固定收件人是否活跃） */
  knownUsers(): string[]
  login(onProgress: (progress: LoginProgress) => void): Promise<LoginResult>
  /** 等待用户激活（给 bot 发消息）：已有已知用户立即返回，否则等新消息；超时 undefined */
  waitForActivation(timeoutMs: number): Promise<string | undefined>
  /** 发送文本通知；to 指定时只发给该用户（如刚激活的用户本人） */
  sendText(text: string, to?: string): Promise<void>
}

export function registerCommands(
  host: CommandHost,
  client: CommandClient,
  options: ResolvedOptions,
  logger: Logger,
  armTestTimeout: (ms: number) => void,
): Promise<unknown> {
  return host.command.transform((editor) => {
    editor.add({
      name: "wx-login",
      description: "扫码登录微信 ClawBot，启用超时通知",
      execute: async ({ sessionID }) => {
        // 一行通知：OpenCode TUI 只显示带 description 的 synthetic 消息，
        // 且 resume:false 避免每条通知都唤醒 agent 循环。
        const notify = (text: string): void => {
          void host.session
            .synthetic({ sessionID, text, description: text, resume: false })
            .catch((error) => {
              logger.warn(`登录通知发送失败：${error instanceof Error ? error.message : String(error)}`)
            })
        }
        // 完整多行内容（二维码字符画）以用户消息呈现，TUI 才会完整渲染；
        // 强制 steer，避免会话忙时命令排队导致二维码不可见。
        const present = (text: string): void => {
          void host.session
            .prompt({ sessionID, text, delivery: "steer" })
            .catch((error) => {
              logger.warn(`登录二维码呈现失败：${error instanceof Error ? error.message : String(error)}`)
            })
        }
        try {
          const result = await client.login(({ kind, text }) => {
            if (kind === "qr") present(text)
            else notify(text)
          })
          if (result !== "confirmed") {
            notify("二维码已过期，请重新运行 /wx-login。")
            return
          }
          // 登录成功：引导用户给 ClawBot 发一条消息，bot 才能反向联系用户
          notify("✅ 扫码成功！请在微信里给 ClawBot 发一条消息，这样我才能找到你～")
          const activatedUser = await client.waitForActivation(ACTIVATION_TIMEOUT_MS)
          if (activatedUser === undefined) {
            notify("⏳ 还没收到你的消息… 稍后在微信里给 ClawBot 发条消息，再运行 /wx-status 就能看到连接状态啦")
            return
          }
          // 自动展示连接状态（与 /wx-status 一致的文案）
          notify(buildStatusText(client, options))
          // ClawBot 主动发微信消息，通知用户已连接成功
          try {
            await client.sendText(CONNECTED_TEXT, activatedUser)
            notify("🎉 连接成功！ClawBot 已经给你发了一条微信消息，去看看吧～")
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            logger.warn(`连接成功通知发送失败：${reason}`)
            notify(`⚠️ 连接状态已保存，但微信消息没能发出去。稍后运行 /wx-status 可以检查收件人是否正确`)
          }
          // 注入测试引导：让 AI 调用 question 问用户，用户不回答则触发超时微信通知，
          // 临时把超时阈值降到 10 秒（一次性，用后自动恢复默认）
          armTestTimeout(TEST_TIMEOUT_MS)
          present(TEST_GUIDE_TEXT)
        } catch (error) {
          logger.error(`登录流程失败：${error instanceof Error ? error.message : String(error)}`)
          notify(`❌ 登录失败：${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })

    editor.add({
      name: "wx-status",
      description: "查看微信通知插件的登录状态与收件人",
      execute: async ({ sessionID }) => {
        // 通知为单行文本：OpenCode TUI 对 synthetic 只渲染一行 Notice，
        // 单行内容保证各信息项完整可见。
        const text = buildStatusText(client, options)
        await host.session.synthetic({ sessionID, text, description: text, resume: false })
      },
    })
  })
}

/** 等待用户发激活消息的最长时间（扫码后 3 分钟） */
const ACTIVATION_TIMEOUT_MS = 3 * 60_000
/** 连接测试期间 question 的一次性超时阈值（10 秒，非默认 5 分钟） */
const TEST_TIMEOUT_MS = 10_000

/** ClawBot 发给用户的「已连接成功」微信消息（友好文案） */
const CONNECTED_TEXT = "👋 你好呀！ClawBot 已经和 OpenCode 连上啦。以后 AI 有问题等你回答时，我会在这里提醒你～"

/** 注入会话、引导 AI 调用 question 做超时通知测试的消息（用户视角友好文案） */
const TEST_GUIDE_TEXT = [
  "🎉 微信通知已经接通啦！现在请你调用 question 工具，问用户一个问题（例如：『你收到微信提醒了吗？』）。",
  "如果用户没有回答，10 秒后他的微信会收到一条提醒消息——正好测试一下通知功能～",
].join("\n")

/** 连接状态单行文案（/wx-status 与 /wx-login 激活成功后共用） */
export function buildStatusText(client: CommandClient, options: ResolvedOptions): string {
  const recipients = client.recipients()
  const unknownRecipient = recipients.filter((user) => !client.knownUsers().includes(user))
  const statusParts = [
    client.loggedIn
      ? `✅ 已登录：bot 账号 ${client.accountId ?? ""}`
      : "❌ 未登录（运行 /wx-login 扫码登录）",
    recipients.length > 0
      ? `📮 收件人：${recipients.join("、")}${
          unknownRecipient.length > 0
            ? "（toUser 固定收件人；若收不到通知，请核对该 id 或改用默认的已知用户）"
            : ""
        }`
      : "📮 收件人：暂无 —— 请先用微信给 bot 发一条消息，插件才能反向通知你",
    `⏱ 超时阈值：${formatDuration(options.timeoutMs)}`,
    `🎯 监听工具：${options.tools.join(", ")}`,
  ]
  return statusParts.join("  ·  ")
}
