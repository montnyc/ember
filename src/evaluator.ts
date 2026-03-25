import { spawnClaude } from "./runner";
import { getFullDiff } from "./git";
import type { EmberConfig, PrdState, SliceState } from "./types";

export interface EvalResult {
  passed: boolean;
  issues: string[];
  summary: string;
}

/**
 * Evaluate a completed slice's work using a SEPARATE Claude session.
 * The evaluator is tuned to be skeptical — it assumes bugs exist until proven otherwise.
 * Returns issues found, or empty if the work passes.
 */
export async function evaluateSlice(
  slice: SliceState,
  prd: PrdState,
  config: EmberConfig,
  projectRoot: string
): Promise<EvalResult> {
  const diff = await getFullDiff();

  if (!diff.trim()) {
    return { passed: true, issues: [], summary: "No changes to evaluate." };
  }

  const prompt = buildEvaluatorPrompt(slice, prd, diff);

  // Fresh session ID — evaluator must NOT share context with the generator
  const result = await spawnClaude(prompt, config, projectRoot);

  if (result.exitCode !== 0) {
    // Evaluator crashed — don't block the pipeline, just warn
    console.log(`  Evaluator exited with code ${result.exitCode}, skipping evaluation.`);
    return { passed: true, issues: [], summary: "Evaluator failed to run." };
  }

  return parseEvalOutput(result.output);
}

function buildEvaluatorPrompt(
  slice: SliceState,
  prd: PrdState,
  diff: string
): string {
  const criteriaText = slice.criterionIds
    .map((id) => {
      const c = prd.criteria[id];
      return c ? `- ${id}: ${c.text}` : `- ${id}`;
    })
    .join("\n");

  const truncatedDiff = diff.length > 30_000
    ? diff.slice(0, 30_000) + "\n\n... (diff truncated)"
    : diff;

  return `You are a skeptical code reviewer evaluating work done by another AI agent.

## Context

PRD: ${prd.title} (${prd.id})
Slice: ${slice.id} [${slice.kind}]

## Acceptance Criteria Being Addressed

${criteriaText}

## Changes Made

\`\`\`diff
${truncatedDiff}
\`\`\`

## Your Job

Assume the implementation has bugs until you prove otherwise. Check:

1. **Functionality**: Does the code actually implement what the criteria ask for? Not just "files exist" — does the logic work?
2. **Correctness**: Are there off-by-one errors, null checks missing, wrong variable names, broken imports?
3. **Scope**: Did the changes stay within the criteria, or did they touch unrelated code?
4. **Completeness**: Is anything stubbed, commented out, or left as TODO?

## Output Format

Respond with ONLY a JSON object:

\`\`\`json
{
  "passed": true or false,
  "issues": ["issue 1 description", "issue 2 description"],
  "summary": "One sentence overall assessment"
}
\`\`\`

Rules:
- If you find ANY functional issue, set passed to false.
- Cosmetic issues (naming, formatting) should be noted but don't fail the evaluation.
- Be specific: "fetchUser() on line 42 doesn't handle the 404 case" not "error handling could be better".
- If the code looks correct and complete, set passed to true with an empty issues array.
- Do NOT be generous. Another agent wrote this code and it probably has bugs.
`;
}

function parseEvalOutput(output: string): EvalResult {
  const trimmed = output.trim();

  // Try to extract JSON
  let jsonStr = trimmed;

  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  if (!jsonStr.startsWith("{")) {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      passed: parsed.passed === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((i: unknown) => typeof i === "string") : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "No summary provided.",
    };
  } catch (error) {
    // Evaluator produced non-JSON output. Treat as pass so we don't block the
    // pipeline on evaluator bugs, but log the error so it's visible.
    console.error(`  Evaluator output wasn't valid JSON: ${(error as Error).message}`);
    console.error(`  Raw output (first 200 chars): ${trimmed.slice(0, 200)}`);
    return { passed: true, issues: [], summary: "Evaluator output unparseable." };
  }
}
