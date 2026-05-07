# Chapter 4: The Agent Loop

> 💻 **Code:** start from the [`lesson-04`](https://github.com/Hendrixer/agents-v2/tree/lesson-04) branch of [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2). The `notes/` folder on that branch has the code you'll write in this chapter.

## The Heart of an Agent

This is the most important chapter in the book. Everything before this was setup. Everything after builds on this.

The agent loop is what transforms a language model from a question-answering machine into an autonomous agent. Here's the pattern:

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

The LLM decides when to stop. It might call one tool, process the result, call another, and then respond with text. Or it might call three tools in one turn, process all results, and respond. The loop keeps going until the LLM says "I'm done — here's my answer."

## Streaming vs. Generating

In Chapter 2, we used `generateText()` which waits for the complete response before returning. That's fine for evals, but terrible for UX. Users want to see tokens appear in real-time.

`streamText()` returns an async iterable that yields chunks as they arrive:

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

The `fullStream` gives us everything: text deltas, tool calls, finish reasons, and more. We process each chunk type differently.

## Building the Agent Loop

Create `src/agent/run.ts`:

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

Let's walk through this step by step.

### Function Signature

```typescript
export async function runAgent(
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]>
```

The function takes:
- **`userMessage`** — The latest message from the user
- **`conversationHistory`** — All previous messages (for multi-turn conversations)
- **`callbacks`** — Functions to notify the UI about streaming tokens, tool calls, etc.

It returns the updated message history, which the caller stores for the next turn.

### Message Construction

```typescript
const messages: ModelMessage[] = [
  { role: "system", content: SYSTEM_PROMPT },
  ...withoutSystemMessages(conversationHistory),
  { role: "user", content: userMessage },
];
```

We build the full message array: a fresh system prompt, then reusable
conversation history, then the new user message. `withoutSystemMessages()` keeps
old system prompts out of history because each run should get exactly one fresh
system prompt.

This array grows as tools are called — tool results get appended. At the end of
the run, we return `withoutSystemMessages(messages)` so the next turn receives
only reusable user, assistant, and tool messages.

`withoutToolExecutors()` makes a model-facing copy of our tools without
`execute` functions. The model can still see tool names, descriptions, and
schemas, but the AI SDK will not run tools automatically. That keeps execution
inside our agent loop.

### The Loop

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

Each iteration:
1. Sends the current messages and model-facing tool schemas to the LLM
2. Streams the response, collecting text and tool calls
3. Checks the `finishReason`:
   - `"tool-calls"` → The LLM wants tools executed. Do it and loop.
   - Anything else (`"stop"`, `"length"`, etc.) → The LLM is done. Break.

### Tool Execution

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

For each tool call:
1. Execute the real tool using our dispatcher from Chapter 2
2. Notify the UI that the tool completed
3. Add the result as a `tool` message, linked to the original `toolCallId`

The `toolCallId` is critical — it tells the LLM which tool call this result belongs to. Without it, the LLM can't match results to requests.

### Callbacks

The callbacks pattern decouples the agent logic from the UI:

```typescript
callbacks.onToken(chunk.text);      // Stream text to UI
callbacks.onToolCallStart(name, args); // Show tool execution starting
callbacks.onToolCallEnd(name, result); // Show tool result
callbacks.onComplete(fullResponse);    // Signal completion
```

The agent doesn't know or care whether the UI is a terminal, a web page, or a test harness. It just calls the callbacks. This is the same pattern used by the AI SDK itself.

## Testing the Loop

Let's test with a simple script. Update `src/index.ts`:

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

Run it:

```bash
npm run start
```

You should see the agent:
1. Call `listFiles` to see the directory contents
2. Call `readFile` to read `package.json`
3. Respond with a summary of what it found

That's the loop in action. The LLM made two tool calls across potentially multiple loop iterations, got the results, and synthesized a coherent response.

## The Message History

After the loop, the messages array looks something like:

```
[system]    "You are a helpful AI assistant..."
[user]      "What files are in the current directory? Then read..."
[assistant] (tool call: listFiles)
[tool]      "[dir] node_modules\n[dir] src\n[file] package.json..."
[assistant] (tool call: readFile, text: "Let me read...")
[tool]      "{ \"name\": \"agi\", ... }"
[assistant] "Your project has the following files... The package.json shows..."
```

This is the full conversation history. The LLM sees all of it on each iteration, which is how it maintains context. This is also why context management (Chapter 7) becomes important — this history grows with every interaction.

## Error Handling

The real implementation should handle stream errors. Here's the enhanced version with error handling:

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

If the stream errors but we already have some text, we can still use it. If the error is about "no output generated" and we have nothing, we provide a fallback message. This makes the agent resilient to transient API issues.

## Summary

In this chapter you:

- Built the core agent loop with streaming
- Understood the stream → detect tool calls → execute → loop pattern
- Used callbacks to decouple agent logic from UI
- Handled the message history that grows with each tool call
- Added error handling for stream failures

This is the engine of the agent. Everything else — more tools, context management, human approval — plugs into this loop. In the next chapter, we'll build multi-turn evaluations to test the full loop.

---

**Next: [Chapter 5: Multi-Turn Evaluations →](./05-multi-turn-evals.md)**
