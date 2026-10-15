# Changelog

## [0.3.0](https://github.com/gabrielvieiraf/julius2claude/compare/v0.2.0...v0.3.0) (2026-10-15)

### Features

* **cli:** add visual usage view and easier login links ([83e8d18](https://github.com/gabrielvieiraf/julius2claude/commit/83e8d18c857dc72484f9cf8982456ea1080523d4))
* **cli:** hand off sessions not started with j2c ([19eed17](https://github.com/gabrielvieiraf/julius2claude/commit/19eed17360aaa7a840ac05aa5537acc22bd82153))
* **supervisor:** keep sessions undisturbed across switches ([d0d9ab7](https://github.com/gabrielvieiraf/julius2claude/commit/d0d9ab7458611897ccb2ffbe45ca1df5e9030d93))

### Bug Fixes

* **router:** leave an account that refused requests right away ([b918ebd](https://github.com/gabrielvieiraf/julius2claude/commit/b918ebda38ac4d1fb58c210eb37962fca1742ee0))

## 0.2.0

- `j2c stats` and `/j2c:stats`: tokens per account (5 hours, 7 days, total) and, for each limit reached, how long into the window it happened and how many tokens it took.
- Two-step login for AI agents and scripts: `j2c login <name> --start`, `--code <code>`, `--cancel`, with `--json` output.
- `j2c add` no longer waits for an interactive login when run without a terminal; it returns the login link instead.
- `docs/AGENT-SETUP.md`: step-by-step guide that lets Claude Code install and configure julius2claude for the user.

## 0.1.0 — 2026-10-15

First release.

- Profiles for claude.ai accounts (Pro/Max/Team/Enterprise), Amazon Bedrock, Google Vertex, Microsoft Foundry and API-key helpers, each in its own `CLAUDE_CONFIG_DIR`.
- Supervisor that moves a session to the next account at a turn boundary and resumes the same conversation (opt-in `j2c auto on`).
- Limit detection from the statusLine `rate_limits` and from quota refusals in transcripts (main and subagents).
- `/j2c:use`, `/j2c:next`, `/j2c:status` inside Claude Code; status line with account and usage.
- Folder bindings (with strict mode) and data groups.
- Crash recovery (`j2c recover`) and `j2c doctor`.
