# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Please do not open a public issue. Expect a first answer within 7 days.

## Supported versions

Only the latest published version receives fixes.

## What julius2claude touches

julius2claude runs the official `claude` binary. It never reads or writes token values, never
proxies requests and never sends data anywhere.

| Path | Access |
|---|---|
| `~/.julius2claude/` | Read and write: configuration, usage snapshots, session ledger, logs |
| `~/.julius2claude/profiles/<name>/` | Created per profile; Claude Code writes its own login here |
| `<profile>/.credentials.json` | Read only, and only the expiry timestamps, to report login health |
| `~/.claude/settings.json`, `~/.claude.json` | Read only, to give new profiles the same settings, MCP servers and trust decisions, without account fields |
| `~/.claude/projects/` | Read only, to detect usage limits and count tokens from session transcripts |
| `~/.claude/commands/j2c/` | Written once by `j2c setup` (the `/j2c:*` commands) |
| `~/.claude/sessions/` | Read only, to find which process holds a session for `j2c rescue` |
| The directory that contains `j2c` | `claude-<profile>` launcher scripts |

Network: none. The only processes started are `claude`, `ps`, `stty`, and, when you ask for it, the
system clipboard or browser opener.

## Design rules

- Credentials are never copied, moved or linked between profiles.
- Authentication variables from the shell are removed before `claude` starts, so they cannot
  override a profile.
- Secrets are refused in profile settings; API keys are only read through a command you choose.
- State is written atomically with restrictive permissions (`0600`).

## Releases

Every release is built and published by GitHub Actions through npm trusted publishing, with
provenance that links the package to the exact commit and workflow run.
