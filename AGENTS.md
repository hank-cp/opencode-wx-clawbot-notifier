# opencode-wx-clawbot-notifier

> **Constitution**: 本项目最高规则见 `/docs/regulation/constitution.md`，所有流程任务自动加载并遵守。

## Overview

OpenCode V2 插件：当 AI 调用 `question` 等人工介入工具、等待用户回答超时时，通过微信（ClawBot / iLink Bot 网关）主动推送通知，提醒用户回到终端。

### Main Features

- 监听 `question` 工具的 `execute.before` / `execute.after`，超时（默认 5 分钟）未响应时发送微信通知
- 复用微信 ClawBot → iLink Bot 网关协议发送文本消息，支持扫码登录与后台长轮询保活
- 提供 `/wx-login`、`/wx-status` 等命令完成登录、状态检查
- 通过插件 options 配置超时时间、监听工具、凭据路径、固定收件人与启用开关

## Interaction Requirements
- **Thinking**: 使用中文推理
- **Reply**: 使用中文回复

## Tech Stack

* **TypeScript 5.5**: 严格类型，ESM，`moduleResolution` 面向 Node
* **Bun**: 测试运行器（`bun test`）与打包器（`Bun.build`，target node，输出 `dist/index.js`）
* **@opencode/plugin ^2.1.1**: OpenCode V2 插件 API（`Plugin.define`、`ctx.tool.hook`、命令注册），作为 peer dependency 由宿主提供
* **Node 24**: 插件最终在 Node/Electron 宿主中运行，网络层使用 Node 内置 `http/https`

## Development Environment

### Local Setup

* 安装依赖：`bun install`
* 无需数据库；微信凭据存放于 `~/.opencode/wx-clawbot/account.json`（可用 `accountFile` 覆盖）

### Development Commands

* 类型检查：`bun run typecheck`
* 测试：`bun test`
* 构建：`bun run build`
* 格式化：`bun run format`

## Development Design Principles

### Supreme Principle

在系统边界做校验，内部保持类型确定；一切外部输入（插件 options、网关报文）先解析为受控结构再使用。

### Design Principles

* 单一职责拆分：`config` 解析配置、`watcher` 管理超时计时、`wx/*` 负责协议与传输、`commands` 注册命令
* 依赖注入：`logger`、`WeChatClient` 由外部传入，便于测试与替换
* 失败不阻断主流程：通知发送失败仅记录 warn 日志，不影响 OpenCode 会话

### Development Principles

* 提交前必须通过 `bun run typecheck` 与 `bun test`
* 新增行为先补测试（`tests/*.test.ts`），再改实现
* 对外契约（options、命令、通知文案）变更同步更新 README

### ANTI-PATTERNS

* 使用 `any` / `@ts-ignore` / 非空断言绕过类型检查
* 在插件运行期吞掉异常且不记录日志
* 直接假设网关返回结构，跳过运行时校验
* 把登录/轮询等长生命周期副作用写进纯函数

### Notes

* 该插件按 OpenCode V2 API 编写；V2 已无独立 `confirm` 工具，人工介入统一走 `question`
* 微信 bot 只能给主动联系过它的用户发消息，登录后需先给 bot 发一条消息以生成 `context_token`
