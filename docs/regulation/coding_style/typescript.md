# TypeScript 编码风格

## 通用格式

- 使用 UTF-8 编码、LF 换行
- 使用 Prettier 自动格式化代码（保存时运行）
- 使用 2 空格缩进，不使用 Tab
- 建议最大行长度为 100 个字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- TypeScript 源文件使用 `kebab-case` 或 `camelCase`，与所属模块保持一致
- 目录名使用 `kebab-case`
- 测试文件命名：`*.test.ts` 或 `*.spec.ts`，与被测文件放在同一目录

### 导入分组

```typescript
// 1. Node built-in modules
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2. Third-party libraries
import axios from 'axios';
import { z } from 'zod';

// 3. Project-internal modules (relative paths or aliases)
import { TaskState } from '../state/task-state';
import { FlowParser } from './flow-parser';
```

### 文件结构

- 每个文件理想情况下只保留一个主要导出
- 辅助类型/函数使用具名导出
- 模块暴露清晰的公共 API

## 命名约定

### 变量

- 使用 `camelCase`
- 短作用域使用短名称：`i`、`item`、`ctx`
- 长作用域使用描述性名称：`taskConfig`、`messageCount`
- 布尔变量以疑问词为前缀：`isActive`、`hasPlan`、`canProceed`
- 不使用匈牙利命名法

### 常量

- `UPPER_SNAKE_CASE`（模块级）/ `camelCase`（函数内部）

```typescript
const DEFAULT_LANGUAGE = 'zh-CN';
const MAX_RETRY_COUNT = 3;

function process() {
  const timeoutMs = 5000;
}
```

### 函数

- 使用 `camelCase`
- 以动词开头：`getTask`、`findFlow`、`createPlan`、`parseSpec`
- 事件处理函数：`handleXxx` 或 `onXxx`

### 类型与接口

- 使用 `PascalCase`
- 接口名不加 `I` 前缀
- 类型别名不加 `T` 前缀

```typescript
interface TaskState {
  sessionId: string;
  flow: string;
  currentStep: string;
}

type StepTransition = {
  from: string;
  to: string;
  condition: string;
};
```

### 类

- 使用 `PascalCase`，单数形式
- 公共方法在前，私有方法在后

### 枚举

使用 `PascalCase`，成员使用 `PascalCase`

```typescript
enum TaskStatus {
  Running = 'running',
  Completed = 'completed',
  Closed = 'closed',
}
```

## 类型安全

### 禁止

```typescript
// ❌ Do not use any
function process(data: any): any { }

// ❌ Do not use @ts-ignore / @ts-expect-error
// @ts-ignore
const x = something;

// ❌ Do not use empty catch blocks
try { } catch (e) { }

// ❌ Do not abuse non-null assertions
const x = data!.value!;
```

### 推荐

```typescript
// ✅ Use unknown instead of any
function process(data: unknown): Result {
  if (!isValidData(data)) throw new TypeError('Invalid data');
}

// ✅ Type guards
function isValidData(data: unknown): data is ValidData {
  return typeof data === 'object' && data !== null && 'id' in data;
}

// ✅ Explicit error handling
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed', { cause: e });
}
```

## 函数设计

### 参数

- 超过 3 个参数时使用对象参数

```typescript
// ❌
function createTask(name: string, flow: string, step: string, startAt: Date): Task { }

// ✅
function createTask(params: {
  name: string;
  flow: string;
  step: string;
  startAt: Date;
}): Task { }
```

### 返回值

- 优先返回具体类型，而非 `undefined | null`
- 对于“空”场景，使用 `Result<T, E>` 模式或 `Option<T>`

## 异步处理

- 统一使用 `async/await`，避免裸 Promise
- 异步函数返回带显式类型的 `Promise<T>`
- 顶层异步使用 IIFE 或 `.catch()` 作为兜底

```typescript
async function loadTask(sessionId: string): Promise<Task | null> {
  const data = await db.query('SELECT * FROM tasks WHERE session_id = ?', [sessionId]);
  return data ? Task.fromRow(data) : null;
}
```

## 错误处理

- 所有错误必须显式处理（传播 / 包装 / 处理 / 中止）
- 在系统边界校验（用户输入、外部 API）
- 不在内部逻辑中添加“不可能发生”的错误处理

```typescript
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed to complete operation', { cause: e });
}
```

## 日志

- 使用项目统一的日志模块（而非裸 `console.log`）
- 日志消息使用英文
- 在关键路径上记录 info/debug 日志

```typescript
logger.info('Task created', { sessionId, flow });
logger.error('Failed to load task', { sessionId, error: String(e) });
```

## 注释与文档

- 代码注释使用英文
- 公共 API 使用 JSDoc 注释
- 为复杂逻辑添加说明性注释

## 占位代码

```typescript
// TODO(username): Need to integrate API — expected v1.1
// FIXME(username): Possible data race under concurrency — needs locking
// HACK(username): Temporary workaround — replace after v1.0
```

## 导出约定

```typescript
// Primary export
export class FlowParser { }

// Auxiliary types/functions use named exports
export interface FlowDefinition { }
export function parseFlow(path: string): FlowDefinition { }

// Internal implementation — not exported
function validateStep(step: unknown): step is StepDefinition { }
```
