# Chapter 1: Introduction to AI Agents

> 💻 **Code:** start from the [`lesson-01`](https://github.com/Hendrixer/agents-v2/tree/lesson-01) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## What is an AI Agent?

A chatbot takes your message, sends it to an LLM, and returns the response. That's one turn — input in, output out.

An **agent** is different. An agent can:

1. **Decide** it needs more information
2. **Use tools** to get that information
3. **Reason** about the results
4. **Repeat** until the task is complete

The key difference is the **loop**. A chatbot is a single function call. An agent is a loop that keeps running until the job is done. The LLM doesn't just generate text — it decides what actions to take, observes the results, and plans its next move.

Here's the mental model:

```
User: "What files are in my project?"

Chatbot: "I can't see your files, but typically a project has..."

Agent:
  → Thinks: "I need to list the files"
  → Calls: listFiles(".")
  → Gets: ["package.json", "src/", "README.md"]
  → Responds: "Your project has package.json, a src/ directory, and a README.md"
```

The agent used a **tool** to actually look at the filesystem, then synthesized the result into a response. That's the fundamental pattern we'll build in this book.

## What We're Building

By the end of this book, you'll have a CLI AI agent that runs in your terminal. It will be able to:

- Have multi-turn conversations
- Read and write files
- Run shell commands
- Search the web
- Execute code
- Ask for your permission before doing anything dangerous
- Manage long conversations without running out of context

It's a miniature version of tools like Claude Code or GitHub Copilot in the terminal — and you'll understand every line of code because you wrote it.

## Project Setup

Let's start from zero.

### Initialize the Project

```bash
mkdir agents-v2
cd agents-v2
npm init -y
```

### Install Dependencies

We need a few key packages:

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

Here's what each does:

| Package | Purpose |
|---------|---------|
| `ai` | Vercel's AI SDK — unified interface for LLM calls, streaming, tool calling |
| `@ai-sdk/openai` | OpenAI-compatible provider for the AI SDK |
| `react` + `ink` | React renderer for the terminal (like React Native, but for CLI) |
| `zod` | Schema validation — used to define tool parameter shapes |
| `shelljs` | Cross-platform shell command execution |
| `@lmnr-ai/lmnr` | Laminar — observability and structured evaluations |

### Configure TypeScript

Create `tsconfig.json`:

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

Key choices:
- **`jsx: "react-jsx"`** — We'll use React for our terminal UI later
- **`moduleResolution: "bundler"`** — Allows `.ts` imports
- **`strict: true`** — Full type safety
- **`module: "Preserve"`** — Don't transform imports

### Configure package.json

Update your `package.json` to add the `type` field and scripts:

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

Here's what each script does:

| Script | Purpose |
|--------|---------|
| `build` | Compile TypeScript to `dist/` for distribution |
| `dev` | Run the agent in watch mode (auto-restarts on file changes) |
| `start` | Run the agent once |
| `eval` | Run all evaluation files |
| `eval:file-tools` | Run file tool selection evals (Chapter 3) |
| `eval:shell-tools` | Run shell tool selection evals (Chapter 8) |
| `eval:agent` | Run multi-turn agent evals (Chapter 5) |

The `--env-file=.env` flag tells Node/tsx to load environment variables from the `.env` file automatically.

The `"type": "module"` is important — it enables ES modules so we can use `import/export` syntax.

The `"bin"` field lets users install the agent globally with `npm install -g` and run it as `agi` from anywhere.

### Build Configuration

The eval and dev scripts don't need a separate build step (tsx handles TypeScript directly), but for distributing the agent as an npm package, create `tsconfig.build.json`:

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

This extends the base tsconfig but enables emitting compiled JavaScript to `dist/`.

### Environment Variables

Create a `.env` file with all the API keys you'll need throughout the book:

```
LLM_API_KEY=your-api-key-here
LLM_MODEL=qwen3.5-flash-2026-02-23
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LMNR_API_KEY=your-laminar-api-key-here
```

- **`LLM_API_KEY`** — Required. Use an API key from OpenAI or another OpenAI-compatible provider.
- **`LLM_MODEL`** — Required. The model name to call.
- **`LLM_BASE_URL`** — Required for non-default providers. For OpenAI directly, leave this unset. For another compatible provider, set it to that provider's API base URL, usually ending in `/v1`.
- **`LMNR_API_KEY`** — Optional but recommended. Get one from [laminar.ai](https://www.lmnr.ai). Used for running evaluations in Chapters 3, 5, and 8. Evals will still run locally without it, but results won't be tracked over time.

And add it to `.gitignore`:

```
node_modules
dist
.env
```

### Create the Directory Structure

```bash
mkdir -p src/agent/tools
mkdir -p src/agent/system
mkdir -p src/agent/context
mkdir -p src/ui/components
```

## Your First LLM Call

Let's make sure everything works. Create `src/index.ts`:

> Prefer the original OpenAI-only setup? It is preserved in [`01-intro-to-agents.original-openai.md`](./01-intro-to-agents.original-openai.md).

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

Run it:

```bash
npm run start
```

You should see something like:

```
An AI agent is an autonomous system that perceives its environment,
makes decisions, and takes actions to achieve specific goals.
```

That's a single LLM call. No tools, no loop, no agent — yet.

## Understanding the AI SDK

The Vercel AI SDK (`ai` package) is the foundation we'll build on. It provides:

- **`generateText()`** — Make a single LLM call and get the full response
- **`streamText()`** — Stream tokens as they're generated (we'll use this for the agent)
- **`tool()`** — Define tools the LLM can call
- **`generateObject()`** — Get structured JSON output (we'll use this for evals)

The SDK abstracts away the provider-specific details. We use `@ai-sdk/openai` as our provider because it works with OpenAI and with many OpenAI-compatible APIs. The `.chat(...)` call is intentional: it uses the Chat Completions API, which is the endpoint most OpenAI-compatible vendors support. If you use OpenAI directly, leave `LLM_BASE_URL` unset. If you use another compatible provider, set `LLM_BASE_URL` to that provider's API base URL and set `LLM_MODEL` to one of its model names.

## Adding a System Prompt

Agents need personality and guidelines. Create `src/agent/system/prompt.ts`:

```typescript
export const SYSTEM_PROMPT = `You are a helpful AI assistant. You provide clear, accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question`;
```

This is intentionally simple. The system prompt tells the LLM how to behave. In production agents, this would include detailed instructions about tool usage, safety guidelines, and response formatting. Ours will grow as we add features.

## Defining Types

Create `src/types.ts` with the core interfaces we'll need:

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

These interfaces define the contract between our agent core and the UI layer:

- **`AgentCallbacks`** — How the agent communicates back to the UI (streaming tokens, tool calls, completions)
- **`ToolCallInfo`** — Metadata about a tool the LLM wants to call
- **`ModelLimits`** — Token limits for context management
- **`TokenUsageInfo`** — Current token usage for display

We won't use all of these immediately, but defining them now gives us a clear picture of where we're headed.

## Summary

In this chapter you:

- Learned what makes an agent different from a chatbot (the loop)
- Set up a TypeScript project with the AI SDK
- Made your first LLM call
- Created the system prompt and core type definitions

The project doesn't do much yet — it's just a single LLM call. In the next chapter, we'll teach it to use tools.

---

**Next: [Chapter 2: Tool Calling →](./02-tool-calling.md)**
