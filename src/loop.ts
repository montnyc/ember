import { spawnClaude } from "./runner";
import { buildWorkPrompt, buildReviewPrompt, buildGatePrompt } from "./prompts";
import { runChecks } from "./checks";
import { parseGateVerdict } from "./gate";
import { getFullDiff, commitAll } from "./git";
import { writeMemory, renderMemory } from "./memory";
import { transitionSlice, createSliceFromProposal } from "./slices";
import { writeState } from "./state";
import type { EmberConfig, EmberState, GateVerdict, PrdState, SliceState } from "./types";
import type { RunLogger } from "./log";
import type { RunnerResult } from "./types";

export type SliceOutcome = "done" | "iterate" | "blocked" | "error";

const MAX_LEARNINGS = 20;

export async function executeSlice(
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<SliceOutcome> {
  const prd = state.prds[slice.prdId];
  if (!prd) throw new Error(`PRD ${slice.prdId} not found for slice ${slice.id}`);

  const memory = renderMemory(state);

  const workResult = await runWorkPhase(state, slice, prd, memory, config, logger, projectRoot);
  if (workResult.exitCode !== 0) return "error";

  const reviewResult = await runReviewPhase(state, slice, prd, config, logger, projectRoot);
  if (reviewResult === null) {
    // No changes detected — count this as a failed iteration so the retry
    // cap still applies and we don't loop forever.
    slice.reviewIterations++;
    await writeState(projectRoot, state);
    return "iterate";
  }

  const { checksPass, checksOutput } = await runChecksPhase(state, slice, config, logger, projectRoot);

  const verdict = await runGatePhase(state, slice, prd, reviewResult.reviewOutput, checksPass, checksOutput, config, logger, projectRoot);
  if (!verdict) return "error";

  // Safety invariant: gate must not mark "done" when checks failed.
  // The model sometimes ignores the prompt instruction, so we enforce it here.
  if (verdict.verdict === "done" && !checksPass) {
    console.log(`[gate] Overriding "done" → "iterate" because checks failed`);
    verdict.verdict = "iterate";
  }

  return applyVerdict(state, slice, prd, verdict, projectRoot, workResult, logger);
}

// --- Phase runners ---
// Each phase: update step tracking, log start/end, call Claude or checks.

async function runWorkPhase(
  state: EmberState,
  slice: SliceState,
  prd: PrdState,
  memory: string,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<RunnerResult> {
  updateStep(state, "work");
  await writeState(projectRoot, state);

  console.log(`\n[work] Starting work on ${slice.id}...`);
  await logEvent(logger, "work-start", slice.id, {});

  const prompt = buildWorkPrompt(slice, prd, memory, config);
  const result = await spawnClaude(prompt, config, projectRoot);

  await logEvent(logger, "work-end", slice.id, {
    exitCode: result.exitCode,
    costUsd: result.costUsd,
  });

  if (result.exitCode !== 0) {
    console.error(`[work] Claude exited with code ${result.exitCode}`);
  }

  return result;
}

interface ReviewResult {
  diff: string;
  reviewOutput: string;
}

async function runReviewPhase(
  state: EmberState,
  slice: SliceState,
  prd: PrdState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<ReviewResult | null> {
  updateStep(state, "review");
  await writeState(projectRoot, state);

  console.log(`[review] Reviewing changes...`);

  // getFullDiff stages untracked files with intent-to-add then diffs against
  // HEAD, so it catches everything: new files, edits, and model commits.
  const diff = await getFullDiff();

  if (!diff.trim()) {
    console.log(`[review] No changes detected. Treating as iterate.`);
    return null;
  }

  await logEvent(logger, "review-start", slice.id, {});

  const prompt = buildReviewPrompt(slice, prd, diff);
  const result = await spawnClaude(prompt, config, projectRoot);

  await logEvent(logger, "review-end", slice.id, {});

  return { diff, reviewOutput: result.output };
}

async function runChecksPhase(
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<{ checksPass: boolean; checksOutput: string }> {
  updateStep(state, "checks");
  await writeState(projectRoot, state);

  console.log(`[checks] Running deterministic checks...`);
  await logEvent(logger, "checks-start", slice.id, {});

  const checkResult = await runChecks(config.checks.default, projectRoot);

  const checksOutput = checkResult.results
    .map((result) =>
      `${result.command}: ${result.exitCode === 0 ? "PASS" : "FAIL"}\n${result.stdout}\n${result.stderr}`
    )
    .join("\n---\n");

  console.log(`[checks] ${checkResult.pass ? "PASS" : "FAIL"}`);
  await logEvent(logger, "checks-end", slice.id, { pass: checkResult.pass });

  return { checksPass: checkResult.pass, checksOutput };
}

async function runGatePhase(
  state: EmberState,
  slice: SliceState,
  prd: PrdState,
  reviewOutput: string,
  checksPass: boolean,
  checksOutput: string,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<GateVerdict | null> {
  updateStep(state, "gate");
  await writeState(projectRoot, state);

  console.log(`[gate] Evaluating gate...`);
  await logEvent(logger, "gate-start", slice.id, {});

  const prompt = buildGatePrompt(slice, prd, reviewOutput, checksOutput, checksPass);
  const gateResult = await spawnClaude(prompt, config, projectRoot);

  let verdict: GateVerdict;
  try {
    verdict = parseGateVerdict(gateResult.output);
  } catch (error) {
    console.error(`[gate] Failed to parse verdict: ${(error as Error).message}`);
    await logEvent(logger, "gate-end", slice.id, { error: (error as Error).message });
    return null;
  }

  console.log(`[gate] Verdict: ${verdict.verdict} — ${verdict.summary}`);
  await logEvent(logger, "gate-end", slice.id, {
    verdict: verdict.verdict,
    summary: verdict.summary,
  });

  return verdict;
}

// --- Verdict application ---

async function applyVerdict(
  state: EmberState,
  slice: SliceState,
  prd: PrdState,
  verdict: GateVerdict,
  projectRoot: string,
  workResult: RunnerResult,
  _logger: RunLogger
): Promise<SliceOutcome> {
  if (verdict.verdict === "done") {
    return applyDoneVerdict(state, slice, prd, verdict, projectRoot, workResult);
  }

  if (verdict.verdict === "iterate") {
    slice.reviewIterations++;
    await writeState(projectRoot, state);
    return "iterate";
  }

  if (verdict.verdict === "blocked") {
    return applyBlockedVerdict(state, slice, verdict, projectRoot);
  }

  throw new Error(`Unknown verdict: ${verdict.verdict}`);
}

async function applyDoneVerdict(
  state: EmberState,
  slice: SliceState,
  prd: PrdState,
  verdict: GateVerdict,
  projectRoot: string,
  workResult: RunnerResult
): Promise<"done"> {
  transitionSlice(state, slice.id, "done");

  markCriteriaCompleted(prd, verdict.criteriaCompleted, slice.id);
  updatePrdStatus(prd, slice.kind);
  addProposedSlices(state, slice.prdId, verdict.nextSlices);
  captureLearnings(state, verdict.memoryUpdates);

  await writeMemory(projectRoot, state);

  // Commit any uncommitted changes (code + EMBER.md). If the model already
  // committed during work, this is a no-op since there's nothing left to stage.
  await commitAll(`[ember:${slice.id}] ${verdict.summary}`);

  state.history.push({
    runId: state.currentRun?.runId ?? "unknown",
    sliceId: slice.id,
    verdict: "done",
    summary: verdict.summary,
    completedAt: new Date().toISOString(),
    costUsd: workResult.costUsd,
  });

  await writeState(projectRoot, state);
  return "done";
}

function markCriteriaCompleted(
  prd: PrdState,
  criteriaIds: string[],
  sliceId: string
): void {
  const now = new Date().toISOString();
  for (const criterionId of criteriaIds) {
    const criterion = prd.criteria[criterionId];
    if (criterion && criterion.status !== "done") {
      criterion.status = "done";
      criterion.completedAt = now;
      criterion.completedBySlice = sliceId;
    }
  }
}

function updatePrdStatus(prd: PrdState, sliceKind: string): void {
  const allCriteriaDone = Object.values(prd.criteria).every(
    (criterion) => criterion.status === "done"
  );
  prd.status = allCriteriaDone ? "completed" : "in_progress";

  if (sliceKind === "tracer") {
    prd.tracerValidated = true;
  }
}

function addProposedSlices(
  state: EmberState,
  prdId: string,
  proposals: GateVerdict["nextSlices"]
): void {
  const prd = state.prds[prdId];

  for (const proposal of proposals) {
    // Filter out criterion IDs that don't exist in the PRD. A malformed gate
    // response could reference nonexistent criteria, which would crash the
    // next work prompt when it tries to look them up.
    const validCriterionIds = prd
      ? proposal.criterionIds.filter((id) => id in prd.criteria)
      : [];

    if (validCriterionIds.length !== proposal.criterionIds.length) {
      const invalid = proposal.criterionIds.filter((id) => !prd || !(id in prd.criteria));
      console.warn(`[gate] Filtered invalid criterion IDs from nextSlice "${proposal.title}": ${invalid.join(", ")}`);
    }

    const sanitized = { ...proposal, criterionIds: validCriterionIds };
    const newSlice = createSliceFromProposal(prdId, sanitized, state.slices);
    state.slices[newSlice.id] = newSlice;
  }
}

function captureLearnings(state: EmberState, updates: string[]): void {
  state.learnings.push(...updates);
  if (state.learnings.length > MAX_LEARNINGS) {
    state.learnings = state.learnings.slice(-MAX_LEARNINGS);
  }
}

async function applyBlockedVerdict(
  state: EmberState,
  slice: SliceState,
  verdict: GateVerdict,
  projectRoot: string
): Promise<"blocked"> {
  transitionSlice(state, slice.id, "blocked", {
    blockReason: verdict.blockReason ?? verdict.summary,
  });

  state.history.push({
    runId: state.currentRun?.runId ?? "unknown",
    sliceId: slice.id,
    verdict: "blocked",
    summary: verdict.summary,
    completedAt: new Date().toISOString(),
    costUsd: null,
  });

  await writeState(projectRoot, state);
  return "blocked";
}

// --- Helpers ---

function updateStep(state: EmberState, step: EmberState["currentRun"] extends null ? never : string): void {
  if (state.currentRun) {
    state.currentRun.step = step as "work" | "review" | "checks" | "gate";
  }
}

async function logEvent(
  logger: RunLogger,
  type: string,
  sliceId: string,
  data: unknown
): Promise<void> {
  await logger.append({
    timestamp: new Date().toISOString(),
    type,
    sliceId,
    data,
  });
}
