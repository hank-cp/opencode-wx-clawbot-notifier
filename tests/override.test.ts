import { describe, expect, test } from "bun:test"
import { createTimeoutOverride } from "../src/override.js"

describe("createTimeoutOverride", () => {
  test("returns the armed value on first consume", () => {
    const override = createTimeoutOverride(60_000)
    override.arm(10_000, 1_000)
    expect(override.consume(1_001)).toBe(10_000)
  })

  test("consuming clears the override (one-shot semantics)", () => {
    const override = createTimeoutOverride(60_000)
    override.arm(10_000, 1_000)
    override.consume(1_001)
    expect(override.consume(1_002)).toBeUndefined()
  })

  test("returns undefined when nothing is armed", () => {
    const override = createTimeoutOverride(60_000)
    expect(override.consume(5_000)).toBeUndefined()
  })

  test("expired override is ignored and cleared (TTL guard)", () => {
    const override = createTimeoutOverride(60_000)
    override.arm(10_000, 1_000)
    // 61 秒后：超过 TTL，视为未武装
    expect(override.consume(1_000 + 61_000)).toBeUndefined()
    // 并且已被清除
    expect(override.consume(1_000 + 61_001)).toBeUndefined()
  })

  test("re-arming replaces the previous override", () => {
    const override = createTimeoutOverride(60_000)
    override.arm(10_000, 1_000)
    override.arm(15_000, 2_000)
    expect(override.consume(2_001)).toBe(15_000)
  })
})
