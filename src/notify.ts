import { formatDuration } from "./format.js"
import type { QuestionInfo } from "./watcher.js"

/**
 * 超时通知文案（微信消息正文）。
 * 抽成纯函数以便对「10 秒测试覆盖」等场景断言实际阈值文案。
 */
export function buildTimeoutText(
  info: QuestionInfo,
  title: string | undefined,
  directory: string,
): string {
  return [
    `⏰ OpenCode 等待人工响应已超时 ${formatDuration(info.timeoutMs)}`,
    title ? `会话：${title}` : "",
    `项目：${directory}`,
    ``,
    `问题：`,
    info.summary,
    ``,
    `请回到 OpenCode 终端继续回答。`,
  ]
    .filter(Boolean)
    .join("\n")
}
