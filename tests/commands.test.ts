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
  /** armTestTimeout 的调用记录（连接测试的 10 秒覆盖） */
  armed: number[]
  /** sendText 的调用记录（连接成功通知） */
  sent: { text: string; to?: string }[]
}

interface CommandDefinitions {
  [name: string]: (invocation: { sessionID: string }) => Promise<void>
}

function makeHost(): { host: CommandHost; records: HostRecords; commands: CommandDefinitions } {
  const records: HostRecords = { synthetic: [], prompt: [], armed: [], sent: [] }
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

interface ClientOverrides {
  /** waitForActivation 实现；缺省立即返回已激活用户 */
  waitForActivation?: CommandClient["waitForActivation"]
  /** sendText 实现；缺省记录调用并成功返回 */
  sendText?: CommandClient["sendText"]
}

function makeClient(
  loginImpl: CommandClient["login"],
  overrides: ClientOverrides = {},
  records?: HostRecords,
): CommandClient {
  return {
    accountId: "bot_1",
    loggedIn: true,
    recipients: () => ["owner@im.wechat"],
    knownUsers: () => ["owner@im.wechat"],
    login: loginImpl,
    waitForActivation:
      overrides.waitForActivation ?? (async () => "owner@im.wechat"),
    sendText:
      overrides.sendText ??
      (async (text, to) => {
        records?.sent.push({ text, to })
      }),
  }
}

const QR_TEXT = "请用微信扫描下方二维码登录：\n█▀▀█\n也可打开图片扫码：/tmp/qr.png\n二维码链接：https://liteapp.weixin.qq.com/q/abc"

async function setup(
  loginImpl: CommandClient["login"],
  overrides: ClientOverrides = {},
): Promise<{
  host: CommandHost
  records: HostRecords
  commands: CommandDefinitions
}> {
  const { host, records, commands } = makeHost()
  await registerCommands(
    host,
    makeClient(loginImpl, overrides, records),
    options,
    silentLogger,
    (ms) => records.armed.push(ms),
  )
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

    expect(records.prompt.length).toBeGreaterThanOrEqual(1)
    const qr = records.prompt.find((p) => p.text.includes("█"))!
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

    const notices = records.synthetic.filter((s) => !s.text.startsWith("✅ 扫码成功"))
    expect(notices.length).toBeGreaterThan(0)
    for (const notice of notices) {
      expect(notice.description?.trim()).toBeTruthy()
      expect(notice.resume).toBe(false)
    }
    // 激活引导同样是可见的单行通知
    const success = records.synthetic.find((s) => s.text.startsWith("✅ 扫码成功"))!
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
      (ms) => records.armed.push(ms),
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
    }), options, logger, () => {})
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(warnings.some((m) => m.includes("登录二维码呈现失败"))).toBe(true)
    // 登录流程未被阻断：激活引导仍提交
    expect(records.synthetic.some((s) => s.text.startsWith("✅ 扫码成功"))).toBe(true)
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
    }), options, logger, () => {})
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(warnings.some((m) => m.includes("登录通知发送失败"))).toBe(true)
    // 登录流程未被阻断：QR 仍经 prompt 提交（引导消息排在 QR 之后）
    expect(records.prompt.length).toBeGreaterThanOrEqual(1)
    expect(records.prompt[0].text).toBe(QR_TEXT)
  })

  test("U1: 登录确认后提示用户给 ClawBot 发激活消息（友好、单行、resume:false）", async () => {
    const { records, commands } = await setup(async (onProgress) => {
      onProgress({ kind: "qr", text: QR_TEXT })
      return "confirmed"
    })
    await commands["wx-login"]({ sessionID: SESSION_ID })

    const activation = records.synthetic.find((s) => s.text.includes("给 ClawBot 发一条消息"))!
    expect(activation.description?.trim()).toBeTruthy()
    expect(activation.resume).toBe(false)
    expect(activation.text.includes("\n")).toBe(false)
    expect(activation.text).toContain("扫码成功")
  })

  test("U2: 收到激活消息后自动展示状态 + ClawBot 发「已连接成功」+ 注入测试引导 + 武装 10 秒超时", async () => {
    const { records, commands } = await setup(async (onProgress) => {
      onProgress({ kind: "qr", text: QR_TEXT })
      return "confirmed"
    })
    await commands["wx-login"]({ sessionID: SESSION_ID })

    // 1. 自动展示连接状态（复用 /wx-status 文案）
    const status = records.synthetic.find((s) => s.text.includes("✅ 已登录：bot 账号 bot_1"))!
    expect(status.text).toContain("owner@im.wechat")
    expect(status.text).toContain("⏱ 超时阈值：5 分钟")
    // 2. ClawBot 向激活用户本人发送「已连接成功」微信消息
    expect(records.sent).toHaveLength(1)
    expect(records.sent[0].to).toBe("owner@im.wechat")
    expect(records.sent[0].text).toContain("连上")
    // 3. 注入引导 AI 调用 question 测试的消息
    const guide = records.prompt.find((p) => p.text.includes("question"))!
    expect(guide.text).toContain("微信提醒")
    expect(guide.delivery).toBe("steer")
    // 4. 武装一次性 10 秒测试超时
    expect(records.armed).toEqual([10_000])
  })

  test("U3: 激活超时后友好提示稍后检查，且无状态展示/无发送/无注入/无武装", async () => {
    const { records, commands } = await setup(
      async (onProgress) => {
        onProgress({ kind: "qr", text: QR_TEXT })
        return "confirmed"
      },
      { waitForActivation: async () => undefined },
    )
    await commands["wx-login"]({ sessionID: SESSION_ID })

    const timeout = records.synthetic.find((s) => s.text.includes("还没收到你的消息"))!
    expect(timeout.text).toContain("/wx-status")
    expect(records.synthetic.some((s) => s.text.includes("✅ 已登录"))).toBe(false)
    expect(records.sent).toHaveLength(0)
    expect(records.prompt.some((p) => p.text.includes("question"))).toBe(false)
    expect(records.armed).toHaveLength(0)
  })

  test("U3b: 连接成功通知发送失败时不阻断流程，友好提示且仍注入测试引导", async () => {
    const warnings: string[] = []
    const logger: Logger = { debug: () => {}, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
    const { host, records, commands } = makeHost()
    await registerCommands(
      host,
      makeClient(
        async (onProgress) => {
          onProgress({ kind: "qr", text: QR_TEXT })
          return "confirmed"
        },
        {
          sendText: async () => {
            throw new Error("ret=-3 invalid arguments")
          },
        },
        records,
      ),
      options,
      logger,
      (ms) => records.armed.push(ms),
    )
    await commands["wx-login"]({ sessionID: SESSION_ID })

    expect(warnings.some((m) => m.includes("连接成功通知发送失败"))).toBe(true)
    expect(records.synthetic.some((s) => s.text.includes("微信消息没能发出去"))).toBe(true)
    // 流程未被阻断：测试引导仍注入、10 秒覆盖仍武装
    expect(records.prompt.some((p) => p.text.includes("question"))).toBe(true)
    expect(records.armed).toEqual([10_000])
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
    expect(status.text).toContain("⏱ 超时阈值：5 分钟")
    expect(status.text).not.toContain("固定收件人")
    expect(status.text.includes("\n")).toBe(false) // 单行，保证 TUI Notice 完整可见
    expect(status.description?.trim()).toBeTruthy()
    expect(status.resume).toBe(false)
  })

  test("C5b: 状态展示实际发送的固定收件人，并对非活跃 id 给出提示", async () => {
    const { host, records, commands } = makeHost()
    const client: CommandClient = {
      accountId: "bot_1",
      loggedIn: true,
      recipients: () => ["someone@im.wechat"],
      knownUsers: () => ["owner@im.wechat"],
      login: async () => "confirmed",
      waitForActivation: async () => "owner@im.wechat",
      sendText: async () => {},
    }
    await registerCommands(host, client, { ...options, timeoutMs: 30_000 }, silentLogger, () => {})
    await commands["wx-status"]({ sessionID: SESSION_ID })

    const status = records.synthetic[0]
    // 必须展示真正会发送的地址，而不是只展示已知用户（旧缺陷：显示 A、实际发 B）
    expect(status.text).toContain("someone@im.wechat")
    expect(status.text).not.toContain("📮 收件人：owner@im.wechat")
    expect(status.text).toContain("固定收件人")
    // 30 秒不应被四舍五入成「1 分钟」
    expect(status.text).toContain("⏱ 超时阈值：30 秒")
    expect(status.text.includes("\n")).toBe(false)
  })
})
