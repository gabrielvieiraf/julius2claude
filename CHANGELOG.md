# Changelog

## 0.2.0

- `j2c usage` and `/j2c:usage`: visual usage per profile (5-hour and weekly bars, reset times, tokens, blocks).
- Switched sessions keep their permission mode (auto mode included), model and effort.
- Status line warns near a limit and announces switches, including moves to another organization.
- Several supervised terminals share limits: when one is refused, the others move at the end of their next reply.
- `--no-binding` ignores directory bindings for one session.
- Login links are copied to the clipboard automatically; in a terminal, `c` copies and `o` opens the link.
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
