# 第 12 章：记忆

对话记忆和语义记忆可以让 agent 在多个 turn 和多个 session 之间携带有用上下文，而不需要把所有旧消息都塞回 prompt。

---

## 持久化记忆

### 问题

每次对话都从零开始。agent 记不住你更喜欢 TypeScript 而不是 JavaScript，记不住你的项目使用 pnpm，也记不住你要求它每次编辑文件后都运行测试。

### 修复

这里有两类记忆：

**对话记忆**：保存并加载对话历史。

创建一个 memory helper：

**编辑 `src/agent/memory.ts`：**

```typescript
import fs from "fs/promises";
import path from "path";
import type { ModelMessage } from "ai";

const MEMORY_DIR = path.join(process.cwd(), ".agent", "conversations");

export async function saveConversation(
  id: string,
  messages: ModelMessage[],
): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  await fs.writeFile(
    path.join(MEMORY_DIR, `${id}.json`),
    JSON.stringify(messages, null, 2),
  );
}

export async function loadConversation(id: string): Promise<ModelMessage[] | null> {
  try {
    const data = await fs.readFile(path.join(MEMORY_DIR, `${id}.json`), "utf-8");
    return JSON.parse(data) as ModelMessage[];
  } catch {
    return null;
  }
}
```

然后在 UI 里使用它。

**编辑 `src/ui/App.tsx`：**

```typescript
import React, { useState, useCallback, useEffect } from "react";
import { loadConversation, saveConversation } from "../agent/memory.ts";
```

在 `App` 内部，只加载一次默认对话：

```typescript
useEffect(() => {
  async function loadMemory() {
    const savedHistory = await loadConversation("default");

    if (savedHistory) {
      setConversationHistory(savedHistory);
    }
  }

  void loadMemory();
}, []);
```

`runAgent()` 返回后，保存更新后的 history：

```typescript
setConversationHistory(newHistory);
await saveConversation("default", newHistory);
```

`newHistory` 应该只包含持久化对话历史。不要持久化每次运行时的 system prompt，因为 agent 每次启动 `runAgent()` 时都会加入一个新的 system prompt。

现在流程是：

```txt
npm run start
  -> 如果存在，加载 .agent/conversations/default.json
  -> 继续旧对话
  -> 每个 turn 结束后，保存更新后的 ModelMessage[] history
```

这个 `default` conversation 是最简单的学习版本：每次启动应用都会继续同一段已保存对话。生产级 agents 通常会再往前走一步：

```txt
New session:
  create .agent/conversations/<session-id>.json

Resume session:
  load .agent/conversations/<session-id>.json only when the user asks to resume

Cross-session memory:
  store durable preferences/facts separately in semantic memory
```

这样可以让对话历史只属于某个 session，而语义记忆负责跨 session 携带持久上下文。

### 手动测试

运行应用：

```bash
npm run start
```

输入：

```txt
Remember that I prefer TypeScript examples.
```

退出应用，然后重新启动：

```bash
npm run start
```

再问：

```txt
What programming language do I prefer for examples?
```

agent 应该能从重新加载的对话历史中回答。你也可以直接查看保存文件：

```bash
cat .agent/conversations/default.json
```

重置记忆：

```bash
rm .agent/conversations/default.json
```

**语义记忆**：从对话中提取出来的长期事实。

这会稍后用到。如果你想先做一个最小版本，可以把它放在同一个 memory 文件里，并把提取出来的事实存到 `.agent/memories.json`。

**编辑 `src/agent/memory.ts`：**

```typescript
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const memoryProvider = createOpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const MEMORY_MODEL = process.env.LLM_MODEL ?? "qwen3.5-flash-2026-02-23";
const MEMORY_EXTRACT_EVERY_N_TURNS = Number(
  process.env.MEMORY_EXTRACT_EVERY_N_TURNS ?? 3,
);

let turnsSinceMemoryExtraction = 0;

export interface MemoryEntry {
  content: string;
  category: "preference" | "fact" | "instruction";
  createdAt: string;
}

const SEMANTIC_MEMORY_FILE = path.join(process.cwd(), ".agent", "memories.json");

export async function loadMemories(): Promise<MemoryEntry[]> {
  try {
    const data = await fs.readFile(SEMANTIC_MEMORY_FILE, "utf-8");
    return JSON.parse(data) as MemoryEntry[];
  } catch {
    return [];
  }
}

export async function saveMemories(memories: MemoryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(SEMANTIC_MEMORY_FILE), { recursive: true });
  await fs.writeFile(SEMANTIC_MEMORY_FILE, JSON.stringify(memories, null, 2));
}

function dedupeMemories(memories: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = `${memory.category}:${memory.content.toLowerCase().trim()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function extractMemories(
  conversationText: string,
): Promise<MemoryEntry[]> {
  const { object } = await generateObject({
    model: memoryProvider.chat(MEMORY_MODEL),
    schema: z.object({
      entries: z.array(
        z.union([
          z.string(),
          z.object({
            content: z.string(),
            category: z.enum(["preference", "fact", "instruction"]),
          }),
        ]),
      ),
    }),
    prompt: `Extract durable user memories from this conversation.
Return JSON that matches the schema exactly.
The top-level JSON object must use the key "entries" exactly.
Each entry must be either a string or an object with content and category.
Do not use "memories" or any other top-level key.

Example JSON:
{
  "entries": [
    { "content": "The user prefers TypeScript examples.", "category": "preference" }
  ]
}

Conversation:
${conversationText}`,
  });

  return object.entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        content: entry,
        category: "fact" as const,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      ...entry,
      createdAt: new Date().toISOString(),
    };
  });
}

export async function updateMemoriesIfNeeded(
  conversationText: string,
): Promise<void> {
  turnsSinceMemoryExtraction++;

  if (turnsSinceMemoryExtraction < MEMORY_EXTRACT_EVERY_N_TURNS) {
    return;
  }

  turnsSinceMemoryExtraction = 0;

  const existingMemories = await loadMemories();
  const newMemories = await extractMemories(conversationText);
  await saveMemories(dedupeMemories([...existingMemories, ...newMemories]));
}
```

对话结束后，在 UI 里保存 conversation history 之后，调用这个带节流的 helper。

**编辑 `src/ui/App.tsx`：**

```typescript
setConversationHistory(newHistory);
await saveConversation("default", newHistory);

const conversationText = newHistory
  .map((message) =>
    typeof message.content === "string"
      ? `${message.role}: ${message.content}`
      : "",
  )
  .join("\n");

await updateMemoriesIfNeeded(conversationText);
```

这给了你一个简单的 throttle。默认值为 `3` 时，agent 每个 turn 都会保存 conversation history，但每三个 turn 才会额外运行一次 memory extraction LLM 调用。如果你想每个 turn 后都测试提取，可以设置 `MEMORY_EXTRACT_EVERY_N_TURNS=1`。

未来模型调用之前，把保存的 memories 注入 system prompt。这部分应该放在 agent runner 里，因为 `run.ts` 负责构建发送给 LLM 的 messages。

**编辑 `src/agent/run.ts`：**

先导入 `loadMemories`：

```typescript
import { loadMemories } from "./memory.ts";
```

然后在 `runAgent` 内，紧跟下面这一行之后：

```typescript
const modelLimits = getModelLimits(MODEL_NAME);
```

加入：

```typescript
const memories = await loadMemories();
const memoryText = memories.map((memory) => `- ${memory.content}`).join("\n");

const systemPrompt = memoryText
  ? `${SYSTEM_PROMPT}

Known user memories:
${memoryText}`
  : SYSTEM_PROMPT;
```

然后把两个地方原本使用 `SYSTEM_PROMPT` 的 message content 替换成 `systemPrompt`：

```typescript
const preCheckTokens = estimateMessagesTokens([
  { role: "system", content: systemPrompt },
  ...workingHistory,
  { role: "user", content: userMessage },
]);

const messages: ModelMessage[] = [
  { role: "system", content: systemPrompt },
  ...workingHistory,
  { role: "user", content: userMessage },
];
```

保持这个 `systemPrompt` 是临时的：它用于 token estimation 和当前模型调用，但返回 / 保存 conversation history 时不要包含 `system` messages。

### 最小测试

测试时，让 semantic extraction 每个 turn 都运行：

```env
MEMORY_EXTRACT_EVERY_N_TURNS=1
```

从干净状态开始：

```bash
rm -f .agent/memories.json
```

运行应用：

```bash
npm run start
```

输入一个明确的事实：

```txt
Remember that I prefer TypeScript examples over Python examples.
```

响应结束后，退出应用并查看 memory 文件：

```bash
cat .agent/memories.json
```

你应该看到类似下面的已保存 memory：

```json
[
  {
    "content": "The user prefers TypeScript examples over Python examples.",
    "category": "preference",
    "createdAt": "..."
  }
]
```

然后再次启动应用并询问：

```txt
If you show a code example, which language should you choose?
```

预期结果：agent 应该回答 TypeScript，因为 `run.ts` 会加载 `.agent/memories.json` 并把这些 memories 注入 system prompt。

这有意保持简单。真实语义记忆通常会在把 memories 注入 prompt 之前，加入去重、用户 review 和 relevance search。

### 继续加强

- 使用 vector embeddings 对 memories 做语义搜索
- 加入 memory decay，让较新的 memories 权重更高
- 让用户查看、编辑和删除已存储 memories
- 区分 project-level memory 和 user-level memory

---

**下一章：[第 13 章：安全 →](./13-security.md)**
