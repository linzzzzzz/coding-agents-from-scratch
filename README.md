# Building Production AI Coding Agents from Scratch

[简体中文](./README.zh-CN.md) | English

A hands-on course for building CLI AI coding agents with tool calling, streaming, evals, context management, filesystem access, shell execution, human approval, and production-oriented safety patterns.

This course starts from the clean educational architecture of a small agent, then pushes it closer to the shape of real coding agents such as OpenCode and Claude Code.

## Inspiration and Credits

This project is inspired by:

- [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents)
- [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)
- [OpenCode](https://opencode.ai/)
- [Claude Code](https://code.claude.com/docs/en/overview)

The goal is not to clone those projects. The goal is to teach the architecture behind practical coding agents, then extend the learning path with more production concerns, provider flexibility, clearer instructions, bug fixes, and a revamped web experience.

## What This Version Adds

- Expands the original agent architecture with topics closer to production coding agents like OpenCode and Claude Code
- Supports OpenAI-compatible providers instead of assuming a single model vendor
- Adds clearer setup notes, more detailed explanations, and fixes for minor issues found while working through the material
- Deepens coverage of context management, tool safety, shell execution, human approval, evaluation, and production readiness
- Refreshes the website and course positioning so the project stands on its own while preserving attribution

See [Changes from Upstream](./CHANGES_FROM_UPSTREAM.md) for a concise summary of the major differences.

## Editions

- **TypeScript**: Vercel AI SDK, Zod schemas, React + Ink terminal UI

The first public version focuses on the TypeScript Phase 1 track, from Chapter 1 through Chapter 10f. Python and later TypeScript chapters are held back until they are ready for the same level of review.

## What You'll Build

A CLI coding agent that can:

- Call OpenAI-compatible LLM APIs with structured tool definitions
- Stream responses and execute tools inside an agent loop
- Read, write, list, and delete files
- Run shell commands and execute code
- Search the web for current information
- Manage context windows with token estimation and compaction
- Ask for human approval before dangerous operations
- Run single-turn and multi-turn evaluations
- Apply production readiness patterns around safety, observability, cost, and reliability

## Local Development

Requires [mdBook](https://rust-lang.github.io/mdBook/):

```bash
cargo install mdbook
./build.sh
```

Open `docs/index.html` after building.

## License

MIT
