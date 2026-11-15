import { describe, expect, test } from "bun:test"
import { formatDuration } from "../src/format.js"

describe("formatDuration", () => {
  test("小于 1 分钟按秒呈现（避免 30 秒被四舍五入成「1 分钟」）", () => {
    expect(formatDuration(30_000)).toBe("30 秒")
    expect(formatDuration(5_000)).toBe("5 秒")
    expect(formatDuration(1_000)).toBe("1 秒")
  })

  test("整分钟按分钟呈现", () => {
    expect(formatDuration(60_000)).toBe("1 分钟")
    expect(formatDuration(5 * 60_000)).toBe("5 分钟")
  })

  test("含余秒时按分 + 秒呈现", () => {
    expect(formatDuration(90_000)).toBe("1 分 30 秒")
    expect(formatDuration(125_000)).toBe("2 分 5 秒")
  })
})
