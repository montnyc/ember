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
const MAX_SAME_SESSION_RETRIES = 2;

/**
 * Execute a single slice:
 * 1. Pre-flight check (catch existing failures before new work)
 * 2. Spawn Claude with work prompt
 * 3. Check for changes, commit
 * 4. Run checks + evaluator
 * 5. If checks/eval fail: feed failure back to SAME session (deny-and-continue)
 * 6. Only revert after retries exhausted
 * 7. Update progress file, memory, state
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
  const preflightFailures = await runPreflightChecks(config, projectRoot, checkFailureContext);

  // --- Initial Claude run ---
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
    return await handleClaudeError(result.exitCode, projectRoot, state, slice);
  }

  // --- Check for changes ---
  if (await noChangesDetected(headBefore)) {
    await appendProgress(projectRoot, slice.id, "No changes — Claude reported criteria already satisfied.");
    await writeMemory(projectRoot, state);
    return { status: "no_changes", checksPassed: null, checkOutput: null };
  }

  // --- Commit + verify (with same-session retries) ---
  return await commitAndVerify(
    state, slice, config, logger, projectRoot, sessionId, headBefore
  );
}

// --- Deny-and-continue: commit, verify, retry in same session if needed ---

async function commitAndVerify(
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string,
  sessionId: string,
  headBefore: string | null,
): Promise<SliceResult> {
  const prd = state.prds[slice.prdId];
  if (!prd) throw new Error(`PRD ${slice.prdId} not found`);

  for (let attempt = 0; attempt <= MAX_SAME_SESSION_RETRIES; attempt++) {
    // --- Commit ---
    const commitHash = await commitAll(`[ember:${slice.id}] ${slice.title}`);
    if (commitHash) {
      console.log(`  Committed: ${commitHash.slice(0, 8)}`);
    }

    // --- Record learning ---
    state.learnings.push(`${slice.id}: ${slice.title}`);
    if (state.learnings.length > MAX_LEARNINGS) {
      state.learnings = state.learnings.slice(-MAX_LEARNINGS);
    }

    // --- Run checks ---
    const checkFailure = await runPostCommitChecks(config, projectRoot);

    // --- Run evaluator ---
    const evalFailure = !checkFailure
      ? await runEvaluation(slice, prd, config, projectRoot)
      : null;

    const failure = checkFailure ?? evalFailure;

    // --- All clear: mark done ---
    if (!failure) {
      return await markSliceDone(state, slice, prd, projectRoot, logger);
    }

    // --- Failed: can we retry in the same session? ---
    const isLastAttempt = attempt >= MAX_SAME_SESSION_RETRIES;

    if (isLastAttempt) {
      console.log(`  Retries exhausted — reverting commit.`);
      await revertLastCommit();
      await appendProgress(projectRoot, slice.id, `Checks/eval failed after ${attempt + 1} attempts. Reverted.`);
      return { status: "done", checksPassed: false, checkOutput: failure };
    }

    // --- Deny-and-continue: feed failure back to same session ---
    console.log(`  Attempt ${attempt + 1}/${MAX_SAME_SESSION_RETRIES + 1} failed — retrying in same session...`);
    const fixPrompt = buildFixPrompt(failure);
    const fixResult = await spawnClaude(fixPrompt, config, projectRoot, sessionId);

    if (fixResult.exitCode !== 0) {
      console.error(`  Claude fix attempt exited with code ${fixResult.exitCode}`);
      await revertLastCommit();
      return { status: "done", checksPassed: false, checkOutput: failure };
    }

    // Check if Claude actually made changes
    if (await noChangesDetected(await getHead())) {
      console.log(`  Claude made no changes on retry — reverting.`);
      await revertLastCommit();
      return { status: "done", checksPassed: false, checkOutput: failure };
    }

    // Loop back to commit + verify
  }

  // Should not reach here, but just in case
  return { status: "error", checksPassed: null, checkOutput: null };
}

// --- Extracted helpers ---

async function runPreflightChecks(
  config: EmberConfig,
  projectRoot: string,
  checkFailureContext?: string
): Promise<string | undefined> {
  if (!config.checks.enabled || config.checks.default.length === 0 || checkFailureContext) {
    return undefined;
  }

  const preflight = await runChecks(config.checks.default, projectRoot);
  if (!preflight.pass) {
    console.log(`  Pre-flight checks failed — Claude will fix existing issues first.`);
    return preflight.results
      .filter((r) => r.exitCode !== 0)
      .map((r) => `${r.command}:\n${r.stdout}\n${r.stderr}`)
      .join("\n---\n")
      .slice(0, 3000);
  }
  return undefined;
}

async function runPostCommitChecks(
  config: EmberConfig,
  projectRoot: string
): Promise<string | null> {
  if (!config.checks.enabled || config.checks.default.length === 0) return null;

  console.log(`  Running checks...`);
  const checkResult = await runChecks(config.checks.default, projectRoot);
  if (checkResult.pass) {
    console.log(`  Checks passed.`);
    return null;
  }

  const output = checkResult.results
    .filter((r) => r.exitCode !== 0)
    .map((r) => `${r.command}:\n${r.stdout}\n${r.stderr}`)
    .join("\n---\n")
    .slice(0, 5000);
  console.log(`  Checks FAILED.`);
  return output;
}

async function runEvaluation(
  slice: SliceState,
  prd: import("./types").PrdState,
  config: EmberConfig,
  projectRoot: string
): Promise<string | null> {
  console.log(`  Evaluating...`);
  const evalResult = await evaluateSlice(slice, prd, config, projectRoot);

  if (evalResult.passed) {
    console.log(`  Evaluation passed: ${evalResult.summary}`);
    return null;
  }

  if (evalResult.issues.length > 0) {
    console.log(`  Evaluator found ${evalResult.issues.length} issue(s):`);
    for (const issue of evalResult.issues.slice(0, 3)) {
      console.log(`    - ${issue.slice(0, 100)}`);
    }
    return evalResult.issues.join("\n");
  }

  return null;
}

async function noChangesDetected(headBefore: string | null): Promise<boolean> {
  const headAfter = await getHead();
  const hasCommits = headAfter !== null && headAfter !== headBefore;
  const hasDirtyFiles = await hasUncommittedChanges();
  return !hasCommits && !hasDirtyFiles;
}

async function markSliceDone(
  state: EmberState,
  slice: SliceState,
  prd: import("./types").PrdState,
  projectRoot: string,
  logger: RunLogger
): Promise<SliceResult> {
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

  await writeMemory(projectRoot, state);
  await appendProgress(projectRoot, slice.id, `Done.`);

  state.history.push({
    runId: state.currentRun?.runId ?? "unknown",
    sliceId: slice.id,
    verdict: "done",
    summary: slice.title,
    completedAt: new Date().toISOString(),
    costUsd: null,
  });

  await writeState(projectRoot, state);
  return { status: "done", checksPassed: true, checkOutput: null };
}

function buildFixPrompt(failureOutput: string): string {
  const truncated = failureOutput.slice(0, 5000);
  return `Your previous changes failed verification. Fix the issues and commit again.

## Failure Output

\`\`\`
${truncated}
\`\`\`

Rules:
1. Fix ONLY what the errors above describe — do not refactor or change anything else.
2. Create a new git commit with your fix.
3. Do not revert the previous commit — patch on top of it.
`;
}

async function handleClaudeError(
  exitCode: number,
  projectRoot: string,
  state: EmberState,
  slice: SliceState
): Promise<SliceResult> {
  console.error(`  Claude exited with code ${exitCode}`);
  await appendProgress(projectRoot, slice.id, `ERROR: Claude exited with code ${exitCode}`);
  await writeMemory(projectRoot, state);
  return { status: "error", checksPassed: null, checkOutput: null };
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
