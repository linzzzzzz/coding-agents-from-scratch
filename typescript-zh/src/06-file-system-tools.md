# 第 6 章：文件系统工具

## 给 Agent 一双手

到目前为止，我们的 agent 可以读取文件、列出目录。这已经能回答很多关于代码库的问题，但真正的 agent 还需要能 *改变* 东西。本章会添加 `writeFile` 和 `deleteFile`，也就是会修改文件系统的工具。

这是 agent 中第一批 **危险工具**。读取文件通常没什么风险，但写入和删除文件可能造成破坏。这个区别在第 9 章会变得非常重要，因为我们会加入 Human-in-the-Loop 审批。

这些工具仍然会定义 `execute` 函数，但记住第 4 章的模式：模型看到的是 schema-only tools，真正何时执行工具由我们的 agent loop 决定。

## Write File 工具

把 `writeFile` 加到 `src/agent/tools/file.ts`：

```typescript
/**
 * Write content to a file
 */
export const writeFile = tool({
  description:
    "Write content to a file at the specified path. Creates the file if it doesn't exist, overwrites if it does.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to write"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async ({
    path: filePath,
    content,
  }: {
    path: string;
    content: string;
  }) => {
    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, "utf-8");
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return `Error writing file: ${err.message}`;
    }
  },
});
```

关键细节：`fs.mkdir(dir, { recursive: true })` 会自动创建父目录。如果用户要求 agent 写入 `src/utils/helpers.ts`，但 `utils/` 目录还不存在，这行代码会创建它。这样可以避免一个常见失败：agent 想写文件，但父目录不存在。

## Delete File 工具

```typescript
/**
 * Delete a file
 */
export const deleteFile = tool({
  description:
    "Delete a file at the specified path. Use with caution as this is irreversible.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to delete"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      await fs.unlink(filePath);
      return `Successfully deleted ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error deleting file: ${err.message}`;
    }
  },
});
```

注意 description 里写了 “Use with caution as this is irreversible.” 这不只是给人看的，LLM 也会读到它。它会影响模型，让它在使用这个工具时更谨慎。Description engineering 也是工具层面的 prompt engineering。

## 完整文件工具模块

下面是完整的 `src/agent/tools/file.ts`：

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
 * Write content to a file
 */
export const writeFile = tool({
  description:
    "Write content to a file at the specified path. Creates the file if it doesn't exist, overwrites if it does.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to write"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async ({
    path: filePath,
    content,
  }: {
    path: string;
    content: string;
  }) => {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, "utf-8");
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return `Error writing file: ${err.message}`;
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

/**
 * Delete a file
 */
export const deleteFile = tool({
  description:
    "Delete a file at the specified path. Use with caution as this is irreversible.",
  inputSchema: z.object({
    path: z.string().describe("The path to the file to delete"),
  }),
  execute: async ({ path: filePath }: { path: string }) => {
    try {
      await fs.unlink(filePath);
      return `Successfully deleted ${filePath}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error deleting file: ${err.message}`;
    }
  },
});
```

## 更新工具注册表

更新 `src/agent/tools/index.ts`，加入新工具：

```typescript
import { readFile, writeFile, listFiles, deleteFile } from "./file.ts";

// All tools combined for the agent
export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};

// Export individual tools for selective use in evals
export { readFile, writeFile, listFiles, deleteFile } from "./file.ts";

// Tool sets for evals
export const fileTools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};
```

## 错误处理模式

四个工具都遵循同样的错误处理模式：

```typescript
try {
  // Do the operation
  return "Success message";
} catch (error) {
  const err = error as NodeJS.ErrnoException;
  if (err.code === "ENOENT") {
    return `Error: File not found: ${filePath}`;
  }
  return `Error: ${err.message}`;
}
```

重点：我们把错误信息作为字符串返回，而不是抛出异常。为什么？因为工具结果会回到 LLM。如果 `readFile` 失败并返回 “File not found”，LLM 可以尝试另一个路径，或者向用户询问。如果我们直接 throw，agent loop 就会崩溃。

这是一个通用原则：**tools should always return, never throw**。LLM 是决策者，让它决定如何处理错误。

## 测试文件工具

用一个真实场景测试：

```typescript
// In src/index.ts
import { runAgent } from "./agent/run.ts";
import type { ModelMessage } from "ai";

const history: ModelMessage[] = [];

await runAgent(
  "Create a file called hello.txt with the content 'Hello, World!' then read it back to verify",
  history,
  {
    onToken: (token) => process.stdout.write(token),
    onToolCallStart: (name) => console.log(`\n[Calling ${name}]`),
    onToolCallEnd: (name, result) => console.log(`[${name} done]: ${result}`),
    onComplete: () => console.log("\n[Done]"),
    onToolApproval: async () => true,
  },
);
```

Agent 应该会：

1. 调用 `writeFile` 创建 `hello.txt`
2. 调用 `readFile` 验证内容
3. 回复确认文件已经创建并验证

现在 `onToolApproval: async () => true` 表示 loop 会自动批准所有工具调用。第 9 章里，我们会把它替换成真正的用户审批提示，尤其用于危险工具。

## 添加文件工具 Evals

创建 `evals/data/file-tools.json`，加入覆盖新工具的测试用例：

```json
[
  {
    "data": {
      "prompt": "Read the contents of README.md",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["readFile"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "What files are in the src directory?",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["listFiles"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "Create a new file called notes.txt with some example content",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["writeFile"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "Remove the old config.bak file",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "expectedTools": ["deleteFile"],
      "category": "golden"
    }
  },
  {
    "data": {
      "prompt": "What is the capital of France?",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
      "category": "negative"
    }
  },
  {
    "data": {
      "prompt": "Tell me a joke",
      "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
    },
    "target": {
      "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
      "category": "negative"
    }
  }
]
```

运行 evals：

```bash
npm run eval:file-tools
```

## 小结

这一章你完成了：

- 为 agent 添加 `writeFile` 和 `deleteFile` 工具
- 理解为什么工具应该返回错误信息，而不是抛出异常
- 理解工具描述如何影响 LLM 行为
- 更新工具 registry 和 eval datasets

Agent 现在可以读取、写入、列出和删除文件。但写入和删除是危险操作，当前 loop 会自动批准它们，没什么能阻止 agent 覆盖重要文件或删除源代码。第 9 章会用 Human-in-the-Loop 审批修复这个问题。不过在那之前，我们先继续添加更多能力。

---

**下一章：[第 7 章：网页搜索与上下文管理 →](./07-web-search-context-management.md)**
