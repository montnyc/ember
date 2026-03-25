import path from "node:path";
import { Glob } from "bun";
import { spawnClaude } from "./runner";
import { loadConfig } from "./config";

/**
 * Generate a PRD from a brief description using Claude as a planner agent.
 * Writes the PRD to docs/prd/NNN-slug.md in the correct format for Ember.
 */
export async function generatePrd(
  description: string,
  projectRoot: string
): Promise<string> {
  const config = await loadConfig(projectRoot);
  const prdDir = path.join(projectRoot, "docs", "prd");

  // Find next PRD number
  const nextId = await getNextPrdId(prdDir);
  const paddedId = String(nextId).padStart(3, "0");

  const prompt = buildPlannerPrompt(description, paddedId, projectRoot);

  console.log(`Planning PRD ${paddedId} from: "${description}"`);
  console.log(`This may take a minute...\n`);

  const result = await spawnClaude(prompt, config, projectRoot);

  if (result.exitCode !== 0) {
    throw new Error(`Planner failed with exit code ${result.exitCode}`);
  }

  // Extract the PRD content from Claude's output
  const prdContent = extractPrdContent(result.output, paddedId, description);

  // Generate slug from description
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const filename = `${paddedId}-${slug}.md`;
  const filepath = path.join(prdDir, filename);

  // Ensure docs/prd/ exists
  await Bun.$`mkdir -p ${prdDir}`.quiet();
  await Bun.write(filepath, prdContent);

  console.log(`\nWritten: docs/prd/${filename}`);
  console.log(`Run 'ember init' to sync, then 'ember afk' to start.`);

  return filepath;
}

async function getNextPrdId(prdDir: string): Promise<number> {
  try {
    const glob = new Glob("*.md");
    let maxId = 0;
    for await (const file of glob.scan(prdDir)) {
      const match = file.match(/^(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
      }
    }
    return maxId + 1;
  } catch {
    return 1;
  }
}

function buildPlannerPrompt(description: string, prdId: string, projectRoot: string): string {
  // Check if CLAUDE.md exists for project context
  const claudeMdRef = Bun.file(path.join(projectRoot, "CLAUDE.md")).size > 0
    ? "@CLAUDE.md\n" : "";

  return `${claudeMdRef}You are a product planner for an autonomous coding tool called Ember.

The user wants to build something. Your job is to expand their brief description into a detailed PRD (Product Requirements Document) that Ember can execute autonomously, one acceptance criterion at a time.

## User's Description

"${description}"

## Instructions

1. First, explore the existing codebase to understand the project structure, tech stack, and conventions.
2. Then write a PRD in EXACTLY this format:

\`\`\`markdown
# <Title>

Priority: high

<2-3 paragraph description explaining what we're building, why, and key technical context.
Reference the existing codebase — what exists, what needs to change, what's new.>

## Acceptance Criteria

- [ ] AC-001 <Short, specific, testable statement>
- [ ] AC-002 <Short, specific, testable statement>
...
\`\`\`

## Rules for Writing Good Acceptance Criteria

1. Each criterion must be independently testable — a developer should be able to verify it works.
2. Keep each criterion small enough to implement in one coding session (10-30 minutes).
3. Order them logically — infrastructure first, then features, then polish.
4. Be specific: "POST /api/users returns 201 with user object" not "Users can be created".
5. Include both the action and the expected result.
6. 10-30 criteria is typical. Go up to 50 for large features.
7. Don't include criteria for writing tests separately — the implementation criterion should include testing.
8. Use AC-${prdId}-NNN numbering if this is PRD ${prdId} (e.g., AC-001, AC-002...).

## Important

- Be ambitious about scope. Include edge cases, error handling, and polish.
- Reference existing files and patterns from the codebase.
- Write the PRD content directly — do NOT create any files. Just output the markdown.
- Output ONLY the PRD markdown content. No preamble, no explanations, no code fences wrapping the whole thing.
`;
}

function extractPrdContent(output: string, prdId: string, description: string): string {
  // If the output starts with a markdown heading, use it as-is
  const trimmed = output.trim();
  if (trimmed.startsWith("# ")) {
    return trimmed + "\n";
  }

  // Try to find a markdown block in the output
  const mdMatch = trimmed.match(/```(?:markdown)?\s*\n([\s\S]*?)\n```/);
  if (mdMatch) {
    return mdMatch[1].trim() + "\n";
  }

  // Fallback: wrap the output in a basic PRD structure
  return `# ${description}

Priority: high

${trimmed}

## Acceptance Criteria

- [ ] AC-001 Implementation complete and working
`;
}
