/**
 * 一次性超时覆盖（连接测试的 10 秒阈值）。
 *
 * - `arm`：武装一次覆盖（如 /wx-login 注入测试引导前）
 * - `consume`：读并清除覆盖；超过有效期（TTL）视为未武装
 *
 * 消费即失效 + TTL 双重保障，避免测试引导未被 AI 执行时
 * 覆盖一直挂着，把数小时后的真实 question 误判为 10 秒超时。
 */
export interface TimeoutOverride {
  arm(ms: number, now?: number): void
  consume(now?: number): number | undefined
}

export function createTimeoutOverride(ttlMs: number): TimeoutOverride {
  let armed: { ms: number; at: number } | undefined

  return {
    arm(ms: number, now: number = Date.now()): void {
      armed = { ms, at: now }
    },
    consume(now: number = Date.now()): number | undefined {
      const current = armed
      armed = undefined
      if (current === undefined) return undefined
      if (now - current.at > ttlMs) return undefined
      return current.ms
    },
  }
}
