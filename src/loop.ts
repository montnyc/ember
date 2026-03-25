import { spawnClaude } from "./runner";
import { buildWorkPrompt } from "./prompts";
import { getHead, commitAll, hasUncommittedChanges, revertLastCommit } from "./git";
import { writeMemory, renderMemory } from "./memory";
import { runChecks } from "./checks";
import { evaluateSlice } from "./evaluator";
import { appendProgress } from "./progress";
import { transitionSlice } from "./slices";
import { writeState } from "./state";
import type { EmberConfig, EmberState, SliceState } from "./types";
import type { RunLogger } from "./log";

export type SliceOutcome = "done" | "no_changes" | "error";

export interface SliceResult {
  status: SliceOutcome;
  checksPassed: boolean | null;
  checkOutput: string | null;
}

const MAX_LEARNINGS = 20;

/**
 * Execute a single slice:
 * 1. Pre-flight check (catch existing failures before new work)
 * 2. Spawn Claude with work prompt
 * 3. Check for changes, commit
 * 4. Run checks, evaluate with separate agent
 * 5. If eval/checks fail: revert commit, return failure for fix slice
 * 6. Update progress file, memory, state
 */
export async function executeSlice(
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string,
  checkFailureContext?: string
): Promise<SliceResult> {
  const prd = state.prds[slice.prdId];
  if (!prd) throw new Error(`PRD ${slice.prdId} not found for slice ${slice.id}`);

  const sessionId = crypto.randomUUID();
  const memory = renderMemory(state);
  const headBefore = await getHead();

  // --- Pre-flight: run checks before work to catch existing failures ---
  let preflightFailures: string | undefined;
  if (config.checks.enabled && config.checks.default.length > 0 && !checkFailureContext) {
    const preflight = await runChecks(config.checks.default, projectRoot);
    if (!preflight.pass) {
      preflightFailures = preflight.results
        .filter((r) => r.exitCode !== 0)
        .map((r) => `${r.command}:\n${r.stdout}\n${r.stderr}`)
        .join("\n---\n")
        .slice(0, 3000);
      console.log(`  Pre-flight checks failed — Claude will fix existing issues first.`);
    }
  }

  // --- Run Claude ---
  if (state.currentRun) state.currentRun.step = "work";
  await writeState(projectRoot, state);

  await logEvent(logger, "work-start", slice.id, {});

  const prompt = buildWorkPrompt(slice, prd, memory, config, {
    checkFailureContext,
    preflightFailures,
  });
  const result = await spawnClaude(prompt, config, projectRoot, sessionId);

  await logEvent(logger, "work-end", slice.id, {
    exitCode: result.exitCode,
    costUsd: result.costUsd,
  });

  if (result.exitCode !== 0) {
    console.error(`  Claude exited with code ${result.exitCode}`);
    await appendProgress(projectRoot, slice.id, `ERROR: Claude exited with code ${result.exitCode}`);
    await writeMemory(projectRoot, state);
    return { status: "error", checksPassed: null, checkOutput: null };
  }

  // --- Check for changes ---
  const hasCommits = (await getHead()) !== headBefore;
  const hasDirtyFiles = await hasUncommittedChanges();

  if (!hasCommits && !hasDirtyFiles) {
    console.log(`  No changes made.`);
    await appendProgress(projectRoot, slice.id, "No changes — Claude reported criteria already satisfied.");
    await writeMemory(projectRoot, state);
    return { status: "no_changes", checksPassed: null, checkOutput: null };
  }

  // --- Commit changes ---
  const commitHash = await commitAll(`[ember:${slice.id}] ${slice.title}`);
  if (commitHash) {
    console.log(`  Committed: ${commitHash.slice(0, 8)}`);
  }

  // --- Extract learning from commit ---
  state.learnings.push(`${slice.id}: ${slice.title}`);
  if (state.learnings.length > MAX_LEARNINGS) {
    state.learnings = state.learnings.slice(-MAX_LEARNINGS);
  }

  // --- Run checks (if enabled) ---
  let checksPassed: boolean | null = null;
  let checkOutput: string | null = null;

  if (config.checks.enabled && config.checks.default.length > 0) {
    console.log(`  Running checks...`);
    const checkResult = await runChecks(config.checks.default, projectRoot);
    checksPassed = checkResult.pass;

    if (!checkResult.pass) {
      checkOutput = checkResult.results
        .filter((r) => r.exitCode !== 0)
        .map((r) => `${r.command}:\n${r.stdout}\n${r.stderr}`)
        .join("\n---\n")
        .slice(0, 5000); // cap at 5KB to fit in next prompt without bloating context
      console.log(`  Checks FAILED — reverting commit for clean fix baseline.`);
      await revertLastCommit();
      await appendProgress(projectRoot, slice.id, `Checks failed after commit. Reverted. Creating fix slice.`);
      return { status: "done", checksPassed: false, checkOutput };
    }
    console.log(`  Checks passed.`);
  }

  // --- Evaluate with separate agent ---
  console.log(`  Evaluating...`);
  const evalResult = await evaluateSlice(slice, prd, config, projectRoot);

  if (!evalResult.passed && evalResult.issues.length > 0) {
    console.log(`  Evaluator found ${evalResult.issues.length} issue(s):`);
    for (const issue of evalResult.issues.slice(0, 3)) {
      console.log(`    - ${issue.slice(0, 100)}`);
    }
    const evalOutput = evalResult.issues.join("\n");
    const combinedOutput = [checkOutput, evalOutput].filter(Boolean).join("\n---\n");
    console.log(`  Reverting commit for clean fix baseline.`);
    await revertLastCommit();
    await appendProgress(projectRoot, slice.id, `Evaluator found issues: ${evalResult.issues[0]?.slice(0, 80)}`);
    return { status: "done", checksPassed: false, checkOutput: combinedOutput };
  }

  if (evalResult.passed) {
    console.log(`  Evaluation passed: ${evalResult.summary}`);
  }

  // --- Mark slice done ---
  transitionSlice(state, slice.id, "done");

  for (const criterionId of slice.criterionIds) {
    const criterion = prd.criteria[criterionId];
    if (criterion && criterion.status !== "done") {
      criterion.status = "done";
      criterion.completedAt = new Date().toISOString();
      criterion.completedBySlice = slice.id;
    }
  }

  const allDone = Object.values(prd.criteria).every((c) => c.status === "done");
  prd.status = allDone ? "completed" : "in_progress";
  if (slice.kind === "tracer") prd.tracerValidated = true;

  // --- Update memory + progress ---
  await writeMemory(projectRoot, state);
  await appendProgress(projectRoot, slice.id, `Done. ${evalResult.summary}`);

  // --- Record history ---
  state.history.push({
    runId: state.currentRun?.runId ?? "unknown",
    sliceId: slice.id,
    verdict: "done",
    summary: slice.title,
    completedAt: new Date().toISOString(),
    costUsd: result.costUsd,
  });

  await writeState(projectRoot, state);
  return { status: "done", checksPassed, checkOutput };
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
