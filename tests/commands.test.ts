import { describe, expect, test } from "bun:test"
import { registerCommands, type CommandClient, type CommandHost } from "../src/commands.js"
import type { ResolvedOptions } from "../src/config.js"
import { silentLogger, type Logger } from "../src/logger.js"

interface RecordedSynthetic {
  sessionID: string
  text: string
  description?: string
  resume?: boolean
}

interface RecordedPrompt {
  sessionID: string
  text: string
  delivery?: "steer" | "queue"
}

interface HostRecords {
  synthetic: RecordedSynthetic[]
  prompt: RecordedPrompt[]
}

interface CommandDefinitions {
  [name: string]: (invocation: { sessionID: string }) => Promise<void>
}

function makeHost(): { host: CommandHost; records: HostRecords; commands: CommandDefinitions } {
  const records: HostRecords = { synthetic: [], prompt: [] }
  const commands: CommandDefinitions = {}
  const host: CommandHost = {
    command: {
      transform: async (callback) => {
        callback({
          add(definition) {
            commands[definition.name] = definition.execute
          },
        })
      },
    },
    session: {
      synthetic: async (input) => {
        records.synthetic.push(input)
      },
      prompt: async (input) => {
        records.prompt.push(input)
      },
    },
  }
  return { host, records, commands }
}

const SESSION_ID = "ses_test"

// 用例编号与 S2 确认的回归测试清单对应：
// C1 QR 呈现契约 / C2 通知契约 / C3 错误路径（以上为清单用例）
// C4 二维码过期提示 / C5 /wx-status 单行通知 / C6 prompt 拒绝不阻断登录 /
// C7 synthetic 拒绝不阻断登录（清单之外新增场景）

const options: ResolvedOptions = {
  enabled: true,
  timeoutMs: 5 * 60_000,
  tools: ["question"],
  accountFile: "/tmp/wx-clawbot-test/account.json",
}

function makeClient(loginImpl: CommandClient["login"]): CommandClient {
  return {
    accountId: "bot_1",
    loggedIn: true,
    knownUsers: () => ["owner@im.wechat"],
    login: loginImpl,
  }
}

const QR_TEXT = "请用微信扫描下方二维码登录：\n█▀▀█\n也可打开图片扫码：/tmp/qr.png\n二维码链接：https://liteapp.weixin.qq.com/q/abc"

async function setup(loginImpl: CommandClient["login"]): Promise<{
  host: CommandHost
  records: HostRecords
  commands: CommandDefinitions
}> {
  const { host, records, commands } = makeHost()
  await registerCommands(host, makeClient(loginImpl), options, silentLogger)
  return { host, records, commands }
}

describe("registerCommands /wx-login", () => {
  test("C1: QR 消息经 session.prompt 以 steer 提交（完整呈现契约）", async () => {
    const { records, commands } = await setup(async (onProgress) => {
      onProgress({ kind: "notice", text: "正在获取登录二维码…" })
      onProgress({ kind: "qr", text: QR_TEXT })
      return "confirmed"
    })
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(records.prompt).toHaveLength(1)
    const qr = records.prompt[0]
    expect(qr.sessionID).toBe(SESSION_ID)
    expect(qr.text).toBe(QR_TEXT)
    expect(qr.text).toContain("█")
    expect(qr.delivery).toBe("steer")
    // QR 不得再以 synthetic 提交（旧缺陷路径）
    expect(records.synthetic.some((s) => s.text.includes("请用微信扫描"))).toBe(false)
  })

  test("C2: 状态通知经带 description、resume:false 的 synthetic 提交", async () => {
    const { records, commands } = await setup(async (onProgress) => {
      onProgress({ kind: "notice", text: "正在获取登录二维码…" })
      onProgress({ kind: "qr", text: QR_TEXT })
      onProgress({ kind: "notice", text: "登录需要验证码，请按微信提示完成验证后继续等待…" })
      return "confirmed"
    })
    await commands["wx-login"]({ sessionID: SESSION_ID })

    const notices = records.synthetic.filter((s) => !s.text.startsWith("✅ 微信登录成功"))
    expect(notices.length).toBeGreaterThan(0)
    for (const notice of notices) {
      expect(notice.description?.trim()).toBeTruthy()
      expect(notice.resume).toBe(false)
    }
    // 登录成功总结同样是可见的单行通知
    const success = records.synthetic.find((s) => s.text.startsWith("✅ 微信登录成功"))!
    expect(success.description?.trim()).toBeTruthy()
    expect(success.resume).toBe(false)
    expect(success.text.includes("\n")).toBe(false)
  })

  test("C3: 登录抛异常时错误以可见通知呈现，且无 QR prompt", async () => {
    const warnings: string[] = []
    const logger: Logger = { debug: () => {}, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
    const { host, records, commands } = makeHost()
    await registerCommands(
      host,
      makeClient(async () => {
        throw new Error("网关不可达")
      }),
      options,
      logger,
    )
    await commands["wx-login"]({ sessionID: SESSION_ID })

    const error = records.synthetic.find((s) => s.text.includes("登录失败"))!
    expect(error.description?.trim()).toBeTruthy()
    expect(error.resume).toBe(false)
    expect(records.prompt).toHaveLength(0)
  })

  test("C4: 二维码过期时以可见通知提示重新运行", async () => {
    const { records, commands } = await setup(async (onProgress) => {
      onProgress({ kind: "qr", text: QR_TEXT })
      return "expired"
    })
    await commands["wx-login"]({ sessionID: SESSION_ID })

    const expired = records.synthetic.find((s) => s.text.includes("二维码已过期"))!
    expect(expired.description?.trim()).toBeTruthy()
  })

  test("C6: prompt 提交被拒绝时登录流程不中断（warn 记录）", async () => {
    const warnings: string[] = []
    const logger: Logger = { debug: () => {}, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
    const records: HostRecords = { synthetic: [], prompt: [] }
    const commands: CommandDefinitions = {}
    const host: CommandHost = {
      command: {
        transform: async (callback) => {
          callback({
            add(definition) {
              commands[definition.name] = definition.execute
            },
          })
        },
      },
      session: {
        synthetic: async (input) => {
          records.synthetic.push(input)
        },
        prompt: async () => {
          throw new Error("session not found")
        },
      },
    }
    await registerCommands(host, makeClient(async (onProgress) => {
      onProgress({ kind: "qr", text: QR_TEXT })
      return "confirmed"
    }), options, logger)
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(warnings.some((m) => m.includes("登录二维码呈现失败"))).toBe(true)
    // 登录流程未被阻断：成功总结仍提交
    expect(records.synthetic.some((s) => s.text.startsWith("✅ 微信登录成功"))).toBe(true)
  })

  test("C7: synthetic 通知被拒绝时登录流程不中断（warn 记录）", async () => {
    const warnings: string[] = []
    const logger: Logger = { debug: () => {}, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
    const records: HostRecords = { synthetic: [], prompt: [] }
    const commands: CommandDefinitions = {}
    const host: CommandHost = {
      command: {
        transform: async (callback) => {
          callback({
            add(definition) {
              commands[definition.name] = definition.execute
            },
          })
        },
      },
      session: {
        synthetic: async () => {
          throw new Error("session not found")
        },
        prompt: async (input) => {
          records.prompt.push(input)
        },
      },
    }
    await registerCommands(host, makeClient(async (onProgress) => {
      onProgress({ kind: "notice", text: "正在获取登录二维码…" })
      onProgress({ kind: "qr", text: QR_TEXT })
      return "confirmed"
    }), options, logger)
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(warnings.some((m) => m.includes("登录通知发送失败"))).toBe(true)
    // 登录流程未被阻断：QR 仍经 prompt 提交
    expect(records.prompt).toHaveLength(1)
    expect(records.prompt[0].text).toBe(QR_TEXT)
  })
})

describe("registerCommands /wx-status", () => {
  test("C5: 状态以单行、带 description、resume:false 的 synthetic 提交", async () => {
    const { records, commands } = await setup(async () => "confirmed")
    await commands["wx-status"]({ sessionID: SESSION_ID })

    expect(records.synthetic).toHaveLength(1)
    const status = records.synthetic[0]
    expect(status.text).toContain("✅ 已登录：bot 账号 bot_1")
    expect(status.text).toContain("owner@im.wechat")
    expect(status.text.includes("\n")).toBe(false) // 单行，保证 TUI Notice 完整可见
    expect(status.description?.trim()).toBeTruthy()
    expect(status.resume).toBe(false)
  })
})
