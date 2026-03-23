import { spawnClaude } from "./runner";
import { buildWorkPrompt } from "./prompts";
import { getHead, commitAll, hasUncommittedChanges } from "./git";
import { writeMemory, renderMemory } from "./memory";
import { transitionSlice } from "./slices";
import { writeState } from "./state";
import type { EmberConfig, EmberState, SliceState } from "./types";
import type { RunLogger } from "./log";

export type SliceOutcome = "done" | "no_changes" | "error";

/**
 * Execute a single slice: spawn Claude, check if it made changes, commit if so.
 *
 * This follows the proven pattern from the afk runner:
 * 1. Spawn Claude with a session ID (so it uses tools)
 * 2. Check if any changes were made
 * 3. If changes: commit and mark done
 * 4. If no changes: return "no_changes" (caller handles auto-advance)
 * 5. If error: return "error"
 */
export async function executeSlice(
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  logger: RunLogger,
  projectRoot: string
): Promise<SliceOutcome> {
  const prd = state.prds[slice.prdId];
  if (!prd) throw new Error(`PRD ${slice.prdId} not found for slice ${slice.id}`);

  const sessionId = crypto.randomUUID();
  const memory = renderMemory(state);
  const headBefore = await getHead();

  // --- Run Claude ---
  if (state.currentRun) state.currentRun.step = "work";
  await writeState(projectRoot, state);

  await logEvent(logger, "work-start", slice.id, {});

  const prompt = buildWorkPrompt(slice, prd, memory, config);
  const result = await spawnClaude(prompt, config, projectRoot, sessionId);

  await logEvent(logger, "work-end", slice.id, {
    exitCode: result.exitCode,
    costUsd: result.costUsd,
  });

  if (result.exitCode !== 0) {
    console.error(`  Claude exited with code ${result.exitCode}`);
    return "error";
  }

  // --- Check for changes ---
  const hasCommits = (await getHead()) !== headBefore;
  const hasDirtyFiles = await hasUncommittedChanges();

  if (!hasCommits && !hasDirtyFiles) {
    console.log(`  No changes made.`);
    return "no_changes";
  }

  // --- Commit changes ---
  // If Claude committed already, this is a no-op. If it left uncommitted
  // changes, we commit them under Ember's prefix.
  const commitHash = await commitAll(`[ember:${slice.id}] ${slice.title}`);
  if (commitHash) {
    console.log(`  Committed: ${commitHash.slice(0, 8)}`);
  }

  // --- Mark slice done ---
  transitionSlice(state, slice.id, "done");

  // Mark all targeted criteria as done
  for (const criterionId of slice.criterionIds) {
    const criterion = prd.criteria[criterionId];
    if (criterion && criterion.status !== "done") {
      criterion.status = "done";
      criterion.completedAt = new Date().toISOString();
      criterion.completedBySlice = slice.id;
    }
  }

  // Update PRD status
  const allDone = Object.values(prd.criteria).every((c) => c.status === "done");
  prd.status = allDone ? "completed" : "in_progress";
  if (slice.kind === "tracer") prd.tracerValidated = true;

  // Update memory
  await writeMemory(projectRoot, state);

  // Record history
  state.history.push({
    runId: state.currentRun?.runId ?? "unknown",
    sliceId: slice.id,
    verdict: "done",
    summary: slice.title,
    completedAt: new Date().toISOString(),
    costUsd: result.costUsd,
  });

  await writeState(projectRoot, state);
  return "done";
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
