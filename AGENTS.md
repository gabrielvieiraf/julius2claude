# AGENTS.md — julius2claude architecture

For humans and coding agents working on this repo. User docs: [README.md](README.md).

## What it is

`j2c` supervises the official `claude` binary. It never talks to Anthropic itself, never reads
token values, and never copies credentials. Everything it does goes through documented Claude Code
surfaces: `CLAUDE_CONFIG_DIR`, `--settings`, hooks, the statusLine JSON, `--resume`.

## Layout

```
src/
  cli.ts          argument parsing and every user command (setup, add, login, status, use, bind, auto, recover, doctor)
  supervisor.ts   launches claude, watches the run, stops it at a turn boundary and resumes on the next account
  hooks.ts        `j2c hook <event> --run <id>`: SessionStart/UserPromptSubmit/Stop/StopFailure/SessionEnd/Subagent*
  statusline.ts   `j2c statusline --run <id>`: records rate_limits, requests proactive switches, renders the line
  router.ts       pure decisions: is a profile usable, which one is next, may this folder use it
  usage.ts        per-account usage snapshots and blocks; reads quota refusals from transcripts
  profiles.ts     profile folders: directory links, generated settings, seeded .claude.json, identity, login state
  runs.ts         run state (one per supervised launch chain) and the crash-recovery session ledger
  store.ts        atomic JSON writes + lockfiles (every state write goes through here)
  proc.ts         process tree, signals, terminal restore, claude version
  slash.ts        writes /j2c:use, /j2c:next, /j2c:status into ~/.claude/commands/j2c/
  config.ts       config schema (profiles, order, bindings, autoSwitch)
  paths.ts        all paths; J2C_HOME / J2C_CLAUDE_DIR / J2C_CLAUDE_JSON / J2C_CLAUDE_BIN override them (tests)
test/
  fake-claude.mjs a scriptable stand-in for `claude` (hooks, statusLine, transcripts, login, SIGINT)
  units.test.mjs  one test per failure mode in docs/FAILURE-MODES.md
  e2e.test.mjs    the real supervisor against fake-claude
dist/j2c.mjs      the published single-file bundle (committed so GitHub installs work)
```

## Data on disk

```
~/.julius2claude/
  config.json                profiles, failover order, bindings, autoSwitch
  profiles/<name>/           CLAUDE_CONFIG_DIR of each non-main profile
    projects -> ~/.claude/projects        (directory links; groups != default link to groups/<g>/)
    settings.json            generated from ~/.claude/settings.json at each launch (provider env stripped)
    .claude.json             seeded once from ~/.claude.json without account keys
    .credentials.json        written by Claude Code's own login; j2c only reads expiry fields
  state/usage.json           per-profile 5h/7d snapshots, blocks (until, reason, type), enteredAt
  state/runs/<id>.json       live run: profile, sessionId, busy, lastStopAt, pendingSwitch, agents
  state/runs/<id>.settings.json  --settings for that run (hooks + statusLine, run id baked in)
  state/sessions/<id>.json   crash ledger (busy/idle/ended + supervisor pid)
```

## Invariants — don't break these

1. Never copy, move or symlink `.credentials.json`. Never spawn `claude auth status`/`doctor` to probe.
2. Link directories only. Claude Code writes files with temp+rename, which detaches file links.
3. Hooks get the run id from argv (`--run`), never from env, so nested `claude` processes can't act on our run.
4. Switch only when `!busy && lastStopAt >= requestedAt`; proactive switches also need no subagents,
   no extra background processes and `now - lastStopAt <= BOUNDARY_MS`.
5. Stop the whole process tree and confirm it's gone before `--resume`.
6. Pay-per-token profiles are only automatic with `autoSwitch.allowPaid`.
7. A session never moves across data groups or into a folder whose strict binding forbids the profile.
8. All state writes go through `store.ts` (atomic + locked).

Each invariant has a test; add one when you add behaviour.

## Commands

```bash
npm install
npm run typecheck
npm test            # builds dist/, compiles src/ to .test-build/, runs node:test
```

Commit `dist/j2c.mjs` together with source changes (`npm run build`).
