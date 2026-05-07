# 从零构建生产级 AI Coding Agent

[English](./README.md) | 简体中文

一门动手课程，带你从零实现一个 CLI AI coding agent，覆盖工具调用、流式输出、评测、上下文管理、文件系统访问、Shell 执行、人工审批，以及面向生产环境的安全与可靠性模式。

这门课从一个小而清晰的教学版 agent 架构开始，然后逐步靠近 OpenCode 和 Claude Code 这类真实 coding agent 的形态。

## 灵感与致谢

本项目受到以下项目启发：

- [sivakarasala/building-ai-agents](https://github.com/sivakarasala/building-ai-agents)
- [Hendrixer/agents-v2](https://github.com/Hendrixer/agents-v2)
- [OpenCode](https://opencode.ai/)
- [Claude Code](https://code.claude.com/docs/en/overview)

目标不是复制这些项目，而是用课程的方式讲清楚实用 coding agent 背后的架构，并补充更多生产环境相关主题、OpenAI-compatible provider 支持、更清晰的说明、问题修复和新的网页体验。

## 这个版本新增了什么

- 把原始 agent 架构扩展到更接近 OpenCode 和 Claude Code 这类生产级 coding agent 的方向
- 支持 OpenAI-compatible provider，而不是假设只使用单一模型厂商
- 增加更清晰的设置说明、细节解释，并修复学习过程中发现的小问题
- 加深上下文管理、工具安全、Shell 执行、人工审批、评测和生产准备相关内容
- 更新网站和课程定位，让项目在保留致谢的同时拥有自己的表达

主要差异可以查看 [Changes from Upstream](./CHANGES_FROM_UPSTREAM.md)。

## 当前发布范围

- **TypeScript**：Vercel AI SDK、Zod schema、React + Ink 终端 UI

第一版公开发布只包含 TypeScript Phase 1，也就是第 1 章到第 10f 章。Python 版本和后续 TypeScript 章节会先保留为草稿，等内容质量足够稳定后再发布。

## 你会构建什么

一个 CLI coding agent，可以：

- 使用 OpenAI-compatible LLM API 和结构化工具定义
- 流式输出回复，并在 agent loop 中执行工具
- 读取、写入、列出和删除文件
- 执行 Shell 命令和代码
- 搜索网页获取最新信息
- 通过 token 估算和压缩管理上下文窗口
- 在危险操作前请求人工审批
- 运行单轮和多轮评测
- 应用安全、可观测性、成本和可靠性相关的生产准备模式

## 本地开发

需要安装 [mdBook](https://rust-lang.github.io/mdBook/)。在 macOS 上可以用 Homebrew 安装：

```bash
brew install mdbook
./build.sh
```

如果你更喜欢 Cargo，也可以使用 `cargo install mdbook`。

构建完成后打开 `docs/index.html`。

## License

MIT
