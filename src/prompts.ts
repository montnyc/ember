import { existsSync } from "node:fs";
import path from "node:path";
import type { EmberConfig, PrdState, SliceState } from "./types";

/**
 * Build the work prompt. References:
 * - PRD file, EMBER.md, CLAUDE.md (if exists), progress file (if exists)
 * - Criteria status (done / current / pending)
 * - Pre-flight check failures (if any)
 * - Previous check/eval failures (for fix slices)
 */
export function buildWorkPrompt(
  slice: SliceState,
  prd: PrdState,
  memory: string,
  config: EmberConfig,
  opts?: {
    checkFailureContext?: string;
    preflightFailures?: string;
  }
): string {
  const criteriaStatus = Object.entries(prd.criteria)
    .map(([id, criterion]) => {
      if (criterion.status === "done") return `- [done] ${id}: ${criterion.text}`;
      if (slice.criterionIds.includes(id)) return `- [YOU]  ${id}: ${criterion.text}  <-- YOUR TASK`;
      return `- [ ]   ${id}: ${criterion.text}`;
    })
    .join("\n");

  const doneCount = Object.values(prd.criteria).filter((c) => c.status === "done").length;
  const totalCount = Object.keys(prd.criteria).length;

  // Auto-detect project files for context
  const projectRoot = config.runner.type === "claude" ? process.cwd() : ".";
  const claudeMdRef = existsSync(path.join(projectRoot, "CLAUDE.md")) ? " @CLAUDE.md" : "";
  const progressRef = existsSync(path.join(projectRoot, ".ember", "progress.txt")) ? " @.ember/progress.txt" : "";

  // Pre-flight: existing test failures that need fixing before new work
  const preflightSection = opts?.preflightFailures
    ? `\n## ⚠ Existing Failures (fix first)\n\nThe project currently has failing checks. Fix these BEFORE implementing your criteria:\n\n\`\`\`\n${opts.preflightFailures.slice(0, 3000)}\n\`\`\`\n`
    : "";

  // Previous slice's check/eval failures (for fix slices)
  const checkContext = opts?.checkFailureContext
    ? `\n## Previous Check/Eval Failures\n\nThe previous slice's changes broke these checks or the evaluator found issues. Fix them:\n\n\`\`\`\n${opts.checkFailureContext.slice(0, 3000)}\n\`\`\`\n`
    : "";

  return `@docs/prd/${prd.filename} @EMBER.md${claudeMdRef}${progressRef}

You are working on PRD ${prd.id}: ${prd.title}
Progress: ${doneCount}/${totalCount} acceptance criteria complete.

## Criteria Status:
${criteriaStatus}

YOUR TASK: Implement and verify these acceptance criteria:
${slice.criterionIds.map((id) => `  "${prd.criteria[id]?.text ?? id}"`).join("\n")}
${preflightSection}${checkContext}
Rules:
1. Read the PRD, EMBER.md, and progress file before starting.
2. Implement only what is needed for the criteria above — nothing more.
3. Verify your work: run typecheck, lint, and tests as appropriate.
4. Create a git commit with prefix "[ember:${slice.id}]" describing what you did.
5. Do NOT edit the PRD file itself.
6. Do NOT work on other criteria — only the ones specified above.
7. Before committing, remove any debug logs, commented-out code, or temporary files.

## Current Project Memory

${memory}
`;
}
