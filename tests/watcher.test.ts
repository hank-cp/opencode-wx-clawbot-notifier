import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import { registerQuestionWatcher, summarizeInput, type ToolHookEvent, type ToolHookHost } from "../src/watcher.js"
import { silentLogger } from "../src/logger.js"

class FakeToolHooks implements ToolHookHost {
  readonly handlers = new Map<string, Array<(event: ToolHookEvent) => void>>()

  async hook(
    name: "execute.before" | "execute.after",
    callback: (event: ToolHookEvent) => void,
  ): Promise<unknown> {
    const list = this.handlers.get(name) ?? []
    list.push(callback)
    this.handlers.set(name, list)
    return { dispose: async () => {} }
  }

  fire(name: "execute.before" | "execute.after", event: ToolHookEvent): void {
    for (const handler of this.handlers.get(name) ?? []) handler(event)
  }
}

function makeEvent(overrides: Partial<ToolHookEvent> = {}): ToolHookEvent {
  return {
    tool: "question",
    sessionID: "ses_test",
    messageID: "msg_test",
    id: "call_1",
    input: {
      questions: [{ header: "方向", question: "选哪个方案？", options: [{ label: "A" }, { label: "B" }] }],
    },
    ...overrides,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("summarizeInput", () => {
  test("extracts question tool content", () => {
    const summary = summarizeInput("question", {
      questions: [
        { header: "方向", question: "选哪个方案？", options: [{ label: "A" }, { label: "B" }] },
        { question: "再确认一下？", options: [] },
      ],
    })
    expect(summary).toContain("[方向] 选哪个方案？")
    expect(summary).toContain("选项: A / B")
    expect(summary).toContain("再确认一下？")
  })

  test("falls back to JSON for other tools", () => {
    expect(summarizeInput("custom_confirm", { a: 1 })).toBe('{"a":1}')
  })
})

describe("registerQuestionWatcher", () => {
  let host: FakeToolHooks
  let timeouts: Array<{ sessionID: string; tool: string; summary: string }>
  let disposers: Array<() => void>

  beforeEach(() => {
    host = new FakeToolHooks()
    timeouts = []
    disposers = []
  })

  afterEach(() => {
    for (const dispose of disposers) dispose()
  })

  test("fires onTimeout when no answer arrives before timeout", async () => {
    disposers.push(
      registerQuestionWatcher(host, {
        timeoutMs: 30,
        tools: new Set(["question"]),
        onTimeout: (info) => timeouts.push(info),
        logger: silentLogger,
      }),
    )
    host.fire("execute.before", makeEvent())
    expect(timeouts).toHaveLength(0)
    await sleep(80)
    expect(timeouts).toHaveLength(1)
    expect(timeouts[0]).toMatchObject({ sessionID: "ses_test", tool: "question" })
    expect(timeouts[0].summary).toContain("选哪个方案？")
  })

  test("cancels the timer when the user answers in time", async () => {
    disposers.push(
      registerQuestionWatcher(host, {
        timeoutMs: 30,
        tools: new Set(["question"]),
        onTimeout: (info) => timeouts.push(info),
        logger: silentLogger,
      }),
    )
    host.fire("execute.before", makeEvent())
    await sleep(10)
    host.fire("execute.after", { ...makeEvent(), status: "completed" })
    await sleep(60)
    expect(timeouts).toHaveLength(0)
  })

  test("ignores tools outside the watched set", async () => {
    disposers.push(
      registerQuestionWatcher(host, {
        timeoutMs: 30,
        tools: new Set(["question"]),
        onTimeout: (info) => timeouts.push(info),
        logger: silentLogger,
      }),
    )
    host.fire("execute.before", makeEvent({ tool: "read" }))
    await sleep(60)
    expect(timeouts).toHaveLength(0)
  })

  test("dispose clears pending timers", async () => {
    const dispose = registerQuestionWatcher(host, {
      timeoutMs: 30,
      tools: new Set(["question"]),
      onTimeout: (info) => timeouts.push(info),
      logger: silentLogger,
    })
    host.fire("execute.before", makeEvent())
    dispose()
    await sleep(60)
    expect(timeouts).toHaveLength(0)
  })

  test("tracks concurrent questions in different sessions independently", async () => {
    disposers.push(
      registerQuestionWatcher(host, {
        timeoutMs: 30,
        tools: new Set(["question"]),
        onTimeout: (info) => timeouts.push(info),
        logger: silentLogger,
      }),
    )
    host.fire("execute.before", makeEvent({ sessionID: "ses_a", id: "call_a" }))
    host.fire("execute.before", makeEvent({ sessionID: "ses_b", id: "call_b" }))
    host.fire("execute.after", makeEvent({ sessionID: "ses_a", id: "call_a", status: "completed" }))
    await sleep(80)
    expect(timeouts.map((t) => t.sessionID)).toEqual(["ses_b"])
  })
})
