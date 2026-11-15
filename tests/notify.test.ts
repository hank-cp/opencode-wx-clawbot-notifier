import { describe, expect, test } from "bun:test"
import { buildTimeoutText } from "../src/notify.js"

describe("buildTimeoutText", () => {
  const info = {
    sessionID: "ses_test",
    tool: "question",
    summary: "[方向] 选哪个方案？\n  选项: A / B",
    timeoutMs: 10_000,
  }

  test("uses the actual effective timeout (10s test override, not the default)", () => {
    const text = buildTimeoutText(info, "会话标题", "/proj")
    expect(text).toContain("已超时 10 秒")
    expect(text).not.toContain("5 分钟")
  })

  test("renders default timeout when no override was consumed", () => {
    const text = buildTimeoutText({ ...info, timeoutMs: 5 * 60_000 }, undefined, "/proj")
    expect(text).toContain("已超时 5 分钟")
  })

  test("includes session title, project, question summary and guidance", () => {
    const text = buildTimeoutText(info, "会话标题", "/proj")
    expect(text).toContain("会话：会话标题")
    expect(text).toContain("项目：/proj")
    expect(text).toContain("选哪个方案？")
    expect(text).toContain("请回到 OpenCode 终端继续回答。")
  })
})
