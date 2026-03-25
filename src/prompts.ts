import { existsSync } from "node:fs";
import path from "node:path";
import type { EmberConfig, PrdState, SliceState } from "./types";

/**
 * Build the work prompt. Modeled after the proven afk runner prompt:
 * - Reference the PRD file directly with @
 * - Show criteria status (done / current / pending)
 * - Tell Claude to commit when done
 * - One clear task
 */
export function buildWorkPrompt(
  slice: SliceState,
  prd: PrdState,
  memory: string,
  config: EmberConfig,
  checkFailureContext?: string
): string {
  // Build criteria status list showing what's done and what's current
  const criteriaStatus = Object.entries(prd.criteria)
    .map(([id, criterion]) => {
      if (criterion.status === "done") return `- [done] ${id}: ${criterion.text}`;
      if (slice.criterionIds.includes(id)) return `- [YOU]  ${id}: ${criterion.text}  <-- YOUR TASK`;
      return `- [ ]   ${id}: ${criterion.text}`;
    })
    .join("\n");

  const doneCount = Object.values(prd.criteria).filter((c) => c.status === "done").length;
  const totalCount = Object.keys(prd.criteria).length;

  // Auto-detect project CLAUDE.md for conventions/context
  const projectRoot = config.runner.type === "claude" ? process.cwd() : ".";
  const claudeMdRef = existsSync(path.join(projectRoot, "CLAUDE.md")) ? " @CLAUDE.md" : "";

  const checkContext = checkFailureContext
    ? `\n## Previous Check Failures\n\nThe previous slice's changes broke these checks. Fix them as part of your work:\n\n\`\`\`\n${checkFailureContext.slice(0, 3000)}\n\`\`\`\n`
    : "";

  return `@docs/prd/${prd.filename} @EMBER.md${claudeMdRef}

You are working on PRD ${prd.id}: ${prd.title}
Progress: ${doneCount}/${totalCount} acceptance criteria complete.

## Criteria Status:
${criteriaStatus}

YOUR TASK: Implement and verify these acceptance criteria:
${slice.criterionIds.map((id) => `  "${prd.criteria[id]?.text ?? id}"`).join("\n")}

Rules:
1. Read the PRD and EMBER.md before starting.
2. Implement only what is needed for the criteria above — nothing more.
3. Verify your work: run typecheck, lint, and tests as appropriate.
4. Create a git commit with prefix "[ember:${slice.id}]" describing what you did.
5. Do NOT edit the PRD file itself.
6. Do NOT work on other criteria — only the ones specified above.

${checkContext}## Current Project Memory

${memory}
`;
}
