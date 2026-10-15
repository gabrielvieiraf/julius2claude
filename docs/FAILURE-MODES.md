# What goes wrong when switching Claude Code accounts — and what julius2claude does about it

> This page is the engineering contract behind julius2claude. Every row names the test that proves it.

This list was built from public issue reports about running Claude Code with several accounts,
including the `anthropics/claude-code` tracker, and checked against the Claude Code 2.1.283 binary. Tests live in [`test/`](../test) and run
the real `j2c` supervisor against a fake `claude` that reproduces each failure.

## Critical — lose the login, or bill money

| # | What goes wrong | Root cause | What julius2claude does | Proven by |
|---|---|---|---|---|
| 1 | Logins die: `invalid_grant`, "please run /login", every few days | Tools **copy** a refresh token between slots. Refresh tokens are single-use, so whichever copy refreshes first kills the others | Each account lives in its own `CLAUDE_CONFIG_DIR` and logs in there. Credentials are **never copied, moved or symlinked** | `#1 credentials are never copied between profiles` |
| 2 | "Checking" an account logs it out | `claude auth status` / `doctor` refresh a near-expiry token and exit before saving the new one | Status and health checks only **read files**. `j2c` never runs auth commands to probe | `#2 status/doctor never spawn claude auth commands` |
| 3 | Idle accounts look dead | Access tokens last ~8 h; tools probe the usage API with an expired token and get 401 / 429 | An expired *access* token is normal (Claude refreshes it on next launch). Only a missing/zeroed token or an expired *refresh* token counts as "needs login". `doctor` warns 3 days before the refresh token expires | `#1/#3 login state comes from files` |
| 4 | `/logout` kills the account you meant to keep | Logging out revokes the token; switchers that swap one slot make this easy to do by accident | Every account has its own slot, so `/logout` in one profile only affects that profile. Switching never needs a logout | design (no shared slot) |
| 7 | Auto-switch and Claude's own "wait at limit" fight | Since 2.1.234 Claude waits at the limit and continues by itself | When auto-switch is on, `autoContinueAtUsageLimit: false` is injected for supervised sessions only | `#7 Claude's built-in wait-at-limit is disabled only when auto-switch is on`, e2e `hard limit` |
| 8 | Surprise bills | Pressing Enter on the limit menu can buy extra usage; failover silently lands on pay-per-token | julius2claude never sends keystrokes. Bedrock / Vertex / Foundry / API-key profiles are **never** used automatically unless you run `j2c auto on --paid` | `#8 pay-per-token profiles are never used automatically unless allowed` |

## High — lose work, or get fooled by the signal

| # | What goes wrong | What julius2claude does | Proven by |
|---|---|---|---|
| 5 | A nested `claude` (run by a tool) fires the hooks and kills/resumes the wrong session | The run id is baked into the `--settings` file of *that* claude process, not the environment, so nested processes never have our hooks. Events with `agent_id` or another `session_id` are ignored | `#5 hooks ignore subagent events, foreign sessions and unknown runs` |
| 6 | Two processes write the same transcript | The old process tree is stopped and confirmed gone before `--resume`. A session already open in another terminal is never moved | e2e `a claude that ignores Ctrl+C is escalated…` |
| 9 | `StopFailure` lies: no limit type, no reset time, fires ~14× per limit, reports old refusals after a resume | `StopFailure` is only a trigger. The real refusal (`quotaLimits.rateLimitType`, `resetsAt`) is read from the transcript — main and subagents — and only if newer than the current process. Debounced to one action. A plain 429 with no quota refusal is treated as capacity, not your limit, unless it repeats 3× in 10 min | `#9` tests (four of them) |
| 10 | Usage shows 0% when it is actually unknown | `rate_limits` from the statusLine (free, no network) is stored per account. Missing = unknown. A window past its `resets_at` = 0% | `#10 absent usage means unknown…` |
| 11 | Every switch silently burns 10–13 % of the new account's 5 h window (prompt cache is per org) | Switch early, at a turn boundary, with a minimum time on each account (`--dwell`, default 10 min) | `#23 minimum dwell…` |
| 13 | Switching kills work in flight: a tool call cut in half, background agents dead, the user's half-typed prompt lost | Switch **only right after a turn ends**. Proactive switches also wait for background subagents and background shell tasks, and never fire more than 3 s after the turn (so you're not typing). A hard refusal resumes with a prompt telling Claude to verify the cut-off tool call and restart stopped background tasks. A finished turn is resumed *without* injecting anything | `#13` unit test, e2e `background subagent delays…`, e2e `proactive…`, e2e `hard limit…` |
| 15 | All accounts exhausted → crash or busy loop | Stop cleanly, show the soonest reset, wait, and resume the same session there | e2e `every account exhausted…` |
| 16 | An `ANTHROPIC_API_KEY` in your shell or project silently overrides the subscription | Auth/provider variables are removed from the environment of supervised sessions; each profile sets only its own. Main settings' provider `env` never leaks into other profiles. Secrets are refused in `--env` | `#16` tests, e2e `an API key in the shell never reaches claude`, `secrets are refused` |

## Medium

| # | What goes wrong | What julius2claude does | Proven by |
|---|---|---|---|
| 17 | A symlinked `settings.json` / `.claude.json` silently becomes a copy (Claude writes via temp file + rename) | Only **directories** are linked (`projects`, `file-history`, `todos`, `tasks`, `plans`, `commands`, `skills`, `agents`, `output-styles`, `rules`). Files are generated or copied | `#17 only directories are linked` |
| 18 | Sharing history deletes files on first merge; removing a profile deletes shared data | Linking over an existing folder merges without overwriting (conflicts kept with a suffix). `remove --purge` unlinks shared folders before deleting | `#18` tests |
| 22 | Company work ends up on a personal account (or vice versa) | **Data groups**: a profile in group `work` has its own history and a session never moves across groups. **Strict folder binding**: `j2c bind corp ~/company --strict` refuses any other account there. The logged-in identity is checked by account + org id | `#22` tests, e2e `strict binding…` |
| 23 | Flapping between two accounts near the limit | The same threshold decides "leave" and "valid target"; minimum dwell time | `#23` tests |
| 24 | Reset times wrong across time zones | Only epoch `resets_at` values are used | design |
| — | Concurrent hooks corrupt state | All state writes are atomic (temp + fsync + rename) and locked | `state files survive concurrent writers` |
| — | Machine / WSL dies mid-reply | Every supervised session is in a crash ledger. `j2c recover` lists the ones that died mid-reply and resumes them in the right folder and account | e2e `crash mid-reply…` |
| 20 | Terminal left in raw mode / mouse mode after a kill | Ctrl+C first (graceful), then SIGTERM, then SIGKILL; terminal mode saved before launch and restored after | e2e `ignores Ctrl+C` |

## Known limits (not solved yet — honest list)

- **macOS**: logins live in the Keychain; julius2claude can't read their expiry, so login state shows "unknown". Not yet tested on real macOS.
- **Windows (native)**: shared folders use junctions; not yet tested. WSL2 is the tested path on Windows.
- **Per-model weekly caps** (Opus/Sonnet) aren't in the statusLine; they're learned from the first real refusal.
- **MCP servers with OAuth** need one login per profile.
- **Remote Control / cloud sessions** stay on the account they started on.
- Very large, long-idle sessions may show Claude Code's "resume from summary" prompt after a move.
- Many parallel sessions can all fail over to the same next account (no per-account session cap yet).
