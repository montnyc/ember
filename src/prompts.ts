import type { CommitPolicy, EmberConfig, PrdState, SliceState } from "./types";

export function buildWorkPrompt(
  slice: SliceState,
  prd: PrdState,
  memory: string,
  config: EmberConfig
): string {
  const criteriaText = slice.criterionIds
    .map((criterionId) => {
      const criterion = prd.criteria[criterionId];
      if (!criterion) throw new Error(`Criterion ${criterionId} not found in PRD ${prd.id}`);
      return `- ${criterionId}: ${criterion.text}`;
    })
    .join("\n");

  const tracerInstructions =
    slice.kind === "tracer"
      ? `
## Tracer Bullet Instructions

This is a TRACER slice. Your goal is to validate the critical path across layers.
- Build the minimum end-to-end path that proves the approach works
- Wire real components together (no mocks, no stubs)
- Stay small: one real endpoint, one real storage path, one real UI path
- Do NOT build all features — just prove the path works
`
      : "";

  return `## Task

You are working on slice **${slice.id}** [${slice.kind}] for PRD **${prd.title}** (${prd.id}).

### Slice Goal

${slice.title}

### Acceptance Criteria to Satisfy

${criteriaText}
${tracerInstructions}
## Rules

1. Stay within the scope of this slice. Do not work on other criteria or PRDs.
2. ${commitRuleForPolicy(config.commitPolicy, slice.id)}
3. Write clean, minimal code. No over-engineering.
4. Only create or modify files directly required by the criteria above. Do not create scripts, CI configs, READMEs, or infrastructure files.
5. If you encounter a blocker, stop and explain what is blocked and why.

## PRD: ${prd.title}

File: docs/prd/${prd.filename}

Read the PRD file for full context.

## Current Project Memory

${memory}
`;
}

export function buildReviewPrompt(
  slice: SliceState,
  prd: PrdState,
  diff: string
): string {
  const DIFF_TRUNCATE_CHARS = 50_000;
  const truncatedDiff =
    diff.length > DIFF_TRUNCATE_CHARS
      ? diff.slice(0, DIFF_TRUNCATE_CHARS) + "\n\n... (diff truncated)"
      : diff;

  return `## Code Review

Review the changes made for slice **${slice.id}** [${slice.kind}] on PRD **${prd.title}**.

### Criteria Being Addressed

${slice.criterionIds.map((id) => `- ${id}: ${prd.criteria[id]?.text ?? "(unknown)"}`).join("\n")}

### Changes

\`\`\`diff
${truncatedDiff}
\`\`\`

### Review Checklist

1. **Correctness**: Do the changes correctly implement the criteria?
2. **Overreach**: Do the changes go beyond the scope of this slice?
3. **Slice size**: Did the changes stay tracer-sized (if this is a tracer slice)?
4. **Quality**: Are there obvious bugs, missing error handling, or code smells?
5. **Slop**: Is there unnecessary code, dead imports, or boilerplate?

Provide a clear assessment. State whether the changes should pass or need iteration.
`;
}

export function buildGatePrompt(
  slice: SliceState,
  prd: PrdState,
  reviewOutput: string,
  checksOutput: string,
  checksPass: boolean
): string {
  return `## Gate Decision

You are the gate for slice **${slice.id}** [${slice.kind}] on PRD **${prd.title}**.

### Review Assessment

${reviewOutput}

### Deterministic Check Results

Pass: ${checksPass}

${checksOutput}

### Instructions

Return ONLY a JSON object matching this exact schema. No other text.

${checksPass ? "" : "IMPORTANT: Checks FAILED. You MUST NOT return verdict \"done\" when checks fail.\n"}
\`\`\`json
{
  "verdict": "done" | "iterate" | "blocked",
  "summary": "One sentence summary of what was accomplished or what needs to happen.",
  "criteriaCompleted": ["AC-001"],
  "memoryUpdates": ["Key learning or architectural decision to remember."],
  "nextSlices": [
    {
      "title": "Description of next work",
      "kind": "expand" | "polish",
      "criterionIds": ["AC-002"],
      "priority": "normal"
    }
  ],
  "blockReason": "Only if verdict is blocked"
}
\`\`\`

Rules:
- "done": All criteria for this slice are satisfied AND checks pass.
- "iterate": Work needs revision. The same slice will be retried.
- "blocked": Cannot proceed. Explain why in blockReason.
- criteriaCompleted: Only list criteria that are fully satisfied by the current changes.
- nextSlices: Suggest follow-up work if verdict is "done".
`;
}

function commitRuleForPolicy(policy: CommitPolicy, sliceId: string): string {
  if (policy === "model") {
    return `Create a git commit when done with prefix: [ember:${sliceId}]`;
  }
  return "Do NOT create git commits. Ember handles commits after verification passes.";
}
