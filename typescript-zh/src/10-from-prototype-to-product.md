# 第 10 章：从原型到产品

## 从学习版到可发布产品的差距

你已经构建了一个可以工作的 CLI agent。它能流式响应、调用工具、管理上下文，并且会在危险操作之前请求审批。这已经是一个真正的 agent，但它还是一个学习版 agent。生产级 agent 需要在没有开发者盯着看的情况下，大规模处理各种可能出错的事情。

本章会说明还缺什么，以及如何补上每个缺口。我们不会把所有内容都实现完（那会变成另一本书），但你会清楚知道接下来该构建什么，以及为什么要构建。

---

## 下一组问题

本系列剩余部分会拆成几个聚焦章节。你可以从最符合当前风险的领域开始：

- **[可靠性](./11-reliability.md)**：重试、限流、取消和结构化日志。
- **[记忆](./12-memory.md)**：对话记忆、语义记忆和实用的记忆测试。
- **[安全](./13-security.md)**：命令沙箱、目录范围限制和 prompt injection 防御。
- **[工具系统与测试](./14-tooling.md)**：工具结果大小限制、并行执行和真实工具集成测试。OpenCode 和 Claude Code 的模式可以参考 [工具编排参考](./14a-tool-orchestration-reference.md)。
- **[Agent Planning](./15-agent-planning.md)**：plan/build 模式、审批流程和只读 planning 约束。
- **[Subagents](./16-subagents.md)**：把边界清晰的工作委派给专门的 agent，更接近 OpenCode 和 Claude Code 的生产级模式。

---

## 加固清单

下面是一份把 agent 推向生产环境的清单。条目按影响力排序：

### 必须有

- [ ] 带重试和 circuit breaker 的错误恢复
- [ ] 限流和成本控制
- [ ] 工具结果大小限制
- [ ] 结构化日志
- [ ] 取消支持
- [ ] shell 工具的命令 blocklist

### 应该有

- [ ] 持久化对话记忆
- [ ] 文件工具的目录范围限制
- [ ] 只读工具的并行执行
- [ ] 复杂任务的 agent planning
- [ ] 真实工具的集成测试
- [ ] prompt injection 防御

### 可以有

- [ ] 容器沙箱
- [ ] 用于 review、探索和验证的 subagents
- [ ] 基于 embeddings 的语义记忆
- [ ] 执行前成本估算
- [ ] 对话分支 / undo
- [ ] 自定义工具插件系统

---

## 推荐阅读

这些书会加深你对生产级 agent 系统的理解。排序方式是：它们和本书已经构建内容的互补程度。

### 从这里开始

**[AI Engineering: Building Applications with Foundation Models](https://www.amazon.com/AI-Engineering-Building-Applications-Foundation/dp/1098166302)** — Chip Huyen（O'Reilly，2025）

这是这份书单里最重要的一本。它覆盖完整的生产级 AI 技术栈：prompt engineering、RAG、fine-tuning、agents、大规模评测、延迟 / 成本优化和部署。它不会非常深入 agent 架构本身，但会补齐架构周围的所有缺口：如何可靠评测、管理成本、高效服务模型，以及构建不会在规模化后崩掉的系统。如果你在本书之外只读一本，就读这本。

### Agent 架构与模式

**[AI Agents: Multi-Agent Systems and Orchestration Patterns](https://www.amazon.com/dp/B0F1YV2Q5Y)** — Victor Dibia（2025）

这是和我们所构建内容最接近的一本，但走得更远。全书 15 章，覆盖 6 种编排模式、4 条 UX 原则、评测方法、失败模式和案例研究。它在 multi-agent 协作方面尤其强。当你准备从简单 subagents 走向更丰富的 multi-agent 系统时，可以读这本。

**[The Agentic AI Book](https://book.ryanrad.org/)** — Dr. Ryan Rad

一本覆盖 AI agents 核心组件，以及如何让它们在生产环境中工作的综合指南。理论和实践的平衡不错。如果你想从我们使用的 tool-calling 路线之外获得更宽的 agent 设计模式视角，这本会有帮助。

### 框架相关

**[AI Agents and Applications: With LangChain, LangGraph and MCP](https://www.manning.com/books/ai-agents-and-applications)** — Roberto Infante（Manning）

我们使用 Vercel AI SDK 从零构建所有东西。这本书采取相反路线：以 LangChain 和 LangGraph 为基础。它值得一读，因为你可以看到框架如何解决我们手动解决过的同类问题，比如工具注册表、agent loops 和 memory。你也会更能理解基于框架和从零构建之间的取舍。它还覆盖 MCP（Model Context Protocol），这是正在成为工具互操作标准的协议。

### 从零构建路线（类似本书）

**[Build an AI Agent (From Scratch)](https://www.manning.com/books/build-an-ai-agent-from-scratch)** — Jungjun Hur & Younghee Song（Manning，预计 2026 年夏）

它和本书的理念非常相近：从底层一步步构建。内容包括 ReAct loops、MCP 工具集成、agentic RAG、memory modules 和 multi-agent systems。目前已有 MEAP（early access）。如果你想从另一个角度走同一段旅程，尤其是我们没有覆盖的 memory 和 RAG 章节，这本很适合作为第二视角。

### 更广的生态视角

**[AI Agents in Action](https://www.manning.com/books/ai-agents-in-action)** — Micheal Lanham（Manning）

这本书概览 agent 生态：OpenAI Assistants API、LangChain、AutoGen 和 CrewAI。它在单一路线上的深度较少，但对于理解整个版图很有价值。如果你正在评估生产级 agent 要使用哪些框架和平台，或者想看看不同工具如何解决相同问题，可以读这本。

### 如何使用这些书

| 如果你想... | 阅读 |
|---|---|
| 把 agent 发布到生产环境 | Chip Huyen 的 *AI Engineering* |
| 构建 multi-agent systems | Victor Dibia 的 *AI Agents* |
| 理解 LangChain/LangGraph | Roberto Infante 的 *AI Agents and Applications* |
| 获得第二个从零构建视角 | Hur & Song 的 *Build an AI Agent* |
| 浏览 agent 生态 | Micheal Lanham 的 *AI Agents in Action* |
| 广泛理解 agent 理论 | Dr. Ryan Rad 的 *The Agentic AI Book* |

---

## 结束语

构建一个 agent 是容易的部分。让它可靠、安全、成本可控，才是真正的工程所在。

好消息是：本书里的架构可以继续扩展。callback 模式、工具注册表、消息历史和 eval 框架，都是生产级 agents 也会使用的模式。你要做的是加 guardrails 和 hardening，而不是推倒重写。

从 “Must Have” 条目开始。先加入限流和错误恢复，它们能避免最昂贵的失败。然后根据真实用户需要，逐步推进剩余清单。

第 4 章构建的 agent loop 是基础。后面的所有工作，都是让它变得值得信任。

**祝你顺利发布。**

---

继续读到第 16 章即可完成本系列。后续主题记录在 [README 的 Roadmap 部分](../../README.md#roadmap)。
