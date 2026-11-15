import { Plugin } from "@opencode/plugin"
import { resolveOptions } from "./config.js"
import { createLogger, type Logger } from "./logger.js"
import { WeChatClient } from "./wx/client.js"
import { registerQuestionWatcher } from "./watcher.js"
import { registerCommands } from "./commands.js"
import { buildTimeoutText } from "./notify.js"
import { createTimeoutOverride } from "./override.js"

/** 测试超时覆盖的有效期：3 分钟内未触发测试则自动失效 */
const TEST_OVERRIDE_TTL_MS = 3 * 60_000

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

    // 连接测试期间的一次性超时覆盖：/wx-login 武装 10 秒，
    // watcher 在下一个监听的工具开始时消费并自动恢复默认；
    // 超过 TTL（3 分钟）未被消费则自动失效，避免污染后续真实 question。
    const testOverride = createTimeoutOverride(TEST_OVERRIDE_TTL_MS)

    await registerCommands(ctx, client, options, logger, (ms) => {
      testOverride.arm(ms)
    })

    const disposeWatcher = registerQuestionWatcher(ctx.tool, {
      timeoutMs: options.timeoutMs,
      tools: new Set(options.tools),
      logger,
      consumeOverride: () => testOverride.consume(),
      onTimeout: async (info) => {
        const title = await lookupSessionTitle(ctx, info.sessionID)
        const text = buildTimeoutText(info, title, ctx.location.directory)
        try {
          await client.sendText(text)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          logger.warn(`发送微信通知失败：${reason}`)
          // 通知失败曾只写进宿主控制台，用户完全看不到（例如 toUser 配了占位 id）。
          // 这里同步在会话里回一条可见提示，避免静默失败。
          await notifySession(ctx, info.sessionID, `❌ 微信通知发送失败：${reason}`, logger)
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

/** 会话内可见提示所需的最小宿主能力（与 commands.ts 的 CommandHost 同形） */
interface SessionNoticeHost {
  session: {
    synthetic(input: {
      sessionID: string
      text: string
      description?: string
      resume?: boolean
    }): Promise<unknown>
  }
}

async function notifySession(
  ctx: SessionNoticeHost,
  sessionID: string,
  text: string,
  logger: Logger,
): Promise<void> {
  try {
    await ctx.session.synthetic({ sessionID, text, description: text, resume: false })
  } catch (error) {
    logger.warn(`会话内提示发送失败：${error instanceof Error ? error.message : String(error)}`)
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
