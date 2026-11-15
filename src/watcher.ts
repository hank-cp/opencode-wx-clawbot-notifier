import type { Logger } from "./logger.js"

/**
 * question 等人工介入工具的「超时未响应」监听器。
 *
 * 机制：
 * - tool.execute.before：监听的工具开始执行（即开始等待用户回答）→ 起一个计时器
 * - tool.execute.after：用户已回答 / 问题被取消 → 取消计时器
 * - 计时器触发：用户超时未响应 → 调用 onTimeout 发通知
 */

export interface ToolHookEvent {
  readonly tool: string
  readonly sessionID: string
  readonly messageID: string
  readonly id: string
  readonly input?: unknown
  readonly status?: "completed" | "error"
}

export interface ToolHookHost {
  hook(
    name: "execute.before" | "execute.after",
    callback: (event: ToolHookEvent) => void | Promise<void>,
  ): Promise<unknown>
}

export interface QuestionInfo {
  sessionID: string
  tool: string
  /** 人类可读的问题摘要（包含选项） */
  summary: string
}

export interface WatcherOptions {
  timeoutMs: number
  tools: ReadonlySet<string>
  onTimeout: (info: QuestionInfo) => void | Promise<void>
  logger?: Logger
}

export function registerQuestionWatcher(host: ToolHookHost, options: WatcherOptions): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false

  void host.hook("execute.before", (event) => {
    if (disposed || !options.tools.has(event.tool)) return
    const key = `${event.sessionID}:${event.id}`
    if (pending.has(key)) return
    const summary = summarizeInput(event.tool, event.input)
    const timer = setTimeout(() => {
      pending.delete(key)
      void Promise.resolve(
        options.onTimeout({ sessionID: event.sessionID, tool: event.tool, summary }),
      ).catch((error) => {
        options.logger?.error(
          `超时通知发送失败：${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }, options.timeoutMs)
    pending.set(key, timer)
  })

  void host.hook("execute.after", (event) => {
    const key = `${event.sessionID}:${event.id}`
    const timer = pending.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    pending.delete(key)
  })

  return () => {
    disposed = true
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}

export function summarizeInput(tool: string, input: unknown): string {
  if (tool === "question" && isRecord(input) && Array.isArray(input.questions)) {
    const lines = input.questions.map((item) => {
      if (!isRecord(item)) return String(item)
      const header = typeof item.header === "string" ? item.header : undefined
      const question = typeof item.question === "string" ? item.question : JSON.stringify(item)
      const options = Array.isArray(item.options)
        ? item.options
            .filter(isRecord)
            .map((option) => (typeof option.label === "string" ? option.label : ""))
            .filter(Boolean)
        : []
      const suffix = options.length > 0 ? `\n  选项: ${options.join(" / ")}` : ""
      return `${header ? `[${header}] ` : ""}${question}${suffix}`
    })
    return lines.join("\n")
  }
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
