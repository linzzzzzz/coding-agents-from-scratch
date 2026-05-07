# Chapter 6: File System Tools

> 💻 **Code:** start from the [`lesson-06`](https://github.com/Hendrixer/agents-v2/tree/lesson-06) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## Giving the Agent Hands

So far our agent can read files and list directories. That's useful for answering questions about your codebase, but a real agent needs to *change* things. In this chapter, we'll add `writeFile` and `deleteFile` — tools that modify the filesystem.

These are the first **dangerous tools** in our agent. Reading files is harmless. Writing and deleting files can cause damage. This distinction will become important in Chapter 9 when we add human-in-the-loop approval.

The tools still define `execute` functions, but remember the pattern from Chapter 4: the model sees schema-only tools, and our agent loop decides when to execute the real tools.

## Write File Tool

Add `writeFile` to `src/agent/tools/file.ts`:

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

Key detail: `fs.mkdir(dir, { recursive: true })` creates parent directories automatically. If the user asks the agent to write to `src/utils/helpers.ts` and the `utils/` directory doesn't exist, it gets created. This prevents a common failure mode where the agent tries to write a file but the parent directory is missing.

## Delete File Tool

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

Notice the description says "Use with caution as this is irreversible." This isn't just for humans — the LLM reads this too. It influences the model to be more careful about when it uses this tool. Description engineering is prompt engineering for tools.

## The Complete File Tools Module

Here's the full `src/agent/tools/file.ts`:

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

## Updating the Tool Registry

Update `src/agent/tools/index.ts` to include the new tools:

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

## Error Handling Patterns

All four tools follow the same error handling pattern:

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

Important: we return error messages as strings rather than throwing exceptions. Why? Because tool results go back to the LLM. If `readFile` fails with "File not found", the LLM can try a different path or ask the user for clarification. If we threw an exception, the agent loop would crash.

This is a general principle: **tools should always return, never throw**. The LLM is the decision-maker. Let it decide how to handle errors.

## Testing File Tools

Let's test with a real scenario:

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

The agent should:
1. Call `writeFile` to create `hello.txt`
2. Call `readFile` to verify the contents
3. Respond confirming the file was created and verified

For now, `onToolApproval: async () => true` means the loop auto-approves every tool call. In Chapter 9, we'll replace that with a real user approval prompt for dangerous tools.

## Adding File Tools Evals

Create `evals/data/file-tools.json` with test cases that cover the new tools:

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

Run the evals:

```bash
npm run eval:file-tools
```

## Summary

In this chapter you:

- Added `writeFile` and `deleteFile` tools to the agent
- Learned why tools should return errors instead of throwing
- Understood the importance of tool descriptions in influencing LLM behavior
- Updated the tool registry and eval datasets

The agent can now read, write, list, and delete files. But these write and delete operations are dangerous — the loop currently auto-approves them, so there's nothing stopping the agent from overwriting important files or deleting your source code. We'll fix that in Chapter 9 with human-in-the-loop approval. But first, let's add more capabilities.

---

**Next: [Chapter 7: Web Search & Context Management →](./07-web-search-context-management.md)**
