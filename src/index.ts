import { Plugin } from "@opencode/plugin"
import { resolveOptions } from "./config.js"
import { createLogger } from "./logger.js"
import { WeChatClient } from "./wx/client.js"
import { registerQuestionWatcher } from "./watcher.js"
import { registerCommands } from "./commands.js"

export const WxClawbotNotifier = Plugin.define({
  id: "wx-clawbot-notifier",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    if (!options.enabled) return
    const logger = createLogger()

    const client = new WeChatClient({
      accountFile: options.accountFile,
      toUser: options.toUser,
      logger,
    })
    await client.start()

    await registerCommands(ctx, client, options, logger)

    const disposeWatcher = registerQuestionWatcher(ctx.tool, {
      timeoutMs: options.timeoutMs,
      tools: new Set(options.tools),
      logger,
      onTimeout: async (info) => {
        const title = await lookupSessionTitle(ctx, info.sessionID)
        const minutes = Math.max(1, Math.round(options.timeoutMs / 60_000))
        const text = [
          `⏰ OpenCode 等待人工响应已超时 ${minutes} 分钟`,
          title ? `会话：${title}` : "",
          `项目：${ctx.location.directory}`,
          ``,
          `问题：`,
          info.summary,
          ``,
          `请回到 OpenCode 终端继续回答。`,
        ]
          .filter(Boolean)
          .join("\n")
        try {
          await client.sendText(text)
        } catch (error) {
          logger.warn(`发送微信通知失败：${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })

    return () => {
      disposeWatcher()
      client.stop()
    }
  },
})

export default WxClawbotNotifier

interface SessionGateway {
  session: {
    get(input: { sessionID: string }): Promise<{ title?: string } | undefined>
  }
}

async function lookupSessionTitle(ctx: SessionGateway, sessionID: string): Promise<string | undefined> {
  try {
    const session = await ctx.session.get({ sessionID })
    return session?.title
  } catch {
    return undefined
  }
}
