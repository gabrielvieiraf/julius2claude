# Changelog

## 0.1.0 — 2026-10-15

First release.

- Profiles for claude.ai accounts (Pro/Max/Team/Enterprise), Amazon Bedrock, Google Vertex, Microsoft Foundry and API-key helpers, each in its own `CLAUDE_CONFIG_DIR`.
- Supervisor that moves a session to the next account at a turn boundary and resumes the same conversation (opt-in `j2c auto on`).
- Limit detection from the statusLine `rate_limits` and from quota refusals in transcripts (main and subagents).
- `/j2c:use`, `/j2c:next`, `/j2c:status` inside Claude Code; status line with account and usage.
- Folder bindings (with strict mode) and data groups.
- Crash recovery (`j2c recover`) and `j2c doctor`.
