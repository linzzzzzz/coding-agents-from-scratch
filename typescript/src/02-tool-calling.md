# Chapter 2: Tool Calling

> 💻 **Code:** start from the [`lesson-02`](https://github.com/Hendrixer/agents-v2/tree/lesson-02) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## How Tool Calling Works

Tool calling is the mechanism that turns a language model into an agent. Here's the flow:

1. You describe available tools to the LLM (name, description, parameter schema)
2. The user sends a message
3. The LLM decides whether to respond with text or call a tool
4. If it calls a tool, you execute the tool and send the result back
5. The LLM uses the result to form its final response

The critical insight: **the LLM doesn't execute the tools**. It outputs structured JSON saying "I want to call this tool with these arguments." Your code does the actual execution. The LLM is the brain; your code is the hands.

In this chapter, the AI SDK will help us by calling each tool's `execute` function directly. Later, when we build our own agent loop, we will separate the model-visible tool schemas from the executable tools so our runtime controls exactly when tools run.

```
User: "What's in my project directory?"

LLM thinks: "I should use the listFiles tool"
LLM outputs: { tool: "listFiles", args: { directory: "." } }

Your code: executes listFiles(".")
Your code: returns result to LLM

LLM thinks: "Now I have the file list, let me respond"
LLM outputs: "Your project contains package.json, src/, and README.md"
```

## Defining a Tool with the AI SDK

The AI SDK provides a `tool()` function that wraps:
- A **description** (tells the LLM when to use it)
- An **input schema** (Zod schema defining the parameters)
- An **execute function** (what actually runs)

Let's start with the simplest possible tool. Create `src/agent/tools/file.ts`:

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

Let's break this down:

**Description**: This is surprisingly important. The LLM reads this to decide whether to use the tool. A vague description like "file tool" would confuse the model. Be specific about *what* the tool does and *when* to use it.

**Input Schema**: Zod schemas define what parameters the tool accepts. The LLM generates JSON matching this schema. The `.describe()` calls on each field help the LLM understand what values to provide.

**Execute Function**: This is your code that runs when the tool is called. It receives the parsed, validated arguments and returns a string result. Always handle errors gracefully — the result goes back to the LLM, so error messages should be helpful.

## Building the Tool Registry

Now let's create a few more tools and wire them into a registry. We'll keep it simple for now — just `readFile` and `listFiles`. We'll add more tools in later chapters.

Update `src/agent/tools/file.ts` to add `listFiles`:

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

Now create the tool registry at `src/agent/tools/index.ts`:

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

The registry is a plain object mapping tool names to tool definitions. The AI SDK uses the object keys as tool names when communicating with the LLM. We also export individual tools and tool sets — these will be useful for evaluations in Chapter 3.

## Making a Tool Call

Let's test this with a simple script. Update `src/index.ts`:

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

Because these tools include `execute` functions, `generateText()` can run the requested tool for this simple demo. That is useful while learning tool calling. In the agent loop, we will take over execution ourselves.

Run it:

```bash
npm run start
```

You should see:

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

Notice the text is empty. The LLM decided to call `listFiles` instead of responding with text. It saw the tools available, read their descriptions, and chose the right one.

But there's a problem: the LLM called the tool, we executed it, but the LLM never got to see the result and form a final text response. That's because `generateText()` with tools stops after one step by default. The LLM needs another turn to process the tool result and generate text.

This is exactly why we need an **agent loop** — which we'll build in Chapter 4. For now, the important thing is that tool selection works.

## The Tool Execution Pipeline

Before we build the loop, we need a way to dispatch tool calls. Create `src/agent/executeTool.ts`:

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

This function takes a tool name and arguments, looks up the tool in our registry, and executes it. It handles two edge cases:

1. **Unknown tool** — Returns an error message (instead of crashing)
2. **Provider tools** — Some tools (like web search) are executed by the LLM provider, not our code. We'll encounter this in Chapter 7.

## How the LLM Chooses Tools

Understanding how tool selection works helps you write better tool descriptions.

When you pass tools to the LLM, the API converts your Zod schemas into JSON Schema and includes them in the prompt. The LLM sees something like:

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

The LLM then decides:
- Should I respond with text, or call a tool?
- If calling a tool, which one?
- What arguments should I pass?

This decision is based entirely on the tool names, descriptions, and parameter descriptions. Good descriptions → good tool selection. Bad descriptions → the LLM picks the wrong tool or doesn't use tools at all.

## Tips for Writing Good Tool Descriptions

1. **Be specific about when to use it**: "Read the contents of a file at the specified path. Use this to examine file contents." tells the LLM exactly when this tool is appropriate.

2. **Describe parameters clearly**: `.describe("The path to the file to read")` is better than just `z.string()`.

3. **Use defaults wisely**: `z.string().default(".")` means the LLM can call `listFiles` without specifying a directory.

4. **Don't overlap**: If two tools do similar things, make the descriptions distinct enough that the LLM can choose correctly.

## Summary

In this chapter you:

- Learned how tool calling works (LLM decides, your code executes)
- Defined tools with Zod schemas and the AI SDK's `tool()` function
- Created a tool registry
- Built a tool execution dispatcher
- Made your first tool call with `generateText()`

The LLM can now select tools, but it can't yet process the results and respond. For that, we need the agent loop. But first, let's build a way to test whether tool selection actually works reliably.

---

**Next: [Chapter 3: Single-Turn Evaluations →](./03-single-turn-evals.md)**
