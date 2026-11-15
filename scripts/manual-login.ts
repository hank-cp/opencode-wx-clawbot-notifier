// 独立驱动微信扫码登录：拉取二维码 → 轮询确认 → 写入 account.json。
// 用途：/wx-login 二维码过期后，由会话代理直接重新发起登录。
// 用法：bun scripts/manual-login.ts（或 node --experimental-strip-types）
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import QRCode from "qrcode"
import { fetchQr, pollQr } from "../src/wx/transport.ts"
import { saveAccount } from "../src/wx/account.ts"
import type { StoredAccount } from "../src/wx/account.ts"

const dir = join(homedir(), ".opencode", "wx-clawbot")
const accountFile = join(dir, "account.json")
const qrTextFile = join(dir, "manual-login.qr.txt")
const qrPngFile = join(dir, "manual-login.qrcode.png")
const statusFile = join(dir, "manual-login.status.json")

function setStatus(patch: Record<string, unknown>): void {
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(readFileSync(statusFile, "utf-8")) as Record<string, unknown>
  } catch {
    // 首次写入
  }
  writeFileSync(
    statusFile,
    JSON.stringify({ ...cur, ...patch, updatedAt: new Date().toISOString() }, null, 2),
  )
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type PollLike = {
  status: string
  token?: string
  baseUrl?: string
  accountId?: string
  userId?: string
}

async function main(): Promise<void> {
  mkdirSync(dir, { recursive: true })
  setStatus({ state: "fetching" })
  const ticket = await fetchQr()
  setStatus({ state: "fetched" })

  const lines: string[] = ["请用微信扫描下方二维码登录："]
  if (ticket.qrUrl) {
    try {
      writeFileSync(qrPngFile, await QRCode.toBuffer(ticket.qrUrl, { type: "png" }))
      lines.push(`也可打开图片扫码：${qrPngFile}`)
    } catch (error) {
      lines.push(`（图片生成失败：${error instanceof Error ? error.message : String(error)}）`)
    }
    try {
      lines.push(await QRCode.toString(ticket.qrUrl, { type: "utf8" }))
    } catch {
      // ASCII 渲染失败不阻断
    }
    lines.push(`二维码链接：${ticket.qrUrl}`)
  } else {
    lines.push("（网关未返回二维码链接，无法展示，请稍后重试）")
  }
  writeFileSync(qrTextFile, lines.join("\n"))
  setStatus({ state: "waiting_scan" })

  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    let s: PollLike = { status: "wait" }
    try {
      s = await pollQr(ticket.qrcode)
    } catch {
      // 网络错误按 wait 处理
    }
    setStatus({ lastPoll: s.status })
    if (s.status === "confirmed") {
      if (!s.token || !s.baseUrl || !s.accountId) {
        setStatus({ state: "error", error: "登录响应缺少必要字段（token/baseurl/ilink_bot_id）" })
        console.log("LOGIN_ERROR")
        process.exit(1)
      }
      const account: StoredAccount = {
        token: s.token,
        baseUrl: s.baseUrl,
        accountId: s.accountId,
        userId: s.userId,
        createdAt: new Date().toISOString(),
      }
      saveAccount(accountFile, account)
      setStatus({ state: "confirmed", accountId: s.accountId, userId: s.userId })
      console.log("LOGIN_CONFIRMED")
      process.exit(0)
    }
    if (s.status === "expired") {
      setStatus({ state: "expired" })
      console.log("LOGIN_EXPIRED")
      process.exit(1)
    }
    await delay(2_000)
  }
  setStatus({ state: "expired" })
  console.log("LOGIN_EXPIRED")
  process.exit(1)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  setStatus({ state: "error", error: message })
  console.log(`LOGIN_ERROR: ${message}`)
  process.exit(1)
})
