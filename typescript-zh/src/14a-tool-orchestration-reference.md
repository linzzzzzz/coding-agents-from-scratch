# 工具编排参考

OpenCode 和 Claude Code 都支持并行工具工作，但它们会配合一些生产级 guardrails。重点不是“到处使用 `Promise.all`”。重点是：分类工具调用、安全调度，并让每个结果都经过同一条执行 pipeline。

---

## OpenCode 模式

OpenCode 会鼓励模型并行发出独立工具调用。例如，它的 Read 和 Bash 工具说明会告诉模型：当工作彼此独立时，在同一条消息里发出多个工具调用。

执行侧是集中式的：工具定义会经过一个 wrapper，负责校验参数、执行工具，并在结果返回给 agent 之前截断输出。这样即使有很多工具，结果处理也能保持一致。

这门课里的 takeaway：

- 提示模型并行处理独立读取。
- 把执行行为集中在共享的 tool wrapper / helper 中。
- 把 permissions 视为用户知情，而不是 sandbox。

---

## Claude Code 模式

Claude Code 使用更显式的 scheduler。

每个工具都可以声明自己是否适合并发运行。runtime 会把工具调用切分成批次：

```txt
read, read, grep   -> run together
write              -> run alone
read, webFetch     -> run together
bash/edit/delete   -> run alone unless proven safe
```

这能避免一个常见 bug：顺序执行一套 code path，并行执行另一套更弱的 code path。

生产级形状大概是：

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

关键是 `executeOneToolCall` 是共享的。它仍然处理：

- validation
- permission 或 approval
- usage limits
- cancellation
- execution
- truncation
- logging
- 在工具输出送回模型之前进行 wrapping
- 把工具结果加入 conversation history

---

## 本课程建议

使用一个简化版 Claude Code-style scheduler：

1. 标记一小组 concurrency-safe 工具：`readFile`、`listFiles`、`webSearch`。
2. 把连续的安全工具调用切成 batch。
3. 用 `Promise.all` 运行安全 batch。
4. 不安全工具一次运行一个。
5. 保持一个共享的 `executeApprovedToolCall` helper，让所有路径都使用同一套安全和日志行为。

这样能获得真正的生产结构，又不会把课程变成完整的 orchestration framework。

更简单的“如果所有工具都安全，就全部并行；否则全部顺序”的方案可以作为第一版草图，但它会浪费性能。像下面这样的 mixed batch：

```txt
readFile, readFile, writeFile, readFile
```

应该按下面这样运行：

```txt
[readFile + readFile in parallel]
[writeFile alone]
[readFile alone or with following safe tools]
```

这就是更大型 coding agents 使用的模式。
