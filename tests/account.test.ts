import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAccount, saveAccount } from "../src/wx/account.js"

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wx-clawbot-account-test-"))
}

describe("account storage", () => {
  test("loadAccount returns undefined for missing file", () => {
    expect(loadAccount("/nonexistent/path/account.json")).toBeUndefined()
  })

  test("save + load roundtrip with restrictive permissions", () => {
    const dir = makeTempDir()
    const file = join(dir, "account.json")
    try {
      saveAccount(file, {
        token: "tok",
        baseUrl: "https://example.com",
        accountId: "bot_1",
        userId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
      })
      const mode = statSync(file).mode & 0o777
      expect(mode).toBe(0o600)

      const loaded = loadAccount(file)
      expect(loaded).toEqual({
        token: "tok",
        baseUrl: "https://example.com",
        accountId: "bot_1",
        userId: "u1",
        createdAt: "2026-01-01T00:00:00Z",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("loadAccount tolerates corrupt or incomplete files", () => {
    const dir = makeTempDir()
    try {
      const corrupt = join(dir, "corrupt.json")
      Bun.write(corrupt, "{not json")
      expect(loadAccount(corrupt)).toBeUndefined()

      const incomplete = join(dir, "incomplete.json")
      Bun.write(incomplete, JSON.stringify({ token: "", baseUrl: "https://x" }))
      expect(loadAccount(incomplete)).toBeUndefined()

      const valid = join(dir, "valid.json")
      Bun.write(valid, JSON.stringify({ token: "t", baseUrl: "https://x", accountId: "b" }))
      const loaded = loadAccount(valid)
      expect(loaded?.accountId).toBe("b")
      expect(loaded?.createdAt).toBe("")
      expect(loaded?.userId).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
