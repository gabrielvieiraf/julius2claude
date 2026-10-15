# Setting up julius2claude for a user

Instructions for an AI coding agent (for example Claude Code) that a user asked to install and
configure julius2claude. The goal is that the user only answers questions, opens login links and
pastes the code shown at the end of each login. You run every command.

## Rules

- Run commands yourself. Ask the user only for decisions and for login codes.
- Never ask for passwords, API keys or tokens. The only thing the user pastes is the one-time code
  shown at the end of a Claude login.
- Prefer `--json` output and read it instead of parsing text.
- Do not enable automatic switching, paid fallback or edit shell profile files without asking.
- Explain each step to the user in one or two short sentences, in the user's language.

## 1. Check prerequisites

```bash
node --version      # needs 18 or later
claude --version    # needs 2.1.152 or later
```

- If `claude` is missing, ask the user to install Claude Code from https://code.claude.com and stop.
- If Claude Code is older than 2.1.152, run `claude update`.
- If Node.js is missing or older than 18, ask the user to install a current LTS version and stop.

## 2. Install

```bash
npm install -g julius2claude
j2c --version
```

If the install fails with `EACCES`, do not use `sudo` without asking. Offer to configure a user
level npm prefix instead:

```bash
mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global
```

and ask before adding `export PATH="$HOME/.npm-global/bin:$PATH"` to the user's shell profile.

## 3. Register the current account

```bash
j2c setup
j2c status --json
```

`setup` registers the account Claude Code is already logged in to as the profile `main` and
installs the `/j2c:use`, `/j2c:next` and `/j2c:status` commands. Tell the user which email
`main` is (from `profiles[0].account`).

## 4. Ask which other accounts to add

Ask the user which accounts they want to use, for example:

- another Claude account (personal Pro or Max, company Team or Enterprise)
- Amazon Bedrock, Google Vertex AI, Microsoft Foundry
- an Anthropic API key

Choose short lowercase profile names (`work`, `company`, `aws`). For a company account, ask whether
its history must stay separate from personal history. If yes, add it with `--group company`.

## 5. Add a Claude account (repeat per account)

```bash
j2c add <name> --no-login [--group company]
j2c login <name> --start --json [--email <email>]
```

The second command returns:

```json
{"status": "waiting_for_code", "url": "https://claude.com/cai/oauth/authorize?...", "next": "j2c login <name> --code <code>"}
```

Send the user the `url` (when `copied` is true it is already in their clipboard) and tell them:

1. Open the link and sign in with the account intended for `<name>`. If the browser is already
   signed in to a different Claude account, use a private window.
2. At the end, a code is shown. Copy it and paste it here.

When the user pastes the code:

```bash
j2c login <name> --code <code> --json
```

- `"status": "logged_in"`: confirm the `email` and `org` with the user.
- If it is the wrong account: run `j2c login <name> --start --json` again and ask them to sign in
  with the right one.
- `"status": "failed"` (expired or mistyped code): run `--start` again and repeat.
- To abandon a pending login: `j2c login <name> --cancel`.

A warning that the account is the same as another profile means the user logged in with an
account that is already registered; ask whether that was intended.

## 6. Add cloud or API profiles (optional)

Amazon Bedrock uses the AWS credential chain (SSO or profiles). Ask for the AWS profile and region:

```bash
j2c add aws --bedrock --aws-profile <profile> --region <region>
```

If the user signs in with AWS SSO, they may need to run `aws sso login --profile <profile>` first.

Other providers:

```bash
j2c add gcp --vertex --project <gcp-project-id> --region <region>
j2c add az --foundry --resource <resource-name>
j2c add api --api-key-helper "<command that prints the key>"
```

Never put a key in `--env`; julius2claude refuses it.

## 7. Preferences

Ask, and apply only what the user accepts:

| Question | Command |
|---|---|
| Move sessions to the next account automatically when one reaches its limit? | `j2c auto on` |
| Also fall back to pay-per-token profiles (Bedrock, API key)? | `j2c auto on --paid` |
| Which account should be used first, second, ...? | `j2c order main work aws` |
| Should a directory always use a specific account? | `j2c bind <name> <dir> [--strict]` |
| Which account is the default for new sessions? | `j2c use <name>` |

## 8. Verify

```bash
j2c doctor
j2c status
```

`doctor` exits with status 1 when something needs attention and explains how to fix it.

## 9. Explain how to use it

Tell the user:

- Start Claude Code with `j2c` instead of `claude`, in a new terminal. It accepts the same
  arguments. The current session was not started through julius2claude and is not supervised.
- Inside Claude Code: `/j2c:status`, `/j2c:use <name>`, `/j2c:next`.
- After a crash or a WSL restart: `j2c recover`.

Offer to add `alias claude=j2c` to their shell profile, and only do it if they agree.
