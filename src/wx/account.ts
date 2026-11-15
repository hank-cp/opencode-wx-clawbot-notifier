import { dirname } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

export interface StoredAccount {
  token: string
  baseUrl: string
  accountId: string
  userId?: string
  createdAt: string
}

export function loadAccount(file: string): StoredAccount | undefined {
  try {
    if (!existsSync(file)) return undefined
    const raw: unknown = JSON.parse(readFileSync(file, "utf-8"))
    if (typeof raw !== "object" || raw === null) return undefined
    const record = raw as Record<string, unknown>
    if (typeof record.token !== "string" || record.token.length === 0) return undefined
    if (typeof record.baseUrl !== "string" || record.baseUrl.length === 0) return undefined
    if (typeof record.accountId !== "string" || record.accountId.length === 0) return undefined
    return {
      token: record.token,
      baseUrl: record.baseUrl,
      accountId: record.accountId,
      userId: typeof record.userId === "string" ? record.userId : undefined,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    }
  } catch {
    return undefined
  }
}

export function saveAccount(file: string, account: StoredAccount): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(account, null, 2) + "\n", { mode: 0o600 })
}
