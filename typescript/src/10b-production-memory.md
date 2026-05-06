# Production Memory

Conversation memory and semantic memory let the agent carry useful context across turns and sessions without stuffing every old message back into the prompt.

---

## 2. Persistent Memory

### The Problem

Every conversation starts from zero. The agent can't remember that you prefer TypeScript over JavaScript, that your project uses pnpm, or that you asked it to always run tests after editing files.

### The Fix

There are two types of memory:

**Conversation memory** — Save and load conversation histories.

Create a memory helper:

**Edit `src/agent/memory.ts`:**

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

Then use it from the UI.

**Edit `src/ui/App.tsx`:**

```typescript
import React, { useState, useCallback, useEffect } from "react";
import { loadConversation, saveConversation } from "../agent/memory.ts";
```

Inside `App`, load a default conversation once:

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

After `runAgent()` returns, save the updated history:

```typescript
setConversationHistory(newHistory);
await saveConversation("default", newHistory);
```

`newHistory` should be durable conversation history only. Do not persist the per-run system prompt, because the agent adds a fresh system prompt every time `runAgent()` starts.

Now the flow is:

```txt
npm run start
  -> load .agent/conversations/default.json if it exists
  -> continue the old conversation
  -> after each turn, save the updated ModelMessage[] history
```

This `default` conversation is the simplest learning version: every app launch continues the same saved conversation. Production agents usually go one step further:

```txt
New session:
  create .agent/conversations/<session-id>.json

Resume session:
  load .agent/conversations/<session-id>.json only when the user asks to resume

Cross-session memory:
  store durable preferences/facts separately in semantic memory
```

That keeps conversation history scoped to a session, while semantic memory carries durable context across sessions.

### Manual Test

Run the app:

```bash
npm run start
```

Say:

```txt
Remember that I prefer TypeScript examples.
```

Exit the app, then start it again:

```bash
npm run start
```

Ask:

```txt
What programming language do I prefer for examples?
```

The agent should be able to answer from the reloaded conversation history. You can also inspect the saved file directly:

```bash
cat .agent/conversations/default.json
```

To reset memory:

```bash
rm .agent/conversations/default.json
```

**Semantic memory** — Long-term facts extracted from conversations.

This comes later. If you want a minimal version, keep it in the same memory file and store extracted facts in `.agent/memories.json`.

**Edit `src/agent/memory.ts`:**

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

After a conversation finishes, call the throttled helper from the UI, right after saving conversation history.

**Edit `src/ui/App.tsx`:**

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

This gives you a simple throttle. With the default value of `3`, the agent saves conversation history every turn, but only runs the extra memory-extraction LLM call every third turn. Set `MEMORY_EXTRACT_EVERY_N_TURNS=1` if you want to test extraction after every turn.

Before a future model call, inject the saved memories into the system prompt. This belongs in the agent runner, because `run.ts` builds the messages that are sent to the LLM.

**Edit `src/agent/run.ts`:**

First import `loadMemories`:

```typescript
import { loadMemories } from "./memory.ts";
```

Then inside `runAgent`, immediately after this line:

```typescript
const modelLimits = getModelLimits(MODEL_NAME);
```

add:

```typescript
const memories = await loadMemories();
const memoryText = memories.map((memory) => `- ${memory.content}`).join("\n");

const systemPrompt = memoryText
  ? `${SYSTEM_PROMPT}

Known user memories:
${memoryText}`
  : SYSTEM_PROMPT;
```

Then replace the existing `SYSTEM_PROMPT` message content with `systemPrompt` in both places:

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

Keep this `systemPrompt` ephemeral: use it for token estimation and the current model call, but return/save conversation history without `system` messages.

### Minimal Test

For testing, make semantic extraction run after every turn:

```env
MEMORY_EXTRACT_EVERY_N_TURNS=1
```

Start clean:

```bash
rm -f .agent/memories.json
```

Run the app:

```bash
npm run start
```

Say something explicit:

```txt
Remember that I prefer TypeScript examples over Python examples.
```

After the response finishes, exit the app and inspect the memory file:

```bash
cat .agent/memories.json
```

You should see a saved memory similar to:

```json
[
  {
    "content": "The user prefers TypeScript examples over Python examples.",
    "category": "preference",
    "createdAt": "..."
  }
]
```

Then start the app again and ask:

```txt
If you show a code example, which language should you choose?
```

Expected result: the agent should answer TypeScript, because `run.ts` loads `.agent/memories.json` and injects those memories into the system prompt.

This is intentionally simple. Real semantic memory usually adds deduplication, user review, and relevance search before injecting memories into the prompt.

### Going Further

- Use vector embeddings for semantic search over memories
- Add memory decay — recent memories are weighted higher
- Let users view, edit, and delete stored memories
- Separate project-level memory from user-level memory

---
