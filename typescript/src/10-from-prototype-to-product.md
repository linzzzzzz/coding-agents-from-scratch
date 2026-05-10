# Chapter 10: From Prototype to Product

## The Gap Between Learning and Shipping

You've built a working CLI agent. It streams responses, calls tools, manages context, and asks for approval before dangerous operations. That's a real agent — but it's a learning agent. Production agents need to handle everything that can go wrong, at scale, without a developer watching.

This chapter covers what's missing and how to close each gap. We won't implement all of these (that would be another book), but you'll know exactly what to build and why.

---

## The Next Set of Problems

The rest of this track is split into focused chapters. Start with the area that matches the risk you are trying to reduce:

- **[Reliability](./11-reliability.md)** — retries, rate limiting, cancellation, and structured logging.
- **[Memory](./12-memory.md)** — conversation memory, semantic memory, and practical memory tests.
- **[Security](./13-security.md)** — command sandboxing, directory scoping, and prompt-injection defenses.
- **[Tooling and Tests](./14-tooling.md)** — tool result size limits, parallel execution, and real tool integration tests. See also the [tool orchestration reference](./14a-tool-orchestration-reference.md) for OpenCode and Claude Code patterns.
- **[Agent Planning](./15-agent-planning.md)** — plan/build mode, approval flow, and read-only planning enforcement.
- **[Subagents](./16-subagents.md)** — delegating bounded work to specialized agents, closer to OpenCode and Claude Code's production pattern.

---

## Hardening Checklist

Here's a checklist for taking your agent to production. Items are ordered by impact:

### Must Have
- [ ] Error recovery with retries and circuit breakers
- [ ] Rate limiting and cost controls
- [ ] Tool result size limits
- [ ] Structured logging
- [ ] Cancellation support
- [ ] Command blocklist for shell tool

### Should Have
- [ ] Persistent conversation memory
- [ ] Directory scoping for file tools
- [ ] Parallel tool execution for read-only tools
- [ ] Agent planning for complex tasks
- [ ] Integration tests for real tools
- [ ] Prompt injection defenses

### Nice to Have
- [ ] Container sandboxing
- [ ] Subagents for review, exploration, and verification
- [ ] Semantic memory with embeddings
- [ ] Cost estimation before execution
- [ ] Conversation branching / undo
- [ ] Plugin system for custom tools

---

## Recommended Reading

These books will deepen your understanding of production agent systems. They're ordered by how directly they complement what you've built in this book.

### Start Here

**[AI Engineering: Building Applications with Foundation Models](https://www.amazon.com/AI-Engineering-Building-Applications-Foundation/dp/1098166302)** — Chip Huyen (O'Reilly, 2025)

The most important book on this list. Covers the full production AI stack: prompt engineering, RAG, fine-tuning, agents, evaluation at scale, latency/cost optimization, and deployment. It doesn't go deep on agent architecture, but it fills every gap around it — how to evaluate reliably, manage costs, serve models efficiently, and build systems that don't break at scale. If you only read one book beyond this one, make it this.

### Agent Architecture & Patterns

**[AI Agents: Multi-Agent Systems and Orchestration Patterns](https://www.amazon.com/dp/B0F1YV2Q5Y)** — Victor Dibia (2025)

The closest match to what we've built, but taken much further. 15 chapters covering 6 orchestration patterns, 4 UX principles, evaluation methods, failure modes, and case studies. Particularly strong on multi-agent coordination. Read this when you're ready to move from simple subagents to richer multi-agent systems.

**[The Agentic AI Book](https://book.ryanrad.org/)** — Dr. Ryan Rad

A comprehensive guide covering the core components of AI agents and how to make them work in production. Good balance between theory and practice. Useful if you want a broader perspective on agent design patterns beyond the tool-calling approach we used.

### Framework-Specific

**[AI Agents and Applications: With LangChain, LangGraph and MCP](https://www.manning.com/books/ai-agents-and-applications)** — Roberto Infante (Manning)

We built everything from scratch using the Vercel AI SDK. This book takes the opposite approach — using LangChain and LangGraph as foundations. Worth reading to understand how frameworks solve the same problems we solved manually (tool registries, agent loops, memory). You'll appreciate the tradeoffs between framework-based and from-scratch approaches. Also covers MCP (Model Context Protocol), which is becoming the standard for tool interoperability.

### Build-From-Scratch (Like This Book)

**[Build an AI Agent (From Scratch)](https://www.manning.com/books/build-an-ai-agent-from-scratch)** — Jungjun Hur & Younghee Song (Manning, estimated Summer 2026)

Very similar philosophy to our book — building from the ground up. Covers ReAct loops, MCP tool integration, agentic RAG, memory modules, and multi-agent systems. MEAP (early access) is available now. Good as a second perspective on the same journey, especially for the memory and RAG chapters we didn't cover.

### Broader Coverage

**[AI Agents in Action](https://www.manning.com/books/ai-agents-in-action)** — Micheal Lanham (Manning)

Surveys the agent ecosystem: OpenAI Assistants API, LangChain, AutoGen, and CrewAI. Less depth on any single approach, but valuable for understanding the landscape. Read this if you're evaluating which frameworks and platforms to use for your production agent, or if you want to see how different tools solve the same problems.

### How to Use These Books

| If you want to... | Read |
|---|---|
| Ship your agent to production | Chip Huyen's *AI Engineering* |
| Build multi-agent systems | Victor Dibia's *AI Agents* |
| Understand LangChain/LangGraph | Roberto Infante's *AI Agents and Applications* |
| Get a second from-scratch perspective | Hur & Song's *Build an AI Agent* |
| Survey the agent ecosystem | Micheal Lanham's *AI Agents in Action* |
| Understand agent theory broadly | Dr. Ryan Rad's *The Agentic AI Book* |

---

## Closing Thoughts

Building an agent is the easy part. Making it reliable, safe, and cost-effective is where the real engineering lives.

The good news: the architecture from this book scales. The callback pattern, tool registry, message history, and eval framework are the same patterns used by production agents. You're adding guardrails and hardening, not rewriting from scratch.

Start with the "Must Have" items. Add rate limiting and error recovery first — they prevent the most costly failures. Then work through the list based on what your users actually need.

The agent loop you built in Chapter 4 is the foundation. Everything else is making it trustworthy.

**Happy shipping.**

---

Continue through Chapter 16 to complete the track. Future topics are tracked in the [Roadmap section of the README](../../README.en.md#roadmap).
