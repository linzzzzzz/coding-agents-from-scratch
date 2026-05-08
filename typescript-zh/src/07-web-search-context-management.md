# 第 7 章：网页搜索与上下文管理

## 两个问题，一章解决

这一章处理两个相关问题：

1. **Web Search** — Agent 目前只能处理本地文件。我们需要给它访问互联网的能力。
2. **Context Management** — 随着对话变长，我们会超过模型的 context window。我们需要追踪 token 使用量，并压缩旧对话。

这两个问题相关，因为网页搜索结果可能很大，会更快消耗上下文窗口。

## 添加网页搜索

OpenAI 提供原生 web search 工具，但很多 OpenAI-compatible Chat Completions provider 并不暴露 AI SDK 的 provider tool。为了走 provider-compatible 路径，我们会把 web search 构建成普通本地工具，由我们的代码调用搜索 API。

把搜索 API key 加到 `.env`：

```env
EXA_API_KEY=your-exa-api-key-here
```

创建 `src/agent/tools/webSearch.ts`：

```typescript
import { tool } from "ai";
import { z } from "zod";

/**
 * Provider-agnostic web search tool.
 * Requires an Exa API key in EXA_API_KEY.
 */
export const webSearch = tool({
  description:
    "Search the web for current information. Use this when the answer depends on recent or external information.",
  inputSchema: z.object({
    query: z.string().describe("The web search query"),
  }),
  execute: async ({ query }: { query: string }) => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return "Error: Missing EXA_API_KEY. Add it to .env to enable web search.";
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
        contents: {
          highlights: {
            numSentences: 3,
          },
        },
      }),
    });

    if (!response.ok) {
      return `Error searching web: ${response.status} ${response.statusText}`;
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        publishedDate?: string;
        highlights?: string[];
        text?: string;
      }>;
    };

    const results = data.results ?? [];
    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    return results
      .map((result, index) =>
        [
          `${index + 1}. ${result.title ?? "Untitled"}`,
          result.url,
          result.publishedDate ? `Published: ${result.publishedDate}` : undefined,
          result.highlights?.join("\n") ?? result.text,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
  },
});
```

这是一个普通本地工具，所以 agent loop 可以执行搜索请求，并把文本结果返回给模型。

### Provider Tools vs. Local Tools

Provider tools 和我们的 local tools 有本质区别。对于 `readFile`，LLM 说“调用 readFile”，然后我们的代码运行 `fs.readFile()`。对于这个 provider-compatible `webSearch`，流程类似：

1. 我们的代码告诉模型 `webSearch` 可用
2. LLM 决定要搜索
3. **我们的工具代码调用 Exa**
4. 搜索结果作为 tool result 返回
5. LLM 处理结果并继续

因为这个版本是 local tool，我们能看到原始搜索结果，`executeTool` 也可以在模型请求后执行它。如果以后添加 OpenAI-native tools，provider-tool 检查仍然重要：

```typescript
const execute = tool.execute;
if (!execute) {
  // Provider tools are executed by the model provider, not us
  return `Provider tool ${name} - executed by model provider`;
}
```

### 更新 Registry

把 web search 加到 `src/agent/tools/index.ts`：

```typescript
import { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
import { webSearch } from "./webSearch.ts";

export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
  webSearch,
};

export { readFile, writeFile, listFiles, deleteFile } from "./file.ts";
export { webSearch } from "./webSearch.ts";

export const fileTools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};
```

## 过滤不兼容消息

Provider tools 可能返回一些再次发送给 API 时会出问题的 message formats。Web search results 可能包含 annotation objects 或特殊 content types，而 API 不接受它们作为后续输入。

创建 `src/agent/system/filterMessages.ts`：

```typescript
import type { ModelMessage } from "ai";

/**
 * Filter conversation history to only include compatible message formats.
 * Provider tools may return messages with formats that
 * cause issues when passed back to subsequent API calls.
 */
export const filterCompatibleMessages = (
  messages: ModelMessage[],
): ModelMessage[] => {
  return messages.filter((msg) => {
    // Keep user messages. Add system prompts fresh for each run.
    if (msg.role === "user") {
      return true;
    }

    // Keep assistant messages that have text content
    if (msg.role === "assistant") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        return true;
      }
      // Check for array content with text parts
      if (Array.isArray(content)) {
        const hasTextContent = content.some((part: unknown) => {
          if (typeof part === "string" && part.trim()) return true;
          if (typeof part === "object" && part !== null && "text" in part) {
            const textPart = part as { text?: string };
            return textPart.text && textPart.text.trim();
          }
          return false;
        });
        return hasTextContent;
      }
    }

    // Keep tool messages
    if (msg.role === "tool") {
      return true;
    }

    return false;
  });
};
```

这个 filter 会移除空的 assistant messages，因为 provider tools 有时会生成这种消息，同时保留持久 conversation history。System prompts 每次运行都会重新添加，所以不应该来自保存的 history。

## Token 估算

现在处理 context management。第一步是知道我们用了多少 token。

精确 tokenization 需要 model-specific tokenizer。但对我们的目的来说，近似值已经够用。通常英文文本中，一个 token 大约是 3.5 到 4 个字符。

创建 `src/agent/context/tokenEstimator.ts`：

```typescript
import type { ModelMessage } from "ai";

/**
 * Estimate token count from text using simple character division.
 * Uses 3.75 as the divisor (midpoint of 3.5-4 range).
 * This is an approximation - not exact tokenization.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.75);
}

/**
 * Extract text content from a message.
 * Handles different message content formats (string, array, objects).
 */
export function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ("text" in part && typeof part.text === "string") return part.text;
        if ("value" in part && typeof part.value === "string") return part.value;
        if ("output" in part && typeof part.output === "object" && part.output) {
          const output = part.output as Record<string, unknown>;
          if ("value" in output && typeof output.value === "string") {
            return output.value;
          }
        }
        // Fallback: stringify the part
        return JSON.stringify(part);
      })
      .join(" ");
  }

  return JSON.stringify(message.content);
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Estimate token counts for an array of messages.
 * Separates input (user, system, tool) from output (assistant) tokens.
 */
export function estimateMessagesTokens(messages: ModelMessage[]): TokenUsage {
  let input = 0;
  let output = 0;

  for (const message of messages) {
    const text = extractMessageText(message);
    const tokens = estimateTokens(text);

    if (message.role === "assistant") {
      output += tokens;
    } else {
      // system, user, tool messages count as input
      input += tokens;
    }
  }

  return {
    input,
    output,
    total: input + output,
  };
}
```

`extractMessageText` 会处理 AI SDK 中多种 message content formats：

- 简单字符串
- text parts 数组
- 带嵌套 `output.value` 字段的 tool result objects

我们把 input 和 output tokens 分开，因为它们通常有不同限制和价格。

## Model Limits

创建 `src/agent/context/modelLimits.ts`：

```typescript
import type { ModelLimits } from "../../types.ts";

/**
 * Default threshold for context window usage (80%)
 */
export const DEFAULT_THRESHOLD = 0.8;

/**
 * Model limits registry
 */
const MODEL_LIMITS: Record<string, ModelLimits> = {
  "qwen3.5-flash-2026-02-23": {
    inputLimit: 1000000,
    outputLimit: 66000,
    contextWindow: 1000000,
  },
};

/**
 * Default limits used when model is not found in registry
 */
const DEFAULT_LIMITS: ModelLimits = {
  inputLimit: 1000000,
  outputLimit: 16000,
  contextWindow: 1000000,
};

/**
 * Get token limits for a specific model.
 * Falls back to default limits if model not found.
 */
export function getModelLimits(model: string): ModelLimits {
  // Direct match
  if (MODEL_LIMITS[model]) {
    return MODEL_LIMITS[model];
  }

  // Check for variants
  if (model.startsWith("qwen")) {
    return MODEL_LIMITS["qwen3.5-flash-2026-02-23"];
  }

  return DEFAULT_LIMITS;
}

/**
 * Check if token usage exceeds the threshold
 */
export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return totalTokens > contextWindow * threshold;
}

/**
 * Calculate usage percentage
 */
export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return (totalTokens / contextWindow) * 100;
}
```

80% threshold 给我们留出缓冲。我们不想刚好撞到 context limit，因为那会导致截断或 API 错误。80% 时就 compact，可以给下一次回复留空间。

## 对话压缩

当对话太长时，我们会总结它。创建 `src/agent/context/compaction.ts`：

```typescript
import { generateText, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { extractMessageText } from "./tokenEstimator.ts";

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation so far that preserves:

1. Key decisions and conclusions reached
2. Important context and facts mentioned
3. Any pending tasks or questions
4. The overall goal of the conversation

Be concise but complete. The summary should allow the conversation to continue naturally.

Conversation to summarize:
`;

/**
 * Format messages array as readable text for summarization
 */
function messagesToText(messages: ModelMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      const content = extractMessageText(msg);
      return `[${role}]: ${content}`;
    })
    .join("\n\n");
}

/**
 * Compact a conversation by summarizing it with an LLM.
 *
 * Takes the current messages (excluding system prompt) and returns a new
 * messages array with:
 * - A user message containing the summary
 * - An assistant acknowledgment
 *
 * The system prompt should be prepended by the caller.
 */
export async function compactConversation(
  messages: ModelMessage[],
  model: string = process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23",
): Promise<ModelMessage[]> {
  // Filter out system messages - they're handled separately
  const conversationMessages = messages.filter((m) => m.role !== "system");

  if (conversationMessages.length === 0) {
    return [];
  }

  const conversationText = messagesToText(conversationMessages);

  const { text: summary } = await generateText({
    model: provider.chat(model),
    prompt: SUMMARIZATION_PROMPT + conversationText,
  });

  // Create compacted messages
  const compactedMessages: ModelMessage[] = [
    {
      role: "user",
      content: `[CONVERSATION SUMMARY]\nThe following is a summary of our conversation so far:\n\n${summary}\n\nPlease continue from where we left off.`,
    },
    {
      role: "assistant",
      content:
        "I understand. I've reviewed the summary of our conversation and I'm ready to continue. How can I help you next?",
    },
  ];

  return compactedMessages;
}
```

压缩策略：

1. 把所有 messages 转成可读文本
2. 用 summarization prompt 发给 LLM
3. 用 summary + acknowledgment 替换整段对话

压缩后的 conversation 只有两条 messages，比原来少得多。代价是：agent 会丢失早期对话的一些细节。但它可以继续工作，而不是撞上 context limit。

### Export Barrel

创建 `src/agent/context/index.ts`：

```typescript
// Token estimation
export {
  estimateTokens,
  estimateMessagesTokens,
  extractMessageText,
  type TokenUsage,
} from "./tokenEstimator.ts";

// Model limits registry
export {
  DEFAULT_THRESHOLD,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
} from "./modelLimits.ts";

// Conversation compaction
export { compactConversation } from "./compaction.ts";
```

## 把 Context Management 接入 Agent Loop

现在更新 `src/agent/run.ts`，让它使用 context management。关键变化：

1. 每次运行前过滤不兼容 messages
2. 开始前检查 token usage
3. 超过 threshold 时执行 compaction
4. 向 UI 报告 token usage

下面是更新后的 `runAgent` 开头：

```typescript
import {
  estimateMessagesTokens,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
  compactConversation,
  DEFAULT_THRESHOLD,
} from "./context/index.ts";
import { filterCompatibleMessages } from "./system/filterMessages.ts";

function withoutSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((message) => message.role !== "system");
}

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> {
  const modelLimits = getModelLimits(MODEL_NAME);

  // Filter and check if we need to compact
  let workingHistory = withoutSystemMessages(
    filterCompatibleMessages(conversationHistory),
  );
  const preCheckTokens = estimateMessagesTokens([
    { role: "system", content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: "user", content: userMessage },
  ]);

  if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
    workingHistory = await compactConversation(workingHistory, MODEL_NAME);
  }

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: "user", content: userMessage },
  ];

  // Report token usage throughout the loop
  const reportTokenUsage = () => {
    if (callbacks.onTokenUsage) {
      const usage = estimateMessagesTokens(messages);
      callbacks.onTokenUsage({
        inputTokens: usage.input,
        outputTokens: usage.output,
        totalTokens: usage.total,
        contextWindow: modelLimits.contextWindow,
        threshold: DEFAULT_THRESHOLD,
        percentage: calculateUsagePercentage(
          usage.total,
          modelLimits.contextWindow,
        ),
      });
    }
  };

  reportTokenUsage();

  // ... rest of the loop (same as before, but call reportTokenUsage()
  //     after each tool result is added to messages)
```

## 它们如何组合在一起

长对话的流程大概是：

```
Turn 1: User asks a question → Agent responds → 500 tokens used
Turn 2: User asks follow-up → Agent uses 3 tools → 2,000 tokens used
Turn 3: More tools → 5,000 tokens used
...
Turn 20: 300,000 tokens used (75% of 400k context window)
Turn 21: 330,000 tokens used (82.5% — over 80% threshold!)
  → Agent compacts: summarizes entire conversation into ~500 tokens
  → Conversation resets to summary + acknowledgment
Turn 22: Fresh context with full summary → 1,000 tokens used
```

用户不会明显感觉到变化。Agent 通过 summary 保持上下文，并继续工作。这就像人在长会议里记笔记：你不可能记住每一句话，但会保留关键点。

## 测试第 7 章

你可以用四个快速检查测试本章：直接 Exa 连通性、web search 行为、token reporting，以及强制 compaction。

### 1. 检查 Exa 连通性

在测试完整 agent 前，先确认 API key 可用：

```bash
node --env-file=.env -e '
const response = await fetch("https://api.exa.ai/search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.EXA_API_KEY,
  },
  body: JSON.stringify({
    query: "latest TypeScript release",
    type: "auto",
    numResults: 2,
    contents: { highlights: { numSentences: 2 } },
  }),
});

console.log(response.status, response.statusText);
console.log(await response.text());
'
```

你应该看到 `200 OK`，以及包含 `results` array 的 JSON response。

### 2. 手动测试 Web Search

如果你的 `src/index.ts` 仍然使用 hardcoded prompt，把传给 `runAgent()` 的字符串改成：

```typescript
await runAgent(
  "Search the web for the latest TypeScript release and summarize what changed.",
  history,
  {
    // callbacks...
  },
);
```

然后运行 agent：

```bash
npm run start
```

预期行为：

1. 模型调用 `webSearch`
2. 工具返回 Exa results
3. 模型使用这些结果回答

如果看到 `Missing EXA_API_KEY`，把 `EXA_API_KEY` 加到 `.env`，然后重启进程。

### 3. 手动测试 Context Reporting

要看到 token count 增长，`src/index.ts` 需要运行多轮，并复用返回的 history。把单个 `runAgent()` 调用替换成这个两轮测试：

```typescript
let history: ModelMessage[] = [];

const prompts = [
  "Search the web for three recent AI agent frameworks and compare them.",
  "Search for recent documentation about one of those frameworks and explain the install steps.",
];

for (const [index, prompt] of prompts.entries()) {
  console.log(`\n=== Turn ${index + 1} ===`);

  history = await runAgent(prompt, history, {
    // callbacks...
  });
}
```

关键行是：

```typescript
history = await runAgent(prompt, history, callbacks);
```

第一轮从空 history 开始。第二轮接收第一轮返回的 durable messages，所以估算 token count 应该明显变大。每次运行的 system prompt 会在 `runAgent()` 内部重新添加，不会保存到 `history`。

运行：

```bash
npm run start
```

如果 UI 渲染了 `callbacks.onTokenUsage`，你应该能看到 token usage updates。例如第一轮 token 数可能较小，第二轮会跳高，因为它包含第一轮回复和 web search results。

具体 token 数只是近似值，因为估算器基于字符数。真正重要的是：随着对话增长，数字会增加。

### 4. 强制测试 Compaction

等待真实对话撞到 1M-token context window 的 80% 不现实。临时调低 `src/agent/context/modelLimits.ts` 的 limits：

```typescript
const DEFAULT_LIMITS: ModelLimits = {
  inputLimit: 2000,
  outputLimit: 1000,
  contextWindow: 2000,
};
```

然后运行：

```bash
npm run start
```

要求几次长回复或网页搜索。一旦估算 usage 超过 threshold，`compactConversation()` 应该运行，并用 summary 替换旧 messages。

测试结束后，把 limits 改回真实模型值。

## 小结

这一章你完成了：

- 添加 web search 作为本地工具，让它可以配合 OpenAI-compatible chat models 工作
- 构建 message filtering，处理 provider tool compatibility
- 实现 token 估算和 context window tracking
- 通过 LLM summarization 创建 conversation compaction
- 把 context management 接入 agent loop

Agent 现在可以搜索网页，并处理任意长度的对话。下一章，我们会添加 shell command execution。

---

**下一章：[第 8 章：Shell 工具与代码执行 →](./08-shell-tool.md)**
