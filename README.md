# Ember

PRD-driven autonomous coding loop. Write PRDs with acceptance criteria, Ember breaks them into slices and executes each through a **work → review → checks → gate** pipeline using Claude CLI.

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Install

```sh
bun add -g @montnyc/ember
```

## Quick Start

```sh
# 1. Create a PRD
mkdir -p docs/prd
cat > docs/prd/001-greeting.md << 'EOF'
# Greeting CLI

Priority: high

## Acceptance Criteria

- [ ] AC-001 Running `bun run greet.ts Alice` prints "Hello, Alice!"
- [ ] AC-002 Running with no arguments prints "Hello, World!"
EOF

# 2. Initialize
ember init

# 3. Run one slice
ember run

# 4. Or run unattended
ember afk --max-slices 5
```

## Commands

| Command | Description |
|---------|-------------|
| `ember init` | Initialize `.ember/` and sync PRDs |
| `ember run [--slice <id>]` | Execute one slice |
| `ember afk [--max-slices N]` | Run slices until done or cap |
| `ember resume [--discard]` | Resume an interrupted run |
| `ember status` | Show PRD/slice/history dashboard |

## How It Works

1. **PRDs** live in `docs/prd/*.md` with `AC-XXX` acceptance criteria
2. **Slices** are small units of work: `tracer` → `expand` → `polish`
3. Every new PRD starts with a **tracer slice** that proves the critical path
4. Each slice runs through: **work** (Claude writes code) → **review** (Claude reviews the diff) → **checks** (your test/typecheck commands) → **gate** (Claude decides done/iterate/blocked)
5. State persists in `.ember/state.json`, project memory in `EMBER.md`

## Commit Policy

Controls whether the work prompt tells Claude to commit or not:

- **`"ember"`** (default) — prompt says "do not commit". Ember commits after the gate passes.
- **`"model"`** (`--allow-commits`) — prompt says "create a commit". Useful if you want commit-per-step history.

## Config

`.ember/config.json`:

```json
{
  "runner": { "type": "claude", "model": "sonnet" },
  "loop": { "maxReviewIterations": 3, "maxAfkSlices": 10 },
  "checks": { "default": ["bun test", "bunx tsc --noEmit"] },
  "commitPolicy": "ember"
}
```

## License

MIT
