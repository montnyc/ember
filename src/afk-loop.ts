import { syncState, writeState } from "./state";
import { loadConfig } from "./config";
import { selectNextSlice } from "./select";
import { executeSlice } from "./loop";
import { createRunLog } from "./log";
import { transitionSlice, createFixSlice } from "./slices";
import { resetWorkingTree, hasUncommittedChanges, getFullDiff } from "./git";
import type { EmberConfig, EmberState, SliceState } from "./types";
import type { SliceResult } from "./loop";

/** After this many consecutive no-change results, auto-advance the slice. */
const NO_CHANGES_THRESHOLD = 3;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const MAX_FIX_ATTEMPTS = 3;

/**
 * Reporter interface: the AFK loop calls these to report progress.
 * CLI implements them with console.log. TUI implements them with state updates.
 */
export interface AfkReporter {
  onStart(sliceCount: number): void;
  onSliceStart(index: number, total: number, slice: SliceState): void;
  onSliceDone(slice: SliceState, checksFailed: boolean, completed: number, totalCost: number): void;
  onSliceNoChanges(slice: SliceState, attempt: number, threshold: number): void;
  onSliceAutoAdvanced(slice: SliceState, completed: number): void;
  onSliceError(slice: SliceState, failed: number): void;
  onFixSliceCreated(fixSliceId: string): void;
  onCircuitBreaker(consecutiveErrors: number): void;
  onAllDone(): void;
  onDiffUpdate(diff: string): void;
  onFinished(completed: number, failed: number, totalCost: number, elapsedMs: number): void;
}

export interface AfkOptions {
  projectRoot: string;
  maxSlices: number;
  reporter: AfkReporter;
  shouldStop?: () => boolean; // for interrupt handling
}

/**
 * The shared AFK loop. Used by both CLI (terminal mode) and TUI.
 * All display/output goes through the reporter interface.
 */
export async function runAfkLoop(opts: AfkOptions): Promise<void> {
  const { projectRoot, maxSlices, reporter, shouldStop } = opts;
  const config = await loadConfig(projectRoot);
  const startTimeMs = Date.now();

  let completed = 0;
  let failed = 0;
  let totalCost = 0;
  let consecutiveErrors = 0;
  let pendingCheckFailure: string | null = null;

  // Count total slices for progress reporting
  const initialState = await syncState(projectRoot);
  const totalSlices = Object.values(initialState.slices).filter((s) => s.status === "pending").length;
  reporter.onStart(totalSlices);

  for (let i = 0; i < maxSlices; i++) {
    if (shouldStop?.()) break;

    if (consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD) {
      reporter.onCircuitBreaker(consecutiveErrors);
      break;
    }

    const state = await syncState(projectRoot);
    const slice = selectNextSlice(state);

    if (!slice) {
      reporter.onAllDone();
      break;
    }

    reporter.onSliceStart(completed + 1, maxSlices, slice);

    const result = await runOneSlice(projectRoot, state, slice, config, pendingCheckFailure);
    pendingCheckFailure = null;

    // Update diff for TUI
    const diff = await getFullDiff();
    if (diff.trim()) reporter.onDiffUpdate(diff);

    if (result.status === "done") {
      consecutiveErrors = 0;
      completed++;
      totalCost += state.history[state.history.length - 1]?.costUsd ?? 0;

      const checksFailed = result.checksPassed === false;
      reporter.onSliceDone(slice, checksFailed, completed, totalCost);

      if (checksFailed && result.checkOutput) {
        pendingCheckFailure = await maybeCreateFixSlice(state, slice, result.checkOutput, projectRoot);
        if (pendingCheckFailure) {
          const fixId = Object.keys(state.slices).filter((id) => id.includes(":fix-")).pop();
          if (fixId) reporter.onFixSliceCreated(fixId);
        }
      }
    } else if (result.status === "no_changes") {
      consecutiveErrors = 0;

      if (slice.reviewIterations >= NO_CHANGES_THRESHOLD) {
        completed++;
        reporter.onSliceAutoAdvanced(slice, completed);
      } else {
        reporter.onSliceNoChanges(slice, slice.reviewIterations, NO_CHANGES_THRESHOLD);
      }
    } else {
      consecutiveErrors++;
      failed++;
      await resetWorkingTree();
      reporter.onSliceError(slice, failed);
    }
  }

  reporter.onFinished(completed, failed, totalCost, Date.now() - startTimeMs);
}

/**
 * Execute one slice with full lifecycle: transition, execute, handle outcome.
 */
async function runOneSlice(
  projectRoot: string,
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  checkFailureContext: string | null
): Promise<SliceResult> {
  const runId = `${Date.now()}`;
  const logger = createRunLog(projectRoot, runId);

  transitionSlice(state, slice.id, "running");
  state.currentRun = {
    runId,
    mode: "afk",
    sliceId: slice.id,
    step: "work",
    reviewIteration: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await writeState(projectRoot, state);

  const result = await executeSlice(state, slice, config, logger, projectRoot, checkFailureContext ?? undefined);

  // Handle no_changes: increment counter, auto-advance if threshold reached
  if (result.status === "no_changes") {
    slice.reviewIterations++;

    if (slice.reviewIterations >= NO_CHANGES_THRESHOLD) {
      transitionSlice(state, slice.id, "done");
      const prd = state.prds[slice.prdId];
      if (prd) {
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
      }
    }
  }

  // Error recovery: mark stranded slices as failed
  if (result.status === "error" && slice.status === "running") {
    transitionSlice(state, slice.id, "failed");
  }

  state.currentRun = null;
  await writeState(projectRoot, state);
  await logger.close();

  return result;
}

async function maybeCreateFixSlice(
  state: EmberState,
  slice: SliceState,
  checkOutput: string,
  projectRoot: string
): Promise<string | null> {
  const fixCount = Object.keys(state.slices).filter((id) => id.includes(":fix-")).length;
  if (fixCount >= MAX_FIX_ATTEMPTS) return null;

  const fixSlice = createFixSlice(slice, checkOutput, state.slices);
  state.slices[fixSlice.id] = fixSlice;
  await writeState(projectRoot, state);
  return checkOutput;
}
