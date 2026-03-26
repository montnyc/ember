# Ember

PRD-driven autonomous coding loop. Describe what you want to build, and Ember generates a plan, breaks it into slices, and works through them using Claude — with a built-in TUI dashboard to watch it all happen.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated

## Install

```sh
bun add -g @montnyc/ember
```

## Getting Started

### Option A: Interactive (recommended)

```sh
cd your-project
ember
```

This launches the TUI dashboard. If no PRDs exist yet, you'll see an onboarding screen with options to generate one or create the directory manually.

### Option B: Command line

```sh
cd your-project

# Generate a PRD from a brief description
ember plan "Add user authentication with email/password login"

# Initialize (syncs PRDs, creates slices, selects model)
ember init

# Run autonomously
ember afk --max-slices 20

# Or run inside the TUI
ember afk --max-slices 20 --tui
```

### Option C: Manual PRDs

Create `docs/prd/001-feature-name.md`:

```markdown
# Feature Name

Priority: high

Description of what to build.

## Acceptance Criteria

- [ ] AC-001 First testable requirement
- [ ] AC-002 Second testable requirement
- [ ] AC-003 Third testable requirement
```

Then `ember init && ember afk`.

## Commands

| Command | Description |
|---------|-------------|
| `ember` | Launch TUI dashboard (onboarding if no PRDs) |
| `ember plan "<description>"` | Generate a PRD from a brief description |
| `ember init` | Interactive setup: select model, sync PRDs, install skill |
| `ember run [--slice <id>]` | Execute one slice |
| `ember afk [--max-slices N]` | Run slices autonomously |
| `ember afk --max-slices N --tui` | Run inside the TUI dashboard |
| `ember resume [--discard]` | Resume an interrupted run |
| `ember reset [--all]` | Reset stuck slices back to pending |
| `ember status` | Show PRD/slice progress |
| `ember install-skill` | Install the `/ember-prd` Claude Code skill |

## TUI Dashboard

Run `ember` with no arguments to open the interactive dashboard.

**Home screen:**
- Action menu with keyboard shortcuts (run all, quick run, generate PRD, sessions)
- PRD list with progress bars
- Run history with cost tracking
- Onboarding flow when no PRDs exist

**Run screen:**
- Live activity stream with animated tool calls (spinner + shimmer on active operations)
- Syntax-highlighted diff viewer
- File changes summary
- Persistent sidebar with session info, modified files, commands
- Command palette (`Ctrl+P`) for searching all actions
- Toggle sidebar (`b`), switch tabs (`1` `2` `3`)

**Sessions:**
- Browse past runs and their details
- Navigate with arrow keys

## How It Works

1. **PRDs** live in `docs/prd/*.md` with `AC-XXX` acceptance criteria
2. Ember creates one **slice** per criterion — each gets its own Claude session
3. For each slice:
   - **Pre-flight check** — catches existing failures before new work
   - **Claude works** — reads codebase, implements the criterion, commits
   - **Checks run** — your tests/typecheck verify the work
   - **Evaluator reviews** — a separate, skeptical Claude session checks for bugs
   - **Fix slices** — auto-created if checks or evaluator find issues
4. Context flows between slices via `EMBER.md` (project memory) and `.ember/progress.txt` (handoff notes)
5. After 3 consecutive "no changes needed" results, a criterion is auto-advanced

### Planner

`ember plan` reads your codebase and expands a brief description into a full PRD with 10-30 acceptance criteria:

```sh
ember plan "Build a REST API for user management with JWT auth"
# → docs/prd/001-user-management-api.md
```

### Evaluator

After each slice commits, a separate Claude session reviews the work:
- Fresh session (no self-evaluation bias)
- Prompted to be skeptical — assumes bugs exist until proven otherwise
- If issues found: commit is reverted, fix slice created with the evaluator's feedback

### Safety

- **Pre-flight checks** — tests run before work starts, failures go into the prompt
- **Circuit breaker** — stops after 5 consecutive errors
- **Fix slices** — auto-created when checks or evaluator fail (max 3 per failure)
- **Git revert** — broken commits reverted before fix slices run
- **Clean tree guard** — refuses to run on uncommitted changes (`--clean` to override)
- **Progress file** — `.ember/progress.txt` records what each slice did for cross-session context

## Config

`ember init` creates `.ember/config.json` with your selected model:

```json
{
  "runner": {
    "type": "claude",
    "model": "opus"
  },
  "loop": {
    "maxReviewIterations": 3,
    "maxAfkSlices": 10
  },
  "checks": {
    "default": ["bun test", "bunx tsc --noEmit"],
    "enabled": true
  }
}
```

**Tips:**
- Change `checks.default` to match your project (e.g. `["pytest", "mypy ."]` for Python)
- Set `checks.enabled: false` to skip checks if your test suite doesn't exist yet
- Set `loop.maxAfkSlices` higher for longer unattended runs
- Model choices: `opus` (best quality, slower), `sonnet` (fast, good enough for most work), `haiku` (fastest, cheapest)

## Claude Code Skill

`ember init` automatically installs `/ember-prd` — a Claude Code skill that helps you write and update PRDs in the correct format. Use it in any Claude Code session:

```
/ember-prd
```

Or install manually: `ember install-skill`

## Multiple PRDs

Ember works across multiple PRDs simultaneously. Create numbered files:

```
docs/prd/
  001-auth.md          (Priority: high)
  002-dashboard.md     (Priority: high, Depends-On: 001)
  003-notifications.md (Priority: normal)
```

Ember respects priority and dependencies — high-priority PRDs run first, and dependent PRDs wait until their dependencies are complete.

## Troubleshooting

**Slices stuck in failed/blocked state:**
```sh
ember reset --all
```

**Dirty working tree blocking runs:**
```sh
ember afk --max-slices 20 --clean
```

**Claude not making changes (no_changes loop):**
This usually means the criterion is already implemented. After 3 attempts, Ember auto-advances. If you disagree, reset the slice and try again:
```sh
ember reset --slice 001:ac-005
ember run --slice 001:ac-005
```

**Want to see what Ember will do before running:**
```sh
ember status
```

## License

MIT
