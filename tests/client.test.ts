import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { WeChatClient } from "../src/wx/client.js"
import { silentLogger } from "../src/logger.js"
import type { StoredAccount } from "../src/wx/account.js"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let originalFetch: typeof fetch
let lastCall: { url: string; headers: Record<string, string>; body: string } | undefined

function installFetchMock(response: unknown): void {
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value
    }
    lastCall = { url: String(url), headers, body: String(init?.body ?? "") }
    return new Response(JSON.stringify(response), { status: 200 })
  }) as typeof fetch
}

const account: StoredAccount = {
  token: "tok",
  baseUrl: "https://example.com",
  accountId: "bot_1",
  createdAt: "2026-01-01T00:00:00Z",
}

function makeClient(file: string, toUser?: string): WeChatClient {
  const client = new WeChatClient({ accountFile: file, toUser, logger: silentLogger })
  return client
}

describe("WeChatClient", () => {
  let dir: string
  let accountFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wx-clawbot-client-test-"))
    accountFile = join(dir, "account.json")
    lastCall = undefined
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(dir, { recursive: true, force: true })
  })

  test("sendText throws when not logged in", async () => {
    const client = makeClient(accountFile)
    await client.start() // no account file → not logged in
    await expect(client.sendText("hi")).rejects.toThrow("未登录微信")
  })

  test("sendText uses configured toUser even without cached users", async () => {
    installFetchMock({ ret: 0, message_id: "m1" })
    writeFileSync(accountFile, JSON.stringify(account))
    const client = makeClient(accountFile, "owner@im.wechat")
    await client.start()
    client.stop() // stop polling; we only need sendText
    await client.sendText("通知")
    expect(lastCall?.url).toContain("/ilink/bot/sendmessage")
    const payload = JSON.parse(lastCall!.body)
    expect(payload.msg.to_user_id).toBe("owner@im.wechat")
  })

  test("sendText throws when logged in but no known users", async () => {
    installFetchMock({ ret: 0 })
    writeFileSync(accountFile, JSON.stringify(account))
    const client = makeClient(accountFile)
    await client.start()
    client.stop()
    await expect(client.sendText("hi")).rejects.toThrow("没有已知收件人")
  })
})
