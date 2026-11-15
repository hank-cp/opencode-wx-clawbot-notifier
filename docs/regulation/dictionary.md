# 术语字典

本项目使用以下术语。代码中的标识符使用英文，文档和沟通中可混用。

---

## 核心概念

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| Notifier | 通知器 | 本插件的核心能力：在人工介入超时时主动推送提醒 |
| Timeout Notification | 超时通知 | `question` 等待超过 `timeoutMs` 后发送的微信消息 |
| Question Tool | 问题工具 | OpenCode V2 内置的人工介入工具 `question`，插件默认监听它 |
| Tool Hook | 工具钩子 | `ctx.tool.hook("execute.before"/"execute.after")`，用于感知工具开始与结束 |
| Watcher | 监听器 | `src/watcher.ts` 中的超时计时管理，按会话/调用标识启停计时器 |
| Human-in-loop | 人机协作 | 需要用户回答才能继续的步骤；本插件解决"人不在终端前"的场景 |
| Session Title | 会话标题 | 通知文案中用于标识来源会话的标题 |
| Recipient | 收件人 | 微信消息接收者；`toUser` 可固定收件人，否则发送给所有已知用户 |
| Account Store | 账号存储 | `~/.opencode/wx-clawbot/account.json`，保存登录凭据与用户列表 |
| QR Login | 扫码登录 | `/wx-login` 生成二维码，用微信扫码确认以建立 bot 会话 |
| Long Polling | 长轮询 | 后台持续拉取新消息，保持会话凭据新鲜 |
| Context Token | 会话令牌 | 网关为"给 bot 发过消息的用户"生成的消息上下文凭据 |
| Plugin Options | 插件配置 | `opencode.jsonc` 中的 plugins options：`timeoutMs`、`tools`、`accountFile`、`toUser`、`enabled` |
| Plugin Entry | 插件入口 | `src/index.ts` 导出的 `WxClawbotNotifier`（`Plugin.define`） |
| Logger | 日志器 | `src/logger.ts`，统一输出 debug/info/warn 日志 |

## 微信接入

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| ClawBot | 微信机器人 | 微信侧的机器人载体，本插件通过它接收通知 |
| iLink Bot | iLink 机器人网关 | 微信消息网关，提供登录与收发消息接口 |
| Transport | 传输层 | `src/wx/transport.ts`，封装 HTTP 请求与报文编解码 |
| WeChat Client | 微信客户端 | `src/wx/client.ts`，对外提供 `start`/`stop`/`sendText` 等能力 |

## 技术栈

| 英文 | 中文 | 说明 |
| --- | --- | --- |
| Plugin | 插件 | OpenCode 插件 |
| Session | 会话 | 一次 OpenCode 对话 |
| Peer Dependency | 对等依赖 | 由宿主提供、插件不自行打包的依赖（`@opencode/plugin`） |
| Bundle | 打包产物 | `bun scripts/build.ts` 生成的 `dist/index.js` |

## 翻译控制

- 不要翻译专用词
  - ClawBot
  - iLink Bot
  - OpenCode
  - Plugin
  - Session
  - Tool Hook
  - Timeout
  - QR Login
  - Long Polling
  - Context Token
