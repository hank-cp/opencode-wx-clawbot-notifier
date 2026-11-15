import { homedir } from "node:os"
import { join } from "node:path"

export interface ResolvedOptions {
  /** 插件是否启用 */
  enabled: boolean
  /** 超时毫秒数，超时未响应则发通知 */
  timeoutMs: number
  /** 监听的工具名列表（V2 内置问题工具为 "question"） */
  tools: string[]
  /** 微信账号凭据文件路径 */
  accountFile: string
  /** 固定收件人（WeChat user id），不配置则发给所有给 bot 发过消息的用户 */
  toUser?: string
}

export const DEFAULTS = {
  enabled: true,
  timeoutMs: 5 * 60_000,
  tools: ["question"],
  accountFile: "~/.opencode/wx-clawbot/account.json",
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

export function resolveOptions(raw: unknown): ResolvedOptions {
  const input = isRecord(raw) ? raw : {}
  const enabled = typeof input.enabled === "boolean" ? input.enabled : DEFAULTS.enabled
  const timeoutMs =
    typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULTS.timeoutMs
  const tools =
    Array.isArray(input.tools) &&
    input.tools.length > 0 &&
    input.tools.every((t) => typeof t === "string" && t.length > 0)
      ? input.tools
      : DEFAULTS.tools
  const accountFile =
    typeof input.accountFile === "string" && input.accountFile.length > 0
      ? expandHome(input.accountFile)
      : expandHome(DEFAULTS.accountFile)
  const toUser = typeof input.toUser === "string" && input.toUser.length > 0 ? input.toUser : undefined

  return { enabled, timeoutMs, tools: [...tools], accountFile, toUser }
}
