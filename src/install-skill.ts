#!/usr/bin/env bun

import path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const SKILL_NAME = "ember-prd";
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";
const SKILLS_DIR = path.join(HOME, ".claude", "skills", SKILL_NAME);

const SKILL_CONTENT = `---
name: ember-prd
description: >
  Write and update PRDs for Ember, the PRD-driven autonomous coding loop.
  Use when the user says "write a PRD", "new PRD", "update PRD", "ember prd",
  "add acceptance criteria", or wants to create a task definition for Ember
  to execute autonomously.
---

# Ember PRD Assistant

Help the user write or update PRDs that Ember can parse and execute.

## PRD Format

Every PRD lives in \`docs/prd/\` and must follow this structure:

\`\`\`markdown
# <Title>

Priority: high | normal | low
Depends-On: <comma-separated PRD IDs, e.g. 001, 002>

<Optional description paragraph>

## Acceptance Criteria

- [ ] AC-001 <Short, testable statement>
- [ ] AC-002 <Short, testable statement>
- [ ] AC-003 <Short, testable statement>
\`\`\`

## Rules

### Filename
- Format: \`NNN-slug.md\` (e.g. \`001-auth.md\`, \`002-database.md\`)
- The numeric prefix is the PRD ID — must be unique and zero-padded to 3 digits
- Check \`docs/prd/\` for existing files to pick the next available number

### Priority
- \`high\` — do this first
- \`normal\` — default if omitted
- \`low\` — do this last

### Depends-On
- Optional. Lists PRD IDs that must complete before this one starts
- Format: \`Depends-On: 001, 003\`
- Omit the line entirely if there are no dependencies

### Acceptance Criteria
- Every criterion MUST have an \`AC-NNN\` ID prefix (e.g. \`AC-001\`)
- IDs must be unique within the PRD
- Each criterion should be a single testable statement
- Use \`- [ ]\` for pending, \`- [x]\` for already done
- Keep criteria small — if one is too big for a single work session, split it

## How to Help

### Writing a new PRD
1. Ask what the user wants to build
2. Identify the right filename (check existing PRDs for the next number)
3. Set priority and dependencies based on what exists
4. Break the work into small, testable acceptance criteria
5. Write the file to \`docs/prd/NNN-slug.md\`

### Updating an existing PRD
1. Read the existing PRD
2. Understand what needs to change
3. Preserve any \`[x]\` checked criteria (they're already done)
4. Keep existing AC IDs stable — add new ones, don't renumber
5. Write the updated file

### Good Acceptance Criteria
- Testable: "User can sign in with email" not "Auth works"
- Small: one criterion = one feature path, not a whole system
- Independent: each can be verified on its own
- Concrete: "API returns 401 for invalid token" not "Security is good"

### Bad Acceptance Criteria
- Too vague: "The system is fast"
- Too large: "All CRUD operations work for all entities"
- Untestable: "Code is clean"
- Compound: "User can sign in AND sign out AND reset password"

## Example

\`\`\`markdown
# User Authentication

Priority: high

Users need to sign in to access their data. Start with email/password,
add OAuth later.

## Acceptance Criteria

- [ ] AC-001 POST /auth/login accepts email and password, returns JWT
- [ ] AC-002 Invalid credentials return 401 with error message
- [ ] AC-003 JWT includes user ID and expires after 24 hours
- [ ] AC-004 Protected routes return 401 without valid JWT
\`\`\`
`;

function install() {
  if (!HOME) {
    console.error("Could not determine home directory.");
    process.exit(1);
  }

  const claudeDir = path.join(HOME, ".claude", "skills");
  if (!existsSync(claudeDir)) {
    console.error("~/.claude/skills/ not found. Is Claude Code installed?");
    process.exit(1);
  }

  mkdirSync(SKILLS_DIR, { recursive: true });
  writeFileSync(path.join(SKILLS_DIR, "SKILL.md"), SKILL_CONTENT);
  console.log(`Installed /ember-prd skill to ${SKILLS_DIR}`);
  console.log(`Use it in Claude Code with: /ember-prd`);
}

install();
