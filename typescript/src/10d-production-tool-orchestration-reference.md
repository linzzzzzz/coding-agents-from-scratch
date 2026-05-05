# Production Tool Orchestration Reference

OpenCode and Claude Code both support parallel tool work, but they do it with a few production guardrails. The important lesson is not "use `Promise.all` everywhere." The lesson is: classify tool calls, schedule them safely, and send every result through the same execution pipeline.

---

## OpenCode Pattern

OpenCode encourages the model to make independent tool calls in parallel. For example, its Read and Bash tool instructions tell the model to issue multiple tool calls in a single message when the work is independent.

The execution side is centralized: tool definitions run through a wrapper that validates arguments, executes the tool, and truncates output before returning it to the agent. This keeps result handling consistent even when many tools are available.

The course takeaway:

- Prompt the model to parallelize independent reads.
- Keep execution behavior centralized in a shared tool wrapper/helper.
- Treat permissions as user awareness, not as a sandbox.

---

## Claude Code Pattern

Claude Code uses a more explicit scheduler.

Each tool can declare whether it is safe to run concurrently. The runtime partitions tool calls into batches:

```txt
read, read, grep   -> run together
write              -> run alone
read, webFetch     -> run together
bash/edit/delete   -> run alone unless proven safe
```

This avoids a common bug: having one code path for sequential execution and a different, weaker code path for parallel execution.

The production shape looks like this:

```typescript
for (const batch of partitionToolCalls(toolCalls)) {
  if (batch.isConcurrencySafe) {
    await Promise.all(batch.toolCalls.map(executeOneToolCall));
  } else {
    for (const tc of batch.toolCalls) {
      await executeOneToolCall(tc);
    }
  }
}
```

The key is that `executeOneToolCall` is shared. It still handles:

- validation
- permission or approval
- usage limits
- cancellation
- execution
- truncation
- logging
- wrapping tool output before sending it back to the model
- adding the tool result to conversation history

---

## Recommendation For This Course

Use a simplified Claude Code-style scheduler:

1. Mark a small set of tools as concurrency-safe: `readFile`, `listFiles`, `webSearch`.
2. Partition consecutive safe tool calls into batches.
3. Run safe batches with `Promise.all`.
4. Run unsafe tools one at a time.
5. Keep one shared `executeApprovedToolCall` helper so all paths use the same safety and logging behavior.

This gives you real production structure without turning the course into a full orchestration framework.

The simpler "if all tools are safe, run all in parallel, otherwise run all sequentially" approach is okay as a first sketch, but it leaves performance on the table. A mixed batch like this:

```txt
readFile, readFile, writeFile, readFile
```

should run as:

```txt
[readFile + readFile in parallel]
[writeFile alone]
[readFile alone or with following safe tools]
```

That is the pattern used by larger coding agents.
