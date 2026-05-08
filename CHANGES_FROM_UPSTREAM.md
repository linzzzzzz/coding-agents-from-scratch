# Changes from Upstream

This course is inspired by:

- [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents)
- [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)
- [OpenCode](https://opencode.ai/)
- [Claude Code](https://code.claude.com/docs/en/overview)

The goal of this version is to keep the from-scratch teaching style while moving the material closer to practical production coding agents.

## Scope

The first public version focuses on the TypeScript track, Chapters 1-16.

Python, Rust, Go, Java, Vibe Coding, and advanced TypeScript chapters after Chapter 16 are not part of v1. They may return later if they can be maintained with the same level of confidence as the public TypeScript material.

## TypeScript Changes

- Rebranded the TypeScript track around production AI coding agents rather than a general AI agent course.
- Reworked setup from an OpenAI-only path to OpenAI-compatible provider configuration with `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`.
- Swapped direct `openai(...)` model calls for `createOpenAI(...)` plus `provider.chat(...)`, which better matches OpenAI-compatible Chat Completions providers.
- Replaced OpenAI-native web search with a local Exa-backed `webSearch` tool so web search works with providers that do not expose OpenAI provider tools.
- Expanded setup instructions, project scaffolding, scripts, and type definitions.
- Updated eval chapters to support configurable models and judge models through environment variables.
- Expanded the production chapter with concrete sections on retries, persistent memory, sandboxing, prompt injection defense, rate and cost controls, tool result limits, parallel tool execution, cancellation, structured logging, planning, multi-agent orchestration, and real tool testing.
- Split the expanded hardening and architecture material into standalone chapters:
  `11-reliability.md`, `12-memory.md`, `13-security.md`, `14-tooling.md`, `15-agent-planning.md`, and `16-subagents.md`.
- Moved the advanced production track, Chapters 11-20, into ignored local drafts so it stays available for Phase 2 without appearing in the public book or public repository.
- Updated the TypeScript table of contents, book summary, and Chapter 9/10 navigation to reflect the new production track.

## Held-Back Python Draft

- The Python track is held locally as ignored draft material, but the first public release does not build, link, or commit it.

## Website and Repository Changes

- Revamped the landing page with a production coding-agent focus.
- Homepage, README, build script, and GitHub Pages workflow now expose only the TypeScript track for v1.
- Archived Python, Rust, Go, Java, Vibe Coding, advanced TypeScript drafts, and local developer notes under ignored local paths.
- Removed stale references to old GitHub Pages URLs, Frontend Masters wording, upstream Python companion branches, and single-provider setup assumptions from the public v1 surface.
