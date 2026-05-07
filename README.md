<p align="center">
  <img src="./assets/banner-zero-to-prod-light-notext-slim.jpg" alt="Terminal prompt flowing into an agent loop and production check" width="100%">
</p>

# Building Production AI Coding Agents from Scratch

[简体中文](./README.zh-CN.md) | English

A hands-on course for building CLI AI coding agents with tool calling, streaming, evals, context management, filesystem access, shell execution, human approval, and production-oriented safety patterns.

This course starts from the clean educational architecture of a small agent, then pushes it closer to the shape of real coding agents such as OpenCode and Claude Code.

## Quick Start

Start reading here: [Building Production AI Coding Agents from Scratch](https://linzzzzzz.github.io/coding-agents-from-scratch/).

Or open [Chapter 1](./typescript/src/01-intro-to-agents.md) directly on GitHub.

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
- Add reliability features like retries, cancellation, usage limits, and structured logging
- Persist useful memories without turning every run into permanent context
- Harden tool execution with path validation, result wrapping, output limits, and real integration tests
- Add planning mode and production-style subagents for larger coding tasks

## Course Outline

| Part | Chapters | What You'll Learn |
| --- | --- | --- |
| **I. Agent Basics** | 1-5 | LLM calls, tool calling, evals, streaming, and the core agent loop |
| **II. Real-World Capabilities** | 6-9 | File tools, web search, context management, shell execution, and human approval |
| **III. Hardening the Agent** | 10-14 | Reliability, memory, security, tool orchestration, logging, and real tool tests |
| **IV. Agent Architecture** | 15-16 | Planning mode, approval-based execution, and production-style subagents |

## Roadmap

Planned additions include:

- Python version
- Session management
- MCP, plugins, and skills

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

## Local Development

Requires [mdBook](https://rust-lang.github.io/mdBook/). On macOS, install it with Homebrew:

```bash
brew install mdbook
./build.sh
```

If you prefer Cargo, `cargo install mdbook` works too.

Open `docs/index.html` after building.

## License

MIT
