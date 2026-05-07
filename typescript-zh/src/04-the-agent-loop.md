# 第 4 章：Agent Loop

> 💻 **代码：** 从 [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2) 的 [`lesson-04`](https://github.com/Hendrixer/agents-v2/tree/lesson-04) 分支开始。该分支里的 `notes/` 文件夹包含本章会写到的代码。

## Agent 的心脏

这是本书最重要的一章。前面的内容都是铺垫，后面的内容都会建立在这里之上。

Agent loop 会把语言模型从问答机器变成自主 agent。模式是：

```
while true:
  1. Send messages to LLM (with tools)
  2. Stream the response
  3. If LLM wants to call tools:
     a. Execute each tool
     b. Add results to message history
     c. Continue the loop
  4. If LLM is done (no tool calls):
     a. Break out of the loop
     b. Return the final response
```

什么时候停止由 LLM 决定。它可能先调用一个工具，处理结果，再调用另一个工具，然后用文本回复。也可能在一个 turn 里调用三个工具，处理所有结果后再回复。Loop 会一直运行，直到 LLM 表示“我完成了，这是答案”。

## Streaming vs. Generating

第 2 章里我们用了 `generateText()`，它会等完整回复生成后才返回。这对 evals 可以接受，但用户体验很差。用户希望实时看到 token 出现。

`streamText()` 会返回一个 async iterable，让你在 chunk 到达时逐个处理：

```typescript
const result = streamText({
  model,
  messages,
  tools: modelTools,
});

for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    // A piece of text arrived
    process.stdout.write(chunk.text);
  }
  if (chunk.type === "tool-call") {
    // The LLM wants to call a tool
    console.log(`Tool: ${chunk.toolName}`, chunk.input);
  }
}
```

`fullStream` 会给我们所有信息：text deltas、tool calls、finish reasons 等等。不同 chunk type 需要不同处理方式。

## 构建 Agent Loop

创建 `src/agent/run.ts`：

```typescript
import { streamText, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getTracer } from "@lmnr-ai/lmnr";
import { tools } from "./tools/index.ts";
import { executeTool } from "./executeTool.ts";
import { SYSTEM_PROMPT } from "./system/prompt.ts";
import { Laminar } from "@lmnr-ai/lmnr";
import type { AgentCallbacks, ToolCallInfo } from "../types.ts";

// Initialize Laminar for observability (optional - traces LLM calls)
Laminar.initialize({
  projectApiKey: process.env.LMNR_API_KEY,
});

const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LLM_API_KEY in .env");
}

const provider = createOpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL,
});

const MODEL_NAME = process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23";

function withoutSystemMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.filter((message) => message.role !== "system");
}

function withoutToolExecutors<T extends Record<string, { execute?: unknown }>>(
  toolSet: T,
): T {
  return Object.fromEntries(
    Object.entries(toolSet).map(([name, toolDef]) => [
      name,
      { ...toolDef, execute: undefined },
    ]),
  ) as T;
}

export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...withoutSystemMessages(conversationHistory),
    { role: "user", content: userMessage },
  ];

  let fullResponse = "";
  const modelTools = withoutToolExecutors(tools);

  while (true) {
    const result = streamText({
      model: provider.chat(MODEL_NAME),
      messages,
      tools: modelTools,
      experimental_telemetry: {
        isEnabled: true,
        tracer: getTracer(),
      },
    });

    const toolCalls: ToolCallInfo[] = [];
    let currentText = "";

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        currentText += chunk.text;
        callbacks.onToken(chunk.text);
      }

      if (chunk.type === "tool-call") {
        const input = "input" in chunk ? chunk.input : {};
        toolCalls.push({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: input as Record<string, unknown>,
        });
        callbacks.onToolCallStart(chunk.toolName, input);
      }
    }

    fullResponse += currentText;

    const finishReason = await result.finishReason;

    // If the LLM didn't request any tool calls, we're done
    if (finishReason !== "tool-calls" || toolCalls.length === 0) {
      const responseMessages = await result.response;
      messages.push(...responseMessages.messages);
      break;
    }

    // Add the assistant's response (with tool call requests) to history
    const responseMessages = await result.response;
    messages.push(...responseMessages.messages);

    // Execute each tool and add results to message history
    for (const tc of toolCalls) {
      const toolResult = await executeTool(tc.toolName, tc.args);
      callbacks.onToolCallEnd(tc.toolName, toolResult);

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: "text", value: toolResult },
          },
        ],
      });
    }
  }

  callbacks.onComplete(fullResponse);

  return withoutSystemMessages(messages);
}
```

我们一步一步看。

### 函数签名

```typescript
export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]>
```

这个函数接收：

- **`userMessage`** — 用户最新输入的消息
- **`conversationHistory`** — 之前所有消息，用于多轮对话
- **`callbacks`** — 通知 UI 的函数，例如 streaming tokens、tool calls 等

它返回更新后的 message history，调用方会把它保存起来，供下一轮对话使用。

### 构造 Messages

```typescript
const messages: ModelMessage[] = [
  { role: "system", content: SYSTEM_PROMPT },
  ...withoutSystemMessages(conversationHistory),
  { role: "user", content: userMessage },
];
```

我们构造完整 message array：一个新的 system prompt、可复用的 conversation history、再加上新的 user message。`withoutSystemMessages()` 会把旧 system prompt 从 history 中移除，因为每次运行都应该只有一个最新的 system prompt。

随着工具被调用，这个数组会继续增长，tool results 会被追加进去。运行结束时，我们返回 `withoutSystemMessages(messages)`，这样下一轮只会拿到可复用的 user、assistant 和 tool messages。

`withoutToolExecutors()` 会复制一份面向模型的 tools，并移除 `execute` 函数。模型仍然能看到工具名、描述和 schema，但 AI SDK 不会自动执行工具。这样工具执行就留在我们的 agent loop 里。

### Loop

```typescript
while (true) {
  const result = streamText({ model, messages, tools: modelTools });
  // ... process stream ...
  
  if (finishReason !== "tool-calls" || toolCalls.length === 0) {
    break; // LLM is done
  }
  
  // Execute tools, add results to messages, loop again
}
```

每次迭代会做这些事：

1. 把当前 messages 和面向模型的 tool schemas 发送给 LLM
2. 流式处理回复，收集文本和工具调用
3. 检查 `finishReason`：
   - `"tool-calls"` → LLM 希望执行工具。执行工具，然后继续 loop。
   - 其他值，例如 `"stop"`、`"length"` → LLM 已完成，退出 loop。

### 工具执行

```typescript
for (const tc of toolCalls) {
  const toolResult = await executeTool(tc.toolName, tc.args);
  callbacks.onToolCallEnd(tc.toolName, toolResult);

  messages.push({
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: { type: "text", value: toolResult },
    }],
  });
}
```

对每个 tool call：

1. 使用第 2 章写的 dispatcher 执行真实工具
2. 通知 UI 工具已经完成
3. 将结果作为 `tool` message 加入 history，并用原始 `toolCallId` 关联起来

`toolCallId` 很关键，它告诉 LLM 这个结果属于哪一次工具调用。没有它，LLM 就无法把结果和请求对应起来。

### Callbacks

Callbacks 模式让 agent logic 和 UI 解耦：

```typescript
callbacks.onToken(chunk.text);      // Stream text to UI
callbacks.onToolCallStart(name, args); // Show tool execution starting
callbacks.onToolCallEnd(name, result); // Show tool result
callbacks.onComplete(fullResponse);    // Signal completion
```

Agent 不需要知道 UI 是终端、网页还是测试 harness。它只需要调用 callbacks。AI SDK 本身也使用类似模式。

## 测试 Loop

用一个简单脚本测试一下。更新 `src/index.ts`：

```typescript
import { runAgent } from "./agent/run.ts";
import type { ModelMessage } from "ai";

const history: ModelMessage[] = [];

const result = await runAgent(
  "What files are in the current directory? Then read the package.json file.",
  history,
  {
    onToken: (token) => process.stdout.write(token),
    onToolCallStart: (name, args) => {
      console.log(`\n[Tool] ${name}`, JSON.stringify(args));
    },
    onToolCallEnd: (name, result) => {
      console.log(`[Result] ${name}: ${result.slice(0, 100)}...`);
    },
    onComplete: () => console.log("\n[Done]"),
    onToolApproval: async () => true, // Auto-approve for now
  },
);

console.log(`\nTotal messages: ${result.length}`);
```

运行：

```bash
npm run start
```

你应该会看到 agent：

1. 调用 `listFiles` 查看目录内容
2. 调用 `readFile` 读取 `package.json`
3. 根据发现的内容生成总结回复

这就是 loop 在工作。LLM 可能跨多个 loop iteration 发起两次工具调用，拿到结果后，再综合成一个连贯回复。

## Message History

Loop 结束后，messages array 大概会长这样：

```
[system]    "You are a helpful AI assistant..."
[user]      "What files are in the current directory? Then read..."
[assistant] (tool call: listFiles)
[tool]      "[dir] node_modules\n[dir] src\n[file] package.json..."
[assistant] (tool call: readFile, text: "Let me read...")
[tool]      "{ \"name\": \"agi\", ... }"
[assistant] "Your project has the following files... The package.json shows..."
```

这就是完整 conversation history。LLM 每次迭代都会看到它，所以才能保持上下文。这也是为什么第 7 章的 context management 很重要：history 会随着每次交互不断变长。

## 错误处理

真实实现应该处理 stream errors。下面是加入错误处理后的增强版本：

```typescript
try {
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
      currentText += chunk.text;
      callbacks.onToken(chunk.text);
    }
    if (chunk.type === "tool-call") {
      const input = "input" in chunk ? chunk.input : {};
      toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        args: input as Record<string, unknown>,
      });
      callbacks.onToolCallStart(chunk.toolName, input);
    }
  }
} catch (error) {
  const streamError = error as Error;
  if (!currentText && !streamError.message.includes("No output generated")) {
    throw streamError;
  }
}
```

如果 stream 出错但我们已经拿到了一些文本，仍然可以使用这些文本。如果错误是 “no output generated” 且没有任何文本，我们可以提供 fallback message。这样 agent 对临时 API 问题会更有韧性。

## 小结

这一章你完成了：

- 用 streaming 构建核心 agent loop
- 理解 stream → detect tool calls → execute → loop 模式
- 使用 callbacks 解耦 agent logic 和 UI
- 处理随着每次工具调用增长的 message history
- 为 stream failures 添加错误处理

这是 agent 的引擎。后面的所有内容，包括更多工具、上下文管理、人工审批，都会插入这个 loop。下一章，我们会构建多轮评测，测试完整 loop。

---

**下一章：[第 5 章：多轮评测 →](./05-multi-turn-evals.md)**
