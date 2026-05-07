# Reading Guide

Suggested reading order based on your background.

> Inspired by [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents), [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2), [OpenCode](https://opencode.ai/), and [Claude Code](https://code.claude.com/docs/en/overview). This version expands the learning path toward production coding-agent behavior, OpenAI-compatible providers, clearer instructions, bug fixes, and a revamped web experience.

## Current Public Track

Start with the **TypeScript** track. It is the maintained Phase 1 path and uses the Vercel AI SDK, Zod schemas, and React + Ink for the terminal UI.

The Python edition is held back for now. It may return later as a conceptual companion, but it is not part of the first public release.

## Recommended Reading (Chapter 10)

1. **[AI Engineering: Building Applications with Foundation Models](https://www.amazon.com/AI-Engineering-Building-Applications-Foundation/dp/1098166302)** — Chip Huyen (O'Reilly, 2025). Read this first, regardless of edition. It covers everything *around* the agent (eval at scale, RAG, cost optimization, deployment).
2. **[AI Agents: Multi-Agent Systems and Orchestration Patterns](https://www.amazon.com/dp/B0F1YV2Q5Y)** — Victor Dibia (2025). Read after you've built the single-agent. It covers multi-agent orchestration, which is the natural next step.
3. **[The Agentic AI Book](https://book.ryanrad.org/)** — Dr. Ryan Rad. Broad coverage of agent components and production patterns.
4. **[AI Agents and Applications: With LangChain, LangGraph and MCP](https://www.manning.com/books/ai-agents-and-applications)** — Roberto Infante (Manning). Framework approach — useful contrast to our from-scratch builds.
5. **[Build an AI Agent (From Scratch)](https://www.manning.com/books/build-an-ai-agent-from-scratch)** — Jungjun Hur & Younghee Song (Manning, est. Summer 2026). Similar from-scratch philosophy, using Python.
6. **[AI Agents in Action](https://www.manning.com/books/ai-agents-in-action)** — Micheal Lanham (Manning). Surveys the agent ecosystem: OpenAI Assistants, LangChain, AutoGen, CrewAI.

Pick based on what you're building next — the first two are the most impactful.

## Key Insight

Phase 1 is intentionally scoped: build the working TypeScript agent first, then use the production chapters to see which gaps remain between a teaching agent and tools like OpenCode or Claude Code.
