import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  getUpdates,
  pollQr,
  sendText,
  StaleContextTokenError,
  StaleTokenError,
  TransportError,
  type Account,
} from "../src/wx/transport.js"

const account: Account = {
  token: "test-token",
  baseUrl: "https://example.com",
  accountId: "bot_123",
}

type FetchCall = {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

const calls: FetchCall[] = []
let nextResponse: { status?: number; body?: unknown } = { status: 200, body: { ret: 0 } }
let originalFetch: typeof fetch

beforeEach(() => {
  calls.length = 0
  nextResponse = { status: 200, body: { ret: 0 } }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function installFetchMock(): void {
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value
    }
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: String(init?.body ?? ""),
    })
    return new Response(
      nextResponse.body === undefined ? "" : JSON.stringify(nextResponse.body),
      { status: nextResponse.status ?? 200 },
    )
  }) as typeof fetch
}

describe("sendText", () => {
  test("builds a correct sendmessage request", async () => {
    installFetchMock()
    nextResponse = { body: { ret: 0, message_id: "mid_1" } }
    const result = await sendText(account, "user@im.wechat", "hello 世界", "ctx_1")
    expect(result).toBe("mid_1")

    const call = calls[0]!
    expect(call.url).toBe("https://example.com/ilink/bot/sendmessage")
    expect(call.method).toBe("POST")
    expect(call.headers.Authorization).toBe("Bearer test-token")
    expect(call.headers.AuthorizationType).toBe("ilink_bot_token")
    // Node 24 undici 致命问题：绝不能设置 Content-Length
    expect(call.headers["Content-Length"]).toBeUndefined()

    const payload = JSON.parse(call.body)
    expect(payload.msg.to_user_id).toBe("user@im.wechat")
    expect(payload.msg.item_list[0].text_item.text).toBe("hello 世界")
    expect(payload.msg.context_token).toBe("ctx_1")
    expect(payload.base_info.channel_version).toBe("2.4.10")
  })

  test("throws on non-zero ret", async () => {
    installFetchMock()
    nextResponse = { body: { ret: 1, errmsg: "boom" } }
    await expect(sendText(account, "u", "x", "")).rejects.toThrow(TransportError)
  })

  // Regression: non -2 ret codes stay plain TransportError (e.g. ret=-3)
  test("keeps non -2 ret codes as plain TransportError (e.g. ret=-3)", async () => {
    installFetchMock()
    nextResponse = { body: { ret: -3, errmsg: "invalid arguments" } }
    const error = await sendText(account, "u", "x", "").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransportError)
    expect(error).not.toBeInstanceOf(StaleContextTokenError)
    expect((error as Error).message).toBe("sendmessage ret=-3 invalid arguments")
  })

  test("throws StaleTokenError on errcode -14", async () => {
    installFetchMock()
    nextResponse = { body: { errcode: -14 } }
    await expect(sendText(account, "u", "x", "")).rejects.toThrow(StaleTokenError)
  })

  // Regression: after a long quiet period the context_token expires and the
  // gateway answers ret=-2 prepare failed
  test("throws StaleContextTokenError with actionable message on ret=-2 prepare failed", async () => {
    installFetchMock()
    nextResponse = { body: { ret: -2, errmsg: "prepare failed" } }
    const error = await sendText(account, "u", "x", "stale_ctx").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StaleContextTokenError)
    expect(error).toBeInstanceOf(TransportError) // existing catches/classification unaffected
    expect((error as Error).message).toContain("prepare failed")
    expect((error as Error).message).toContain("给 bot 发一条消息")
  })

  // Regression edge: the gateway may return a bare {"ret":-2} without errmsg
  test("classifies bare ret=-2 without errmsg as stale context", async () => {
    installFetchMock()
    nextResponse = { body: { ret: -2 } }
    const error = await sendText(account, "u", "x", "").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StaleContextTokenError)
    expect((error as Error).message).toContain("给 bot 发一条消息")
  })
})

describe("getUpdates", () => {
  test("returns messages and buffer", async () => {
    installFetchMock()
    nextResponse = {
      body: {
        ret: 0,
        msgs: [{ from_user_id: "u1", context_token: "ctx_new", message_type: 1 }],
        get_updates_buf: "buf_2",
      },
    }
    const result = await getUpdates(account, "buf_1")
    expect(result.buffer).toBe("buf_2")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]!.from_user_id).toBe("u1")

    const payload = JSON.parse(calls[0]!.body)
    expect(payload.get_updates_buf).toBe("buf_1")
  })

  test("throws StaleTokenError on errcode -14", async () => {
    installFetchMock()
    nextResponse = { body: { errcode: -14 } }
    await expect(getUpdates(account, "")).rejects.toThrow(StaleTokenError)
  })

  test("returns empty result on abort/timeout", async () => {
    installFetchMock()
    // simulate a long-poll timeout
    globalThis.fetch = (async () => {
      const error = new Error("The operation was aborted due to timeout")
      error.name = "TimeoutError"
      throw error
    }) as typeof fetch
    const result = await getUpdates(account, "buf")
    expect(result.messages).toEqual([])
    expect(result.buffer).toBe("buf")
  })
})

describe("pollQr", () => {
  test("returns confirmed payload", async () => {
    installFetchMock()
    nextResponse = {
      body: {
        status: "confirmed",
        bot_token: "tok",
        baseurl: "https://bot.example.com",
        ilink_bot_id: "bot_9",
      },
    }
    const result = await pollQr("qrcode_1")
    expect(result.status).toBe("confirmed")
    expect(result.token).toBe("tok")
    expect(result.accountId).toBe("bot_9")
  })

  test("treats HTTP errors as wait", async () => {
    installFetchMock()
    nextResponse = { status: 524, body: {} }
    const result = await pollQr("qrcode_1")
    expect(result.status).toBe("wait")
  })
})
