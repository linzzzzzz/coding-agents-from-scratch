# Changes from Upstream

This course is inspired by:

- [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents)
- [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)
- [OpenCode](https://opencode.ai/)
- [Claude Code](https://code.claude.com/docs/en/overview)

The goal of this version is to keep the from-scratch teaching style while moving the material closer to practical production coding agents.

## Scope

The first public version focuses on the TypeScript and Python tracks.

Rust, Go, Java, and Vibe Coding drafts are not part of v1. They may return later if they can be maintained with the same level of confidence as the TypeScript and Python material.

## TypeScript Changes

- Rebranded the TypeScript track around production AI coding agents rather than a general AI agent course.
- Reworked setup from an OpenAI-only path to OpenAI-compatible provider configuration with `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`.
- Swapped direct `openai(...)` model calls for `createOpenAI(...)` plus `provider.chat(...)`, which better matches OpenAI-compatible Chat Completions providers.
- Replaced OpenAI-native web search with a local Exa-backed `webSearch` tool so web search works with providers that do not expose OpenAI provider tools.
- Expanded setup instructions, project scaffolding, scripts, and type definitions.
- Updated eval chapters to support configurable models and judge models through environment variables.
- Expanded the production chapter with concrete sections on retries, persistent memory, sandboxing, prompt injection defense, rate and cost controls, tool result limits, parallel tool execution, cancellation, structured logging, planning, multi-agent orchestration, and real tool testing.

## Python Changes

- Rebranded the Python track around production AI coding agents while keeping it as the approachable mental-model path.
- Removed chapter-level handoff notes that pointed readers to upstream companion-repo branches.
- Updated setup language from `OPENAI_API_KEY` toward provider-neutral `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL`.
- Kept the Python track focused on clarity and conceptual transfer rather than maximum framework coverage.

## Website and Repository Changes

- Revamped the landing page with a production coding-agent focus.
- Homepage, README, reading guide, and build script now expose only TypeScript and Python for v1.
- Archived Rust, Go, Java, and Vibe Coding drafts locally under `archive/`, which is ignored by git.
- Removed stale references to old GitHub Pages URLs, Frontend Masters wording, upstream Python companion branches, and single-provider setup assumptions from the public v1 surface.
