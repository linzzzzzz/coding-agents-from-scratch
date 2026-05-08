# 第 1 章：AI Agent 入门

## 什么是 AI Agent？

Chatbot 会接收你的消息，把它发送给 LLM，然后返回回复。这是一个回合：输入进去，输出回来。

**Agent** 不一样。Agent 可以：

1. **判断** 自己需要更多信息
2. **使用工具** 获取这些信息
3. **推理** 工具返回的结果
4. **重复** 这个过程，直到任务完成

关键差异是 **loop**。Chatbot 是一次函数调用。Agent 是一个持续运行的循环，直到工作完成才停下来。LLM 不只是生成文本，它还会决定采取什么动作、观察结果，并规划下一步。

可以这样理解：

```
User: "What files are in my project?"

Chatbot: "I can't see your files, but typically a project has..."

Agent:
  → Thinks: "I need to list the files"
  → Calls: listFiles(".")
  → Gets: ["package.json", "src/", "README.md"]
  → Responds: "Your project has package.json, a src/ directory, and a README.md"
```

这个 agent 使用了一个 **tool** 去真实查看文件系统，然后把结果整理成回复。这就是本书会构建的基本模式。

## 我们要构建什么

读完这本书后，你会拥有一个可以在终端运行的 CLI AI agent。它能够：

- 进行多轮对话
- 读取和写入文件
- 运行 shell 命令
- 搜索网页
- 执行代码
- 在危险操作前请求你的许可
- 管理长对话，避免超出上下文窗口

它会像一个迷你版的 Claude Code 或终端里的 GitHub Copilot。更重要的是，因为每一行代码都是你自己写出来的，所以你会理解它的每个部分。

## 项目设置

我们从零开始。

### 初始化项目

```bash
mkdir agents-v2
cd agents-v2
npm init -y
```

### 安装依赖

我们需要几个关键 package：

```bash
# Core AI dependencies
npm install ai @ai-sdk/openai

# Terminal UI
npm install react ink ink-spinner

# Utilities
npm install zod shelljs

# Observability (for evals later)
npm install @lmnr-ai/lmnr

# Dev dependencies
npm install -D typescript tsx @types/node @types/react @types/shelljs @biomejs/biome
```

每个 package 的作用如下：

| Package | 作用 |
|---------|---------|
| `ai` | Vercel AI SDK，提供 LLM 调用、streaming 和 tool calling 的统一接口 |
| `@ai-sdk/openai` | AI SDK 的 OpenAI-compatible provider |
| `react` + `ink` | 面向终端的 React renderer，类似 React Native，但目标是 CLI |
| `zod` | Schema validation，用来定义工具参数结构 |
| `shelljs` | 跨平台 shell 命令执行 |
| `@lmnr-ai/lmnr` | Laminar，用于可观测性和结构化评测 |

### 配置 TypeScript

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "moduleDetection": "force",
    "module": "Preserve",
    "resolveJsonModule": true,
    "allowJs": true
  }
}
```

几个关键选择：

- **`jsx: "react-jsx"`** — 后面会用 React 构建终端 UI
- **`moduleResolution: "bundler"`** — 允许 `.ts` imports
- **`strict: true`** — 打开完整类型安全
- **`module: "Preserve"`** — 不转换 import 语法

### 配置 package.json

更新 `package.json`，加入 `type` 字段和 scripts：

```json
{
  "name": "agi",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "agi": "./dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch --env-file=.env src/index.ts",
    "start": "tsx --env-file=.env src/index.ts",
    "eval": "npx lmnr eval",
    "eval:file-tools": "npx lmnr eval evals/file-tools.eval.ts",
    "eval:shell-tools": "npx lmnr eval evals/shell-tools.eval.ts",
    "eval:agent": "npx lmnr eval evals/agent-multiturn.eval.ts"
  }
}
```

每个 script 的作用：

| Script | 作用 |
|--------|---------|
| `build` | 将 TypeScript 编译到 `dist/`，用于发布 |
| `dev` | 以 watch mode 运行 agent，文件变化时自动重启 |
| `start` | 运行一次 agent |
| `eval` | 运行所有评测文件 |
| `eval:file-tools` | 运行文件工具选择评测（第 3 章） |
| `eval:shell-tools` | 运行 shell 工具选择评测（第 8 章） |
| `eval:agent` | 运行多轮 agent 评测（第 5 章） |

`--env-file=.env` 会告诉 Node/tsx 自动从 `.env` 文件加载环境变量。

`"type": "module"` 很重要，它启用 ES modules，让我们可以使用 `import/export` 语法。

`"bin"` 字段允许用户通过 `npm install -g` 全局安装 agent，然后在任意位置运行 `agi`。

### 构建配置

`eval` 和 `dev` scripts 不需要单独的 build step，因为 tsx 可以直接处理 TypeScript。但如果要把 agent 作为 npm package 发布，就需要创建 `tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

它继承基础 tsconfig，但允许把编译后的 JavaScript 输出到 `dist/`。

### 环境变量

创建 `.env` 文件，放入本书后续会用到的 API keys：

```
LLM_API_KEY=your-api-key-here
LLM_MODEL=qwen3.5-flash-2026-02-23
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LMNR_API_KEY=your-laminar-api-key-here
```

- **`LLM_API_KEY`** — 必填。使用 OpenAI 或其他 OpenAI-compatible provider 的 API key。
- **`LLM_MODEL`** — 必填。要调用的 model 名称。
- **`LLM_BASE_URL`** — 非默认 provider 需要填写。如果直接使用 OpenAI，可以不设置。使用其他 compatible provider 时，设置为对应 provider 的 API base URL，通常以 `/v1` 结尾。
- **`LMNR_API_KEY`** — 可选但推荐。从 [laminar.ai](https://www.lmnr.ai) 获取。第 3、5、8 章会用于运行评测。没有它也可以本地运行 eval，只是不会长期追踪结果。

并把它加入 `.gitignore`：

```
node_modules
dist
.env
```

### 创建目录结构

```bash
mkdir -p src/agent/tools
mkdir -p src/agent/system
mkdir -p src/agent/context
mkdir -p src/ui/components
```

## 第一次 LLM 调用

先确认所有东西都能正常工作。创建 `src/index.ts`：

```typescript
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

const result = await generateText({
  model: provider.chat(process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23"),
  prompt: "What is an AI agent in one sentence?",
});

console.log(result.text);
```

运行：

```bash
npm run start
```

你应该会看到类似这样的输出：

```
An AI agent is an autonomous system that perceives its environment,
makes decisions, and takes actions to achieve specific goals.
```

这只是一次 LLM 调用。还没有工具、没有 loop、也还不是 agent。

## 理解 AI SDK

Vercel AI SDK（`ai` package）是我们接下来要构建的基础。它提供：

- **`generateText()`** — 发起一次 LLM 调用并拿到完整回复
- **`streamText()`** — 在 token 生成时进行流式输出，后面会用于 agent
- **`tool()`** — 定义 LLM 可以调用的工具
- **`generateObject()`** — 获取结构化 JSON 输出，后面会用于 evals

SDK 会隐藏 provider-specific 细节。我们使用 `@ai-sdk/openai` 作为 provider，因为它既支持 OpenAI，也支持很多 OpenAI-compatible API。这里有意使用 `.chat(...)`：它走 Chat Completions API，这是大多数 OpenAI-compatible vendor 支持的 endpoint。如果直接使用 OpenAI，可以不设置 `LLM_BASE_URL`。如果使用其他 compatible provider，就把 `LLM_BASE_URL` 设置为对应 provider 的 API base URL，并把 `LLM_MODEL` 设置成它支持的 model 名称。

## 添加 System Prompt

Agent 需要性格和行为准则。创建 `src/agent/system/prompt.ts`：

```typescript
export const SYSTEM_PROMPT = `You are a helpful AI assistant. You provide clear, accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question`;
```

这里故意保持简单。System prompt 会告诉 LLM 应该如何表现。在生产级 agent 中，它会包含更详细的工具使用说明、安全准则和回复格式要求。随着我们添加功能，这个 prompt 也会逐步增长。

## 定义类型

创建 `src/types.ts`，加入后续需要的核心 interfaces：

```typescript
export interface AgentCallbacks {
  onToken: (token: string) => void;
  onToolCallStart: (name: string, args: unknown) => void;
  onToolCallEnd: (name: string, result: string) => void;
  onComplete: (response: string) => void;
  onToolApproval: (name: string, args: unknown) => Promise<boolean>;
  onTokenUsage?: (usage: TokenUsageInfo) => void;
}

export interface ToolApprovalRequest {
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ModelLimits {
  inputLimit: number;
  outputLimit: number;
  contextWindow: number;
}

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  threshold: number;
  percentage: number;
}
```

这些 interfaces 定义了 agent core 和 UI layer 之间的契约：

- **`AgentCallbacks`** — agent 如何把信息传回 UI，例如 streaming tokens、tool calls、completion
- **`ToolCallInfo`** — LLM 想调用的工具的 metadata
- **`ModelLimits`** — 上下文管理需要的 token limits
- **`TokenUsageInfo`** — 当前 token 使用情况，用于展示

我们不会马上用到所有类型，但现在定义它们，可以让你提前看到项目会往哪里走。

## 小结

这一章你完成了：

- 理解 agent 和 chatbot 的关键区别：loop
- 用 AI SDK 搭建 TypeScript 项目
- 完成第一次 LLM 调用
- 创建 system prompt 和核心类型定义

目前项目还很简单，只是一次 LLM 调用。下一章，我们会教它使用工具。

---

**下一章：[第 2 章：工具调用 →](./02-tool-calling.md)**
