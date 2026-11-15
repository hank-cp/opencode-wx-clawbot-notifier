import { describe, expect, test } from "bun:test"
import { DEFAULTS, expandHome, resolveOptions } from "../src/config.js"

describe("expandHome", () => {
  test("expands leading ~", () => {
    const result = expandHome("~/.opencode/wx-clawbot/account.json")
    expect(result.startsWith("/")).toBe(true)
    expect(result).not.toContain("~")
    expect(result.endsWith(".opencode/wx-clawbot/account.json")).toBe(true)
  })

  test("keeps absolute and relative paths", () => {
    expect(expandHome("/tmp/account.json")).toBe("/tmp/account.json")
    expect(expandHome("./account.json")).toBe("./account.json")
  })
})

describe("resolveOptions", () => {
  test("returns defaults for missing input", () => {
    expect(resolveOptions(undefined)).toEqual({
      enabled: true,
      timeoutMs: 5 * 60_000,
      tools: ["question"],
      accountFile: expandHome(DEFAULTS.accountFile),
      toUser: undefined,
    })
  })

  test("applies valid overrides", () => {
    const options = resolveOptions({
      enabled: false,
      timeoutMs: 60_000,
      tools: ["question", "custom_confirm"],
      accountFile: "/tmp/account.json",
      toUser: "user@im.wechat",
    })
    expect(options).toEqual({
      enabled: false,
      timeoutMs: 60_000,
      tools: ["question", "custom_confirm"],
      accountFile: "/tmp/account.json",
      toUser: "user@im.wechat",
    })
  })

  test("falls back on invalid values", () => {
    const options = resolveOptions({ timeoutMs: -5, tools: [], accountFile: "", enabled: "yes" })
    expect(options.enabled).toBe(true)
    expect(options.timeoutMs).toBe(DEFAULTS.timeoutMs)
    expect(options.tools).toEqual(["question"])
    expect(options.accountFile).toBe(expandHome(DEFAULTS.accountFile))
  })

  test("ignores non-object input", () => {
    const options = resolveOptions("nonsense")
    expect(options.timeoutMs).toBe(DEFAULTS.timeoutMs)
  })
})
