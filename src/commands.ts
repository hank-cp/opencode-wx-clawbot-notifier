import type { WeChatClient } from "./wx/client.js"
import type { ResolvedOptions } from "./config.js"
import type { Logger } from "./logger.js"

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
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>
  }
}

export function registerCommands(
  host: CommandHost,
  client: WeChatClient,
  options: ResolvedOptions,
  logger: Logger,
): Promise<unknown> {
  return host.command.transform((editor) => {
    editor.add({
      name: "wx-login",
      description: "扫码登录微信 ClawBot，启用超时通知",
      execute: async ({ sessionID }) => {
        await host.session.synthetic({
          sessionID,
          text: "开始微信登录流程，请稍候…",
        })
        try {
          const result = await client.login((message) => {
            void host.session.synthetic({ sessionID, text: message })
          })
          if (result === "confirmed") {
            await host.session.synthetic({
              sessionID,
              text: `✅ 微信登录成功（bot 账号 ${client.accountId ?? ""}）。\n以后 question 等工具等待回答超时，会通过微信通知你。`,
            })
          } else {
            await host.session.synthetic({
              sessionID,
              text: "二维码已过期，请重新运行 /wx-login。",
            })
          }
        } catch (error) {
          logger.error(`登录流程失败：${error instanceof Error ? error.message : String(error)}`)
          await host.session.synthetic({
            sessionID,
            text: `❌ 登录失败：${error instanceof Error ? error.message : String(error)}`,
          })
        }
      },
    })

    editor.add({
      name: "wx-status",
      description: "查看微信通知插件的登录状态与收件人",
      execute: async ({ sessionID }) => {
        const lines: string[] = []
        lines.push(
          client.loggedIn
            ? `✅ 已登录：bot 账号 ${client.accountId ?? ""}`
            : "❌ 未登录（运行 /wx-login 扫码登录）",
        )
        const users = client.knownUsers()
        lines.push(
          users.length > 0
            ? `📮 收件人（给 bot 发过消息的用户）：\n  ${users.join("\n  ")}`
            : "📮 收件人：暂无 —— 请先用微信给 bot 发一条消息，插件才能反向通知你",
        )
        lines.push(`⏱ 超时阈值：${Math.round(options.timeoutMs / 60_000)} 分钟`)
        lines.push(`🎯 监听工具：${options.tools.join(", ")}`)
        await host.session.synthetic({ sessionID, text: lines.join("\n") })
      },
    })
  })
}
