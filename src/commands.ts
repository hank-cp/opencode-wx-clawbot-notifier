import type { LoginProgress, LoginResult } from "./wx/client.js"
import type { ResolvedOptions } from "./config.js"
import type { Logger } from "./logger.js"

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
  knownUsers(): string[]
  login(onProgress: (progress: LoginProgress) => void): Promise<LoginResult>
}

export function registerCommands(
  host: CommandHost,
  client: CommandClient,
  options: ResolvedOptions,
  logger: Logger,
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
          if (result === "confirmed") {
            notify(
              `✅ 微信登录成功（bot 账号 ${client.accountId ?? ""}），之后 question 等工具等待回答超时会通过微信通知你。`,
            )
          } else {
            notify("二维码已过期，请重新运行 /wx-login。")
          }
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
        const users = client.knownUsers()
        const parts = [
          client.loggedIn
            ? `✅ 已登录：bot 账号 ${client.accountId ?? ""}`
            : "❌ 未登录（运行 /wx-login 扫码登录）",
          users.length > 0
            ? `📮 收件人：${users.join("、")}`
            : "📮 收件人：暂无 —— 请先用微信给 bot 发一条消息，插件才能反向通知你",
          `⏱ 超时阈值：${Math.round(options.timeoutMs / 60_000)} 分钟`,
          `🎯 监听工具：${options.tools.join(", ")}`,
        ]
        const text = parts.join("  ·  ")
        await host.session.synthetic({ sessionID, text, description: text, resume: false })
      },
    })
  })
}
