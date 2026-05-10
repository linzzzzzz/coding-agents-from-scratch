<p align="center">
  <img src="./assets/banner-zero-to-prod-light-notext-slim.jpg" alt="Building Production AI Coding Agents — course banner" width="100%">
</p>

# Building Production AI Coding Agents from Scratch

> *Learn it, build it, own it.*

[简体中文](./README.md) | English

A hands-on course for building CLI AI coding agents — tool calling, streaming, evals, file and shell tools, context and memory management, human approval, reliability and security, and production architecture patterns like planning mode and subagents.

This course starts from the clean educational architecture of a small agent, then pushes it closer to the shape of real coding agents such as OpenCode and Claude Code.

## Who This Is For

- Engineers who want to build a coding agent themselves and understand every layer — not just call an SDK
- Teams forking or extending production agents (Claude Code, OpenCode) who need the mental model to read the source
- Builders past "hello world LLM calls" who want the unglamorous production parts: retries, cancellation, path validation, evals, and integration tests

## Quick Start

- Read online: [Building Production AI Coding Agents from Scratch](https://linzzzzzz.github.io/coding-agents-from-scratch/)
- Or jump straight to [Chapter 1](./typescript/src/01-intro-to-agents.md) on GitHub

## Reference Implementation

The finished TypeScript implementation for this guide is available in [`reference/typescript`](./reference/typescript).

Use it to compare against your own code, debug a chapter, or run the completed agent locally.

## What You'll Build

A CLI coding agent that:

- Reads code, edits files, runs shell commands, and searches the web — through structured tool calls inside a streaming agent loop
- Stays within token budgets via context compaction and persistent memory across runs
- Asks for human approval before destructive operations, with path validation and output limits guarding every tool
- Survives real failures with retries, cancellation, usage limits, and structured logs
- Plans complex tasks before acting and delegates subtasks to specialized subagents
- Ships with single-turn and multi-turn evals plus integration tests against real tools
- Works with any OpenAI-compatible provider — not locked to a single vendor

## Table of Contents

| Part | Chapter |
| --- | --- |
| **I. Agent Foundations** | [Chapter 1: Introduction to AI Agents](./typescript/src/01-intro-to-agents.md) |
|  | [Chapter 2: Tool Calling](./typescript/src/02-tool-calling.md) |
|  | [Chapter 3: Single-Turn Evaluations](./typescript/src/03-single-turn-evals.md) |
|  | [Chapter 4: The Agent Loop](./typescript/src/04-the-agent-loop.md) |
|  | [Chapter 5: Multi-Turn Evaluations](./typescript/src/05-multi-turn-evals.md) |
| **II. Real-World Capabilities** | [Chapter 6: File System Tools](./typescript/src/06-file-system-tools.md) |
|  | [Chapter 7: Web Search and Context Management](./typescript/src/07-web-search-context-management.md) |
|  | [Chapter 8: Shell Tool and Code Execution](./typescript/src/08-shell-tool.md) |
|  | [Chapter 9: Human-in-the-Loop](./typescript/src/09-human-in-the-loop.md) |
| **III. Hardening the Agent** | [Chapter 10: From Prototype to Product](./typescript/src/10-from-prototype-to-product.md) |
|  | [Chapter 11: Reliability](./typescript/src/11-reliability.md) |
|  | [Chapter 12: Memory](./typescript/src/12-memory.md) |
|  | [Chapter 13: Security](./typescript/src/13-security.md) |
|  | [Chapter 14: Tooling and Tests](./typescript/src/14-tooling.md) |
| **IV. Agent Architecture** | [Chapter 15: Agent Planning](./typescript/src/15-agent-planning.md) |
|  | [Chapter 16: Subagents](./typescript/src/16-subagents.md) |

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

The goal is not to clone those projects but to show how practical coding agents are built.

## What This Version Adds

- Adds new chapters on planning mode, subagents, security hardening, and memory
- Supports any OpenAI-compatible provider instead of assuming a single model vendor
- Bilingual mdBook site with per-page English / 简体中文 switching
- Setup clarifications and bug fixes found while working through the material

See [Changes from Upstream](./CHANGES_FROM_UPSTREAM.md) for a concise summary of the major differences.

## Building the Site Locally

Requires [mdBook](https://rust-lang.github.io/mdBook/). On macOS, install it with Homebrew:

```bash
brew install mdbook
./build.sh
```

If you prefer Cargo, `cargo install mdbook` works too.

Open `docs/index.html` after building.

## License

MIT
