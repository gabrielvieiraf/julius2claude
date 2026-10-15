# Changelog

## 0.2.0

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
