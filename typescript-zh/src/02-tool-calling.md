# 第 2 章：工具调用

## 工具调用如何工作

Tool calling 是把语言模型变成 agent 的关键机制。流程是这样的：

1. 你向 LLM 描述可用工具，包括名称、描述和参数 schema
2. 用户发送一条消息
3. LLM 决定是直接用文本回复，还是调用某个工具
4. 如果它调用工具，你执行工具，并把结果发回去
5. LLM 使用工具结果生成最终回复

关键洞察是：**LLM 并不会亲自执行工具**。它只会输出结构化 JSON，表达“我想用这些参数调用这个工具”。真正的执行发生在你的代码里。LLM 是大脑，你的代码是手。

这一章里，AI SDK 会帮我们直接调用每个工具的 `execute` 函数。之后当我们构建自己的 agent loop 时，会把模型可见的工具 schema 和真正可执行的工具分开，这样 runtime 就能精确控制工具什么时候运行。

```
User: "What's in my project directory?"

LLM thinks: "I should use the listFiles tool"
LLM outputs: { tool: "listFiles", args: { directory: "." } }

Your code: executes listFiles(".")
Your code: returns result to LLM

LLM thinks: "Now I have the file list, let me respond"
LLM outputs: "Your project contains package.json, src/, and README.md"
```

## 用 AI SDK 定义工具

AI SDK 提供了一个 `tool()` 函数，用来包装：

- **description**：告诉 LLM 什么时候使用这个工具
- **input schema**：用 Zod schema 定义参数
- **execute function**：真正会运行的代码

我们从最简单的工具开始。创建 `src/agent/tools/file.ts`：

```typescript
import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

/**
 * Read file contents
 */
export const readFile = tool({
  description:
    "Read the contents of a file at the specified path. Use this to examine file contents.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to read"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error reading file: ${err.message}`;
    }
  },
});
```

拆开来看：

**Description**：这比看起来重要得多。LLM 会读这段文字，决定是否使用这个工具。如果只写一个含糊的描述，比如 “file tool”，模型就会困惑。要明确说明工具做什么、什么时候该用。

**Input Schema**：Zod schema 定义工具接受哪些参数。LLM 会生成符合这个 schema 的 JSON。每个字段上的 `.describe()` 能帮助 LLM 理解应该传什么值。

**Execute Function**：这就是工具被调用时真正运行的代码。它接收已经解析并验证过的参数，然后返回字符串结果。一定要优雅处理错误，因为结果会回到 LLM，所以错误信息也应该对模型有帮助。

## 构建工具注册表

现在我们再创建几个工具，并把它们接到一个 registry 里。先保持简单，只做 `readFile` 和 `listFiles`。后续章节会添加更多工具。

更新 `src/agent/tools/file.ts`，加入 `listFiles`：

```typescript
import { tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

/**
 * Read file contents
 */
export const readFile = tool({
  description:
    "Read the contents of a file at the specified path. Use this to examine file contents.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to read"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error reading file: ${err.message}`;
    }
  },
});

/**
 * List files in a directory
 */
export const listFiles = tool({
  description:
    "List all files and directories in the specified directory path.",
  inputSchema: z.object({
    directory: z
      .string()
      .describe("The directory path to list contents of")
      .default("."),
  }),
  execute: async ({ directory }: { directory: string }) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const items = entries.map((entry) => {
        const type = entry.isDirectory() ? "[dir]" : "[file]";
        return `${type} ${entry.name}`;
      });
      return items.length > 0
        ? items.join("\n")
        : `Directory ${directory} is empty`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: Directory not found: ${directory}`;
      }
      return `Error listing directory: ${err.message}`;
    }
  },
});
```

现在创建工具注册表 `src/agent/tools/index.ts`：

```typescript
import { readFile, listFiles } from "./file.ts";

// All tools combined for the agent
export const tools = {
  readFile,
  listFiles,
};

// Export individual tools for selective use in evals
export { readFile, listFiles } from "./file.ts";

// Tool sets for evals
export const fileTools = {
  readFile,
  listFiles,
};
```

这个 registry 是一个普通对象，把工具名映射到工具定义。AI SDK 和 LLM 通信时，会使用对象的 key 作为工具名。我们也导出了单独的工具和工具集合，这些在第 3 章做 evals 时会很有用。

## 发起一次工具调用

用一个简单脚本测试一下。更新 `src/index.ts`：

```typescript
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { tools } from "./agent/tools/index.ts";
import { SYSTEM_PROMPT } from "./agent/system/prompt.ts";

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
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "What files are in the current directory?" },
  ],
  tools,
});

console.log("Text:", result.text);
console.log("Tool calls:", JSON.stringify(result.toolCalls, null, 2));
console.log("Tool results:", JSON.stringify(result.toolResults, null, 2));
```

因为这些工具包含 `execute` 函数，所以在这个简单 demo 里，`generateText()` 可以运行模型请求的工具。这对学习 tool calling 很有帮助。等到了 agent loop，我们会自己接管执行。

运行：

```bash
npm run start
```

你应该会看到：

```
Text:
Tool calls: [
  {
    "toolCallId": "call_abc123",
    "toolName": "listFiles",
    "args": { "directory": "." }
  }
]
Tool results: [
  {
    "toolCallId": "call_abc123",
    "toolName": "listFiles",
    "result": "[dir] node_modules\n[dir] src\n[file] package.json\n[file] tsconfig.json\n..."
  }
]
```

注意这里的 text 是空的。LLM 决定调用 `listFiles`，而不是直接用文本回复。它看到了可用工具，读了工具描述，然后选中了正确的工具。

但这里有一个问题：LLM 调用了工具，我们也执行了它，但 LLM 还没有看到工具结果并生成最终文本回复。这是因为带工具的 `generateText()` 默认只跑一步。LLM 还需要再一轮，才能处理工具结果并生成文本。

这正是我们需要 **agent loop** 的原因，第 4 章会构建它。现在最重要的是：工具选择已经能工作了。

## 工具执行管线

在构建 loop 之前，我们需要一种分发工具调用的方式。创建 `src/agent/executeTool.ts`：

```typescript
import { tools } from "./tools/index.ts";

export type ToolName = keyof typeof tools;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = tools[name as ToolName];

  if (!tool) {
    return `Unknown tool: ${name}`;
  }

  const execute = tool.execute;
  if (!execute) {
    // Provider tools (like webSearch) are executed by the model provider, not us
    return `Provider tool ${name} - executed by model provider`;
  }

  const result = await execute(args as any, {
    toolCallId: "",
    messages: [],
  });

  return String(result);
}
```

这个函数接收工具名和参数，到 registry 里找到对应工具并执行它。它处理两个边界情况：

1. **未知工具** — 返回错误信息，而不是直接崩溃
2. **Provider tools** — 有些工具，比如 web search，是由 LLM provider 执行的，不是由我们的代码执行。第 7 章会遇到这个情况。

## LLM 如何选择工具

理解工具选择的机制，可以帮助你写出更好的工具描述。

当你把 tools 传给 LLM 时，API 会把你的 Zod schema 转成 JSON Schema，并把它们放进 prompt。LLM 会看到类似这样的结构：

```json
{
  "tools": [
    {
      "name": "readFile",
      "description": "Read the contents of a file at the specified path.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "The path to the file to read" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "listFiles",
      "description": "List all files and directories in the specified directory path.",
      "parameters": {
        "type": "object",
        "properties": {
          "directory": { "type": "string", "description": "The directory path to list contents of", "default": "." }
        }
      }
    }
  ]
}
```

然后 LLM 会决定：

- 我应该直接用文本回复，还是调用工具？
- 如果调用工具，应该调用哪一个？
- 应该传什么参数？

这个决定完全基于工具名、工具描述和参数描述。好的描述会带来好的工具选择；差的描述会导致 LLM 选错工具，或者根本不用工具。

## 写好工具描述的建议

1. **明确什么时候使用它**：比如 “Read the contents of a file at the specified path. Use this to examine file contents.” 会清楚告诉 LLM 这个工具适合什么场景。

2. **清楚描述参数**：`.describe("The path to the file to read")` 比单独的 `z.string()` 更好。

3. **合理使用默认值**：`z.string().default(".")` 表示 LLM 可以不指定目录就调用 `listFiles`。

4. **避免重叠**：如果两个工具做的事情相似，要让描述足够不同，让 LLM 能正确选择。

## 小结

这一章你完成了：

- 理解 tool calling 的工作方式：LLM 做决定，你的代码执行
- 用 Zod schema 和 AI SDK 的 `tool()` 函数定义工具
- 创建工具 registry
- 构建工具执行 dispatcher
- 用 `generateText()` 完成第一次工具调用

LLM 现在可以选择工具了，但还不能处理工具结果并回复。为此，我们需要 agent loop。不过在那之前，我们先构建一种方式，测试工具选择是否真的可靠。

---

**下一章：[第 3 章：单轮评测 →](./03-single-turn-evals.md)**
