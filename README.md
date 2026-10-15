**English** | [Português](https://github.com/gabrielvieiraf/julius2claude/blob/main/README.pt-BR.md)

# julius2claude

Multi-account routing and usage-limit failover for Claude Code.

<p align="center">
  <a href="https://tenor.com/view/money-terry-crews-spilled-milk-thrifty-gif-7197529"><img src="https://media.tenor.com/x5fKOq1dsNYAAAAC/money-terry-crews.gif" alt="Julius from Everybody Hates Chris: that's 49 cent of spilled milk dripping all over my table" width="480"></a>
</p>

[![npm](https://img.shields.io/npm/v/julius2claude?color=cb3837&logo=npm)](https://www.npmjs.com/package/julius2claude)
[![CI](https://github.com/gabrielvieiraf/julius2claude/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielvieiraf/julius2claude/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/gabrielvieiraf/julius2claude/blob/main/LICENSE)

## Overview

julius2claude (command `j2c`) runs the official Claude Code CLI across several accounts that belong
to you: a personal Claude Pro or Max plan, a company Team or Enterprise plan, Amazon Bedrock,
Google Vertex AI, Microsoft Foundry, or an Anthropic API key.

Each account keeps its own login. Conversation history is shared between accounts of the same
group. When the active account reaches its 5-hour or weekly usage limit, the session can move to
the next account at the end of the current reply and resume the same conversation in the same
directory.

## Features

- **Profiles per account.** Each profile runs Claude Code with its own `CLAUDE_CONFIG_DIR`, the
  setup Anthropic documents for using several accounts. Credentials are never copied between
  profiles.
- **Limit failover (opt-in).** Detects the 5-hour, weekly and per-model weekly limits and moves the
  session to the next eligible profile at a turn boundary.
- **No interrupted work.** A switch never happens during a tool call. Proactive switches wait for
  background subagents and background shell tasks to finish.
- **Cloud and API providers.** Amazon Bedrock, Google Vertex AI, Microsoft Foundry and API key
  profiles. Pay-per-token profiles are only used automatically when explicitly allowed.
- **Directory bindings.** Bind a directory to a profile, optionally in strict mode, so a company
  repository only runs on the company account.
- **Data groups.** Profiles in different groups never share history, and a session never moves
  across groups.
- **Crash recovery.** Sessions interrupted mid-reply by a crash, a WSL restart or a closed terminal
  can be listed and resumed with `j2c recover`.
- **Claude Code integration.** `/j2c:use`, `/j2c:next` and `/j2c:status` commands, plus a status
  line with the active profile and its usage.

## Requirements

- Claude Code 2.1.152 or later (2.1.248 or later recommended)
- Node.js 18 or later
- Linux, WSL2 or macOS. Native Windows support is experimental.

## Installation

### Let Claude Code set it up

Open Claude Code and send:

```text
Install and set up julius2claude for me. Follow https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/AGENT-SETUP.md
```

Claude installs the package, asks which accounts you use, sends you a login link for each one and
finishes the configuration. You only sign in and paste the code shown at the end of each login.

### Manual installation

```bash
npm install -g julius2claude
```

To install the latest commit from GitHub instead:

```bash
npm install -g github:gabrielvieiraf/julius2claude
```

## Quick start

```bash
j2c setup              # registers your current Claude Code login as the "main" profile
j2c add work           # adds a second account and opens its login
j2c                    # starts Claude Code; accepts the same arguments as `claude`
```

Automatic switching is disabled by default:

```bash
j2c auto on
```

To route every session through julius2claude, add `alias claude=j2c` to your shell profile.

## Configuration

### Profiles

```bash
j2c add work                                         # claude.ai account (Pro, Max, Team, Enterprise)
j2c add corp --group company                         # separate data group
j2c add aws --bedrock --aws-profile dev --region us-east-1
j2c add gcp --vertex --project my-project --region us-east5
j2c add az --foundry --resource my-foundry
j2c add api --api-key-helper "op read op://dev/anthropic/key"
j2c login <profile>                                  # log in again
j2c login <profile> --start | --code <code>          # two-step login, used by AI agents
```

During `j2c login`, press `c` to copy the login link or `o` to open it in the browser, then paste
the code. The link is also copied to the clipboard automatically when possible.

```bash
j2c remove <profile> [--purge]
```

julius2claude does not store secrets. Bedrock and Vertex profiles use the standard AWS and Google
Cloud credential chains. API keys are read at runtime from the command passed to
`--api-key-helper`. A Bedrock profile can also be configured with `/setup-bedrock` inside a
session started with `j2c -P <profile>`.

### Failover order and automatic switching

```bash
j2c order main work aws
j2c auto on [--paid] [--5h 95] [--weekly 98] [--dwell 10]
j2c auto off
```

| Option | Default | Description |
|---|---|---|
| `--5h` | 95 | Switch when the 5-hour window reaches this percentage |
| `--weekly` | 98 | Switch when the weekly window reaches this percentage |
| `--dwell` | 10 | Minimum minutes on a profile before a proactive switch |
| `--paid` | off | Allow automatic failover to pay-per-token profiles |

A profile that refuses a request (usage limit, authentication error, organization policy) is left
immediately, regardless of `--dwell`. When every eligible profile is exhausted, julius2claude waits
for the earliest reset and resumes the session there.

### Directory bindings

```bash
j2c bind corp ~/company --strict
j2c unbind ~/company
```

A binding selects the profile for new sessions started in that directory and its subdirectories.
In strict mode, no other profile can run there.

## Usage

```bash
j2c                     # start on the bound profile, or the default one
j2c -P work             # start on a specific profile
j2c -c                  # continue the last conversation in this directory, supervised
j2c --no-binding        # ignore directory bindings for this session
j2c use work            # set the default profile
j2c usage               # visual usage of every profile: 5h and weekly bars, resets, tokens
j2c status [--json]     # profiles, usage, reset times
j2c stats [--days N]    # tokens per profile and time taken to reach each limit
j2c recover [n]         # list or resume interrupted sessions
j2c rescue [n] [--model sonnet]  # move a session stuck at a limit to the next account
j2c doctor              # diagnose common problems
```

Inside Claude Code:

| Command | Description |
|---|---|
| `/j2c:usage` | Visual usage of every profile |
| `/j2c:status` | Profiles, usage and the profile of the current session |
| `/j2c:stats` | Tokens per profile and time taken to reach each limit |
| `/j2c:use <profile>` | Move the current session to a profile at the end of the reply |
| `/j2c:next` | Move the current session to the next profile with available usage |

The status line shows the active profile and its usage, for example
`j2c main · 5h ▰▰▰▰▱ 82% · 7d 31%`. It warns when a profile is close to its limit, and after a
switch it shows where the session came from and why, including moves to another organization. An
existing custom status line is kept and displayed below it.

A switched session resumes with the permission mode (for example auto mode), model and effort it
had, so it keeps working without new permission prompts.

### Rescuing a session stuck at a limit

A session started with plain `claude` cannot switch by itself, and once it hits a limit it refuses
every message, including `/j2c:next`. Run `j2c rescue` from any terminal:

```bash
j2c rescue                    # sessions stuck at a limit, newest first
j2c rescue 1 --model sonnet   # close it, then resume it here on the next account
```

It lists the account and limit that stopped each session, when the limit resets and which background
agents were cut. On confirmation it closes the stuck process, records the limit, resumes the same
conversation on the next available profile and asks Claude to check what the cut agents finished and
re-run only what is missing. `--model` also applies to the agents it re-runs.

### Several terminals

Every terminal started with `j2c` is supervised, and they share the same profiles and limits. When
one terminal reaches a limit, the others on that profile move at the end of their next reply,
without sending a request that would be refused. Sessions started with plain `claude` are not
supervised; restart them with `j2c -c` in the same directory.

### Usage statistics

`j2c stats` reports, for each profile:

- tokens used in the last 5 hours, the last 7 days and in total, split into input, output, cache
  read and cache write
- how many times each limit (5-hour, weekly, weekly per model) was reached, how long after the start
  of its window on average, and how many tokens were used in that window
- how many early switches happened at your thresholds, and how many sessions moved away from and
  onto the profile

```text
main (me@personal.dev)
  tokens   last 5h 4.1M · last 7 days 38.2M · total 112.5M
           input 41.0k · output 1.9M · cache read 104.3M · cache write 6.3M
  5-hour limit: reached 3 times, after 3h 12m on average, ~4.0M tokens per window
  weekly limit: reached 1 time, after 4d 6h on average, ~36.9M tokens per window
  switches  4 away · 1 onto this account
```

Tokens are read from the session transcripts of sessions started with `j2c`, and each reply is
counted once, on the profile that produced it. Use `--json` for scripts and `--days N` to limit the
period.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/gabrielvieiraf/julius2claude/main/docs/how-it-works.svg" alt="Flow: j2c starts claude per profile; usage and session state are tracked; when a limit is reached and the turn has finished, claude is stopped and the same session is resumed on the next profile" width="560">
</p>

1. **Isolation.** `~/.claude` remains the main profile. Other profiles live in
   `~/.julius2claude/profiles/<name>`. History, commands, skills and agents are shared through
   directory links. Files are never linked, because Claude Code replaces files atomically.
2. **Usage tracking.** Claude Code sends `rate_limits` (5-hour and 7-day percentages and reset
   times) to the status line after each response. julius2claude stores these values per profile.
   It makes no network requests.
3. **Limit detection.** When a request is refused, Claude Code records the limit type and reset time
   in the session transcript. julius2claude reads that record when the `StopFailure` hook fires,
   including transcripts of subagents.
4. **Switching.** After the reply ends, julius2claude stops the `claude` process tree (SIGINT, then
   SIGTERM, then SIGKILL), restores the terminal state and runs `claude --resume <session>` with
   the next profile in the same directory. If the reply was cut off by a limit, the resumed session
   is instructed to verify the last tool call before continuing.

## Reliability

Every known failure mode of account switching for Claude Code is documented in
[docs/FAILURE-MODES.md](https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/FAILURE-MODES.md), together with the mitigation and the automated
test that covers it. Highlights:

- Refresh tokens are single-use. Copying them between accounts invalidates the login, so
  julius2claude never copies credentials.
- Health checks only read files. Commands such as `claude auth status` can rotate a token and are
  never executed.
- Claude Code's built-in wait at the usage limit is disabled for supervised sessions while
  automatic switching is on.
- Authentication variables from the shell (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK` and
  others) are removed so they cannot silently override a profile.
- All state is written atomically and under a lock.

## FAQ

**How do I use two Claude accounts in Claude Code?**
Add each additional account with `j2c add <name>` and start sessions with `j2c -P <name>`. Sessions
on different profiles can run at the same time.

**How do I switch accounts when Claude Code reaches its usage limit?**
Run `/j2c:next` inside the session, or enable automatic switching with `j2c auto on`.

**Is the conversation preserved after a switch?**
Yes. The same session is resumed in the same directory. Because the prompt cache is scoped to each
account, the first request on the new account processes the full context again. julius2claude
keeps the number of switches low for this reason.

**Does it support Amazon Bedrock?**
Yes. Create a profile with `j2c add <name> --bedrock`. Automatic failover only uses it after
`j2c auto on --paid`.

**How do I keep company work on the company account?**
Put the company profile in its own group (`j2c add corp --group company`) and bind the company
directories to it in strict mode (`j2c bind corp ~/company --strict`).

**What happens if the machine or WSL stops during a task?**
Run `j2c recover` and select the session. It resumes in its original directory and profile.

**Does it work with the VS Code extension or Claude Desktop?**
No. julius2claude supervises the `claude` terminal process.

**Is it compatible with Anthropic's terms?**
julius2claude only launches the official Claude Code with Anthropic's own login flow and uses the
multi-account setup described in the Claude Code documentation. It does not copy, share or proxy
credentials. Use it only with accounts that belong to you, and follow your employer's policies.
Anthropic's usage limits assume ordinary individual use, and rotating several accounts to bypass
them may violate the terms; automatic switching is disabled by default for this reason.
julius2claude is not affiliated with Anthropic.

## Platform support

| Platform | Status |
|---|---|
| Linux | Supported |
| WSL2 | Supported. Keep `~/.julius2claude` on the Linux filesystem. |
| macOS | Beta. Login expiry is stored in the Keychain and shown as unknown. |
| Windows | Experimental. Shared directories use junctions. |

## Data and privacy

- No telemetry.
- Token values are never read or written. Only expiry timestamps are read.
- State is stored in `~/.julius2claude`: configuration, usage snapshots and a session ledger used
  for recovery. Logs are written to `~/.julius2claude/j2c.log`.

## Development

```bash
git clone https://github.com/gabrielvieiraf/julius2claude
cd julius2claude
npm install
npm test
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) and are checked on commit. Releases, the changelog and npm publishing are automated from them.

Architecture, data layout and invariants are described in [AGENTS.md](https://github.com/gabrielvieiraf/julius2claude/blob/main/AGENTS.md). Please include
the output of `j2c doctor` in bug reports.

## License

[AGPL-3.0](https://github.com/gabrielvieiraf/julius2claude/blob/main/LICENSE). If you distribute a modified version, including as a network service, you
must make its source available under the same license.

The name refers to Julius, the father in *Everybody Hates Chris*, who works two jobs and keeps
track of every cent.
