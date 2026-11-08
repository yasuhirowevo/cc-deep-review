# cc-deep-review

English | [日本語](README.ja.md)

An Agent Skill that runs independent Claude Code / Codex reviews, validates findings, and repeats reviews until the findings stabilize.

It reviews a pull request or a committed branch against fixed inputs and checks findings against the code. Reviews run in fresh sessions until the final findings remain unchanged for two consecutive rounds, or the process reaches the limit of 20 rounds.

- Invoke the skill from either Claude Code or Codex.
- Configure Claude, Codex, or both as external reviewers.
- Report issue severity separately from how each finding should be handled in the current PR.
- Preserve commit SHAs, input digests, and execution records. Failed or incomplete reviews are never treated as zero findings.
- Save review artifacts under `tmp/reviews/` in the target repository without modifying the target code.

## Requirements

- Node.js 24, Git, Bash 4 or later, `jq`, `rg`, and standard Unix utilities
- For PR mode: an authenticated GitHub CLI (`gh`) with access to the target repository
- The CLI, account, and model required by each enabled external reviewer
  - Claude Code: a version supporting `--safe-mode`, `--model`, `--effort`, and Read/Grep/Glob tool restrictions
  - Codex: a version supporting `exec`, the read-only sandbox, and JSON output
- For Claude: `shasum` or `sha256sum`

Reviews pass the target code and diff to the selected external CLIs. More rounds can increase runtime and model usage, so start with a small PR or branch.

On Windows, use Git Bash and ensure the agent's PATH includes Git Bash, Node, `jq`, `gh`, and the enabled reviewer CLIs. On macOS, use Bash 4 or later instead of the bundled Bash 3.2.

## Installation

Clone the repository. While it is private, your GitHub account must have access.

```bash
gh repo clone yasuhirowevo/cc-deep-review
cd cc-deep-review
```

Install the skill for your host:

```bash
# Codex: ~/.agents/skills/cc-deep-review/
node scripts/install.mjs --target agents

# Claude Code: ~/.claude/skills/cc-deep-review/
node scripts/install.mjs --target claude

# To install for both, run this instead of the two commands above:
node scripts/install.mjs --target both
```

The installer copies the skill and creates an example reviewer configuration only if one does not already exist. A regular installation stops if the skill is already installed.

### 1. Configure the reviewers

Edit `~/.config/cc-deep-review/reviewer.env`. Replace the empty model and reasoning settings in the [configuration example](config/reviewer.env.example) with values supported by your CLIs. Empty values stop the process before a reviewer starts.

| Setting | Purpose |
|---|---|
| `CLAUDE_REVIEW_ENABLED` | Enable Claude: `true` / `false` |
| `CODEX_REVIEW_ENABLED` | Enable Codex: `true` / `false` |
| `CLAUDE_REVIEW_MODEL` / `CLAUDE_REVIEW_EFFORT` | Model and reasoning effort when Claude is enabled |
| `CODEX_REVIEW_MODEL` / `CODEX_REVIEW_REASONING_EFFORT` | Model and reasoning effort when Codex is enabled |

If you use only one reviewer, remove or comment out the model and effort lines for the disabled reviewer. At least one reviewer must be enabled. Environment variables with the same names take precedence over the configuration file. Set `DEEP_REVIEW_CONFIG_FILE` to use a different configuration file.

### 2. Configure the host

The installer generates host configuration files under `~/.config/cc-deep-review/setup/` using the actual installation paths.

**Codex:** To allow the fixed launchers without approving each invocation, place the generated `cc-deep-review.rules` at `~/.codex/rules/cc-deep-review.rules`. These rules allow only the fixed paths for preflight and validated launchers. Managed execution policies still apply.

**Claude Code:** Merge `env.BASH_MAX_TIMEOUT_MS` from the generated `claude-settings.json` into the `env` object in your `~/.claude/settings.json`. The value is `2400000` milliseconds to allow long reviewer runs to finish. If you want to preapprove the fixed launchers, append the generated `permissions.allow` entries to your existing array.

Do not replace your entire settings file with the generated example. The installer does not automatically modify host settings or permission rules.

After your host refreshes its skill list, use the skill in a new session.

## Usage

Exclude `/tmp/reviews/` from Git in the target repository using `.gitignore` or `.git/info/exclude` before running a review.

Open the Git repository you want to review and ask the agent:

```text
$cc-deep-review 123

$cc-deep-review https://github.com/OWNER/REPO/pull/123

$cc-deep-review --branch feature/example --base main
```

In Claude Code, you can also invoke `/cc-deep-review`. Branch mode reviews committed content and excludes uncommitted changes.

When the review finishes, the agent returns the report's absolute path and elapsed time. The report separates issue severity from the handling decision for each finding. CLI failures and input inconsistencies are reported as an incomplete review.

See [SKILL.md](skills/cc-deep-review/SKILL.md) for the workflow and [CONSTITUTION.md](skills/cc-deep-review/CONSTITUTION.md) for its governing principles. These skill documents are currently written in Japanese.

## Updates and configuration management

Use this repository as the source for skill updates. You can manage reviewer settings and installation instructions in your personal dotfiles. To install a specific version, check out its commit before running the installer.

```bash
git pull --ff-only
node scripts/install.mjs --target both --replace
```

`--replace` backs up the installed skill under `~/.config/cc-deep-review/backups/` before updating it. The backup includes any local edits. Your reviewer configuration is preserved. Apply the generated host configuration again if needed after updating.

Editing and managing the installed skill in another repository creates two sources to maintain. We recommend treating the installed copy as generated content and making changes in this repository.

## Development and testing

These tests do not connect to external AI services:

```bash
node --test tests/install.test.mjs
bash skills/cc-deep-review/scripts/test-regression.sh
```

GitHub Actions runs installation tests on Linux, macOS, and Windows, and review regression tests on Linux. The tests generate their own host configuration and do not require a developer's personal settings.

Some regression tests on Windows cannot launch Bash-based fake CLIs directly from Win32 Node. Run the full regression suite on Linux. See [regression verification](skills/cc-deep-review/references/regression-verification.md) for smoke tests using real models. Passing fake-CLI tests alone does not guarantee compatibility with every external CLI version or real-model review quality.

## License

[MIT](LICENSE)
