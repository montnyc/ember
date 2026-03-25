# Ember

PRD-driven autonomous coding loop. Write a brief description or a detailed PRD, and Ember breaks it into slices — one per acceptance criterion — and works through them using Claude CLI.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated

## Getting Started

```sh
# Install globally
bun add -g @montnyc/ember

# In your project, generate a PRD from a description
cd your-project
ember plan "Add user authentication with email/password login"

# Initialize (syncs PRDs, creates slices, installs Claude Code skill)
ember init

# Check what Ember will do
ember status

# Run all slices autonomously
ember afk --max-slices 20

# Or run one slice at a time
ember run
```

## Commands

| Command | Description |
|---------|-------------|
| `ember` | Launch interactive TUI dashboard |
| `ember plan "<description>"` | Generate a PRD from a brief description |
| `ember init` | Sync PRDs, create slices, install skill |
| `ember run [--slice <id>]` | Execute one slice |
| `ember afk [--max-slices N]` | Run slices autonomously until done or cap |
| `ember resume [--discard]` | Resume an interrupted run |
| `ember reset [--all]` | Reset stuck slices back to pending |
| `ember status` | Show PRD/slice progress |
| `ember install-skill` | Manually install the /ember-prd Claude Code skill |

## How It Works

1. **PRDs** live in `docs/prd/*.md` with `AC-XXX` acceptance criteria
2. Ember creates one **slice** per criterion
3. For each slice, Ember:
   - Runs a **pre-flight check** (catches existing failures before new work)
   - Spawns **Claude** with a focused work prompt + session ID
   - Checks for changes and **commits**
   - Runs your **checks** (tests, typecheck) — failures create fix slices
   - Runs a **skeptical evaluator** (separate Claude session that reviews the work)
4. State persists in `.ember/state.json`, project memory in `EMBER.md`, progress notes in `.ember/progress.txt`
5. If Claude reports no changes needed 3 times, the criterion is auto-advanced

### Planner

`ember plan` expands a brief description into a full PRD:

```sh
ember plan "Build a REST API for user management with JWT auth"
# → Generates docs/prd/001-user-management-api.md with 15-30 acceptance criteria
```

The planner reads your codebase first, so it references existing files, conventions, and tech stack.

### Evaluator

After each slice commits, a separate Claude session reviews the work. The evaluator:
- Runs in a **fresh session** (no self-evaluation bias)
- Is prompted to be **skeptical** — assumes bugs exist until proven otherwise
- Checks functionality, correctness, scope, and completeness
- If it finds issues, Ember reverts the commit and creates a fix slice

### Safety

- **Pre-flight checks**: tests/typecheck run before work starts. Failures go into the prompt.
- **Circuit breaker**: stops after 5 consecutive errors
- **Fix slices**: auto-created when checks or evaluator fail (max 3 per failure)
- **Git revert**: broken commits are reverted before fix slices run
- **Timeout**: Claude calls killed after 10 minutes (configurable)
- **Clean tree guard**: refuses to run on uncommitted changes (use `--clean` to override)

## Writing PRDs

PRDs live in `docs/prd/` and follow this format:

```markdown
# Feature Title

Priority: high | normal | low
Depends-On: 001, 002

Description of what to build.

## Acceptance Criteria

- [ ] AC-001 Short, testable statement
- [ ] AC-002 Another testable statement
```

Use `ember plan` to generate these automatically, or the `/ember-prd` Claude Code skill for interactive help.

## Config

`.ember/config.json` (created by `ember init`):

```json
{
  "runner": {
    "type": "claude",
    "model": "sonnet",
    "timeoutMs": 600000
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

Customize `checks.default` for your project's test/lint commands. Set `checks.enabled: false` to skip checks.

## TUI

Run `ember` with no arguments to launch the interactive terminal dashboard:
- PRD progress with visual bars
- Run history
- Live activity stream during execution
- Diff viewer with syntax highlighting
- File change summary

## License

MIT
