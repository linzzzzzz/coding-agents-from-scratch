# 从零构建生产级 AI Coding Agent

这是一份动手指南，带你用 TypeScript 从零构建一个实用的 CLI coding agent。指南会覆盖工具调用、评测、上下文管理、OpenAI-compatible provider，以及 Human-in-the-Loop 安全机制。

> 灵感来自 [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents)、[Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)、[OpenCode](https://opencode.ai/) 和 [Claude Code](https://code.claude.com/docs/en/overview)。这个版本把学习路径扩展到更接近生产级 coding agent 的方向，并加入 OpenAI-compatible provider、更清晰的说明、问题修复和新的网页体验。

> 💻 **上游参考 repo：** [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)。本指南基于这个基础继续扩展，加入 provider-flexible 配置、更多生产化说明、更清晰的步骤，以及学习过程中发现的修复。

---

## 你会构建什么

读完这本书后，你会拥有一个可以在终端运行的 CLI AI agent。它可以：

- 读取、写入和管理你文件系统里的文件
- 执行 shell 命令
- 搜索网页
- 执行多种语言的代码
- 通过自动上下文压缩管理长对话
- 在危险操作前请求你的审批
- 通过单轮和多轮评测验证行为

## 技术栈

- **TypeScript** — 类型安全的开发体验
- **Vercel AI SDK** — 统一的 LLM 调用、流式输出和工具调用接口
- **OpenAI-compatible provider** — 通过可配置的 API key、model 和 base URL 接入 LLM
- **React + Ink** — 面向终端 UI 的 React renderer
- **Zod** — schema validation，用来定义工具参数结构
- **ShellJS** — 跨平台 shell 命令执行
- **Laminar** — 可观测性和结构化评测框架

## 前置要求

**需要：**
- Node.js 20+
- OpenAI 或其他 OpenAI-compatible provider 的 API key
- 基础 TypeScript/JavaScript 知识，例如变量、函数、async/await、import
- 能熟练在终端运行命令，例如 `npm install`、`npm run`

**不需要：**
- 之前构建过 CLI 工具
- React 经验（第 9 章会有一个快速入门）
- AI/ML 背景，本指南会从基本概念讲起
- Laminar API key（可选，用于长期追踪评测结果）

---

## 目录

## Part I：Agent 基础

### [第 1 章：AI Agent 入门](./01-intro-to-agents.md)
什么是 AI agent？它和普通 chatbot 有什么不同？从零搭建项目，并完成第一次 LLM 调用。

### [第 2 章：工具调用](./02-tool-calling.md)
用 Zod schema 定义工具，并让 agent 学会使用它们。理解结构化 function calling，以及 LLM 如何决定调用哪个工具。

### [第 3 章：单轮评测](./03-single-turn-evals.md)
构建评测框架，测试 agent 是否选择了正确的工具。编写 golden、secondary 和 negative 测试用例。

### [第 4 章：Agent Loop](./04-the-agent-loop.md)
实现核心 agent loop：流式输出回复、检测工具调用、执行工具、把结果喂回模型，并重复这个过程直到任务完成。

### [第 5 章：多轮评测](./05-multi-turn-evals.md)
用 mock 工具测试完整 agent 对话。使用 LLM-as-judge 给输出质量打分，并评估工具调用顺序和 forbidden tool 避免能力。

## Part II：真实世界能力

### [第 6 章：文件系统工具](./06-file-system-tools.md)
加入真实文件系统工具：读取、写入、列出和删除文件。优雅处理错误，并让 agent 能够处理你的代码库。

### [第 7 章：网页搜索与上下文管理](./07-web-search-context-management.md)
加入网页搜索能力。实现 token 估算、上下文窗口追踪和自动对话压缩，用来处理长对话。

### [第 8 章：Shell 工具](./08-shell-tool.md)
让 agent 能够运行 shell 命令。添加一个 code execution 工具，将代码写入临时文件并执行。理解其中的安全影响。

### [第 9 章：Human-in-the-Loop](./09-human-in-the-loop.md)
为危险操作构建审批系统。用 React 和 Ink 创建终端 UI，让用户在工具调用执行前批准或拒绝。

## Part III：强化 Agent

### [第 10 章：从原型到产品](./10-from-prototype-to-product.md)
学习型 agent 和严肃 coding agent 之间还差什么？本章是总览，会链接到可靠性、记忆、安全、工具系统、agent planning 和 subagents 等章节，并以 hardening checklist 和推荐阅读收尾。

### [第 11 章：可靠性](./11-reliability.md)
加入 retries、rate limits、cancellation 和 structured logging，让失败变得可见、可恢复。

### [第 12 章：记忆](./12-memory.md)
持久化有用的 conversation memory 和 semantic memory，同时避免把每次运行都变成永久 transcript。

### [第 13 章：安全](./13-security.md)
限制文件系统访问范围，沙箱化 shell 执行，并防御来自工具结果的 prompt injection。

### [第 14 章：工具系统](./14-tooling.md)
限制工具结果大小，并行运行安全工具，并测试真实集成。包含一个 [tool orchestration reference](./14a-tool-orchestration-reference.md)。

## Part IV：Agent 架构

### [第 15 章：Agent Planning](./15-agent-planning.md)
加入 plan/build mode、审批流和 read-only planning enforcement，让 agent 的工作更有意图。

### [第 16 章：Subagents](./16-subagents.md)
把边界清晰的任务委派给专门的 subagent，更接近 OpenCode 和 Claude Code 的架构。

## Phase 2

Phase 1 到第 16 章结束。关于 sessions、diff-based editing、permission rules、advanced shell execution、MCP/plugins、provider profiles、context engines、production UI、advanced subagents 和 fixture-based evals 的草稿章节，会先保留到 Phase 2。

计划中的下一阶段请查看 repo 根目录的 `ROADMAP.md`。

---

## 如何阅读这本书

每一章都会建立在前一章之上。你会从 `npm init` 开始，一行一行写代码，最后得到一个可以运行的 CLI agent。

代码块会展示你需要输入的内容。当我们修改已有文件时，会展示完整的更新版本，让你始终清楚当前文件应该是什么样子。

完成后，你的项目结构会像这样：

```
agents-v2/
├── src/
│   ├── agent/
│   │   ├── run.ts              # Core agent loop
│   │   ├── executeTool.ts      # Tool dispatcher
│   │   ├── tools/
│   │   │   ├── index.ts        # Tool registry
│   │   │   ├── file.ts         # File operations
│   │   │   ├── shell.ts        # Shell commands
│   │   │   ├── webSearch.ts    # Web search
│   │   │   └── codeExecution.ts # Code runner
│   │   ├── context/
│   │   │   ├── index.ts        # Context exports
│   │   │   ├── tokenEstimator.ts
│   │   │   ├── compaction.ts
│   │   │   └── modelLimits.ts
│   │   └── system/
│   │       ├── prompt.ts       # System prompt
│   │       └── filterMessages.ts
│   ├── ui/
│   │   ├── App.tsx             # Main terminal app
│   │   ├── index.tsx           # UI exports
│   │   └── components/
│   │       ├── MessageList.tsx
│   │       ├── ToolCall.tsx
│   │       ├── ToolApproval.tsx
│   │       ├── Input.tsx
│   │       ├── TokenUsage.tsx
│   │       └── Spinner.tsx
│   ├── types.ts
│   ├── index.ts
│   └── cli.ts
├── evals/
│   ├── types.ts
│   ├── evaluators.ts
│   ├── executors.ts
│   ├── utils.ts
│   ├── mocks/tools.ts
│   ├── file-tools.eval.ts
│   ├── shell-tools.eval.ts
│   ├── agent-multiturn.eval.ts
│   └── data/
│       ├── file-tools.json
│       ├── shell-tools.json
│       └── agent-multiturn.json
├── package.json
└── tsconfig.json
```

开始吧。
