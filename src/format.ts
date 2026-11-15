/**
 * 时长格式化：用于日志、状态与通知文案，避免把 30 秒误显示为「1 分钟」。
 *
 * - < 1 分钟：按秒呈现（3 秒 / 30 秒）
 * - 整分钟：按分钟呈现（5 分钟）
 * - 其余：分 + 秒（1 分 30 秒）
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
}
