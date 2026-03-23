#!/usr/bin/env bun

import path from "node:path";
import { syncState, writeState } from "./state";
import { loadConfig, writeDefaultConfig } from "./config";
import { selectNextSlice } from "./select";
import { transitionSlice } from "./slices";
import { executeSlice } from "./loop";
import { createRunLog } from "./log";
import { resetWorkingTree, hasUncommittedChanges, setGitRoot } from "./git";
import type { EmberConfig, EmberState, SliceState } from "./types";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "run":
      await cmdRun(args.slice(1));
      break;
    case "afk":
      await cmdAfk(args.slice(1));
      break;
    case "resume":
      await cmdResume(args.slice(1));
      break;
    case "status":
      await cmdStatus();
      break;
    case "reset":
      await cmdReset(args.slice(1));
      break;
    case "install-skill":
      await import("./install-skill");
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log(`Usage: ember <command>

Commands:
  init                          Initialize and sync PRDs (re-run to unstick)
  run [--slice <id>]            Run one slice
  afk [--max-slices N]          Run slices until completion or cap
  resume [--discard]            Resume an interrupted run
  reset [--slice <id>] [--all]  Reset failed/blocked slices back to pending
  status                        Show current state
  install-skill                 Install /ember-prd skill for Claude Code

Options:
  --clean                       Discard uncommitted changes before running
  --allow-commits               Let the model create commits (default: Ember commits)
  --discard                     Discard uncommitted changes when resuming`);
}

// --- init ---

async function cmdInit() {
  const projectRoot = await findProjectRoot();
  const emberDir = path.join(projectRoot, ".ember");
  const runsDir = path.join(emberDir, "runs");

  await Bun.$`mkdir -p ${runsDir}`.quiet();
  await writeDefaultConfig(projectRoot);

  // Keep .ember/ untracked so Ember's own state/log/config artifacts don't
  // trigger the clean-tree guard or get swept into slice commits.
  const gitignorePath = path.join(emberDir, ".gitignore");
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, "# Ember artifacts — do not track\n*\n");
  }
  const state = await syncState(projectRoot);

  // Clear any stuck state from previous runs
  const unstuck = unstickState(state);
  if (unstuck > 0 || state.currentRun) {
    state.currentRun = null;
    await writeState(projectRoot, state);
    console.log(`  Unstuck:  ${unstuck} slice(s) reset to pending`);
  }

  const prdCount = Object.keys(state.prds).length;
  const criteriaCount = Object.values(state.prds).reduce(
    (sum, prd) => sum + Object.keys(prd.criteria).length,
    0
  );
  const sliceCount = Object.keys(state.slices).length;
  const pendingSlices = Object.values(state.slices).filter(
    (s) => s.status === "pending"
  ).length;

  console.log(`Ember initialized in ${projectRoot}`);
  console.log(`  PRDs:     ${prdCount}`);
  console.log(`  Criteria: ${criteriaCount}`);
  console.log(`  Slices:   ${sliceCount} (${pendingSlices} pending)`);
}

// --- run ---

async function cmdRun(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  await ensureCleanTree(args);
  const state = await syncState(projectRoot);
  const config = await loadConfig(projectRoot);
  const allowCommits = hasFlag(args, "--allow-commits");

  const sliceId = parseArg(args, "--slice");
  const slice = sliceId ? state.slices[sliceId] : selectNextSlice(state);

  if (!slice) {
    console.log(sliceId ? `Slice ${sliceId} not found.` : "No actionable slices.");
    return;
  }

  // If targeting a specific slice that's stuck, auto-reset it
  if (sliceId && slice.status !== "pending" && slice.status !== "done") {
    console.log(`Resetting ${slice.id} from ${slice.status} to pending.`);
    slice.status = "pending";
    slice.reviewIterations = 0;
    slice.blockReason = null;
    state.currentRun = null;
    await writeState(projectRoot, state);
  }

  if (slice.status !== "pending") {
    console.log(`Slice ${slice.id} is ${slice.status}.`);
    return;
  }

  await runSliceWithRetries(projectRoot, state, slice, config, "run", undefined, allowCommits);
}

// --- afk ---

async function cmdAfk(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  await ensureCleanTree(args);
  const config = await loadConfig(projectRoot);
  const allowCommits = hasFlag(args, "--allow-commits");

  const maxSlicesArg = parseArg(args, "--max-slices");
  const maxSlices = maxSlicesArg ? parseInt(maxSlicesArg, 10) : config.loop.maxAfkSlices;

  const interrupt = setupInterruptHandler();
  const startTimeMs = Date.now();
  let slicesCompleted = 0;
  let slicesBlocked = 0;
  let totalCostUsd = 0;

  console.log(`\nEmber AFK mode — max ${maxSlices} slices`);

  try {
    while (slicesCompleted < maxSlices && !interrupt.stopping) {
      const state = await syncState(projectRoot);
      const slice = selectNextSlice(state);

      if (!slice) {
        console.log("\nNo more actionable slices.");
        break;
      }

      console.log(
        `\n--- Slice ${slicesCompleted + 1}/${maxSlices}: ${slice.id} [${slice.kind}] ---`
      );
      console.log(`  ${slice.title}`);

      const outcome = await runSliceWithRetries(
        projectRoot, state, slice, config, "afk", interrupt, allowCommits
      );

      if (interrupt.forceKill) break;

      if (outcome === "done") {
        slicesCompleted++;
        const lastHistory = state.history[state.history.length - 1];
        if (lastHistory?.costUsd) totalCostUsd += lastHistory.costUsd;
      } else {
        // Non-done outcomes (blocked, error, failed iteration) may leave partial
        // edits in the working tree. Reset before the next slice so those edits
        // don't leak into a subsequent successful commit.
        await resetWorkingTree();
        if (outcome === "blocked") slicesBlocked++;
      }
    }
  } finally {
    interrupt.cleanup();
  }

  const elapsedMinutes = ((Date.now() - startTimeMs) / 1000 / 60).toFixed(1);
  console.log(`\n=== AFK Summary ===`);
  console.log(`  Completed: ${slicesCompleted}`);
  console.log(`  Blocked:   ${slicesBlocked}`);
  console.log(`  Time:      ${elapsedMinutes} min`);
  console.log(`  Cost:      $${totalCostUsd.toFixed(2)}`);
}

// --- status ---

async function cmdStatus() {
  const projectRoot = await findProjectRoot();
  await ensureEmberDirs(projectRoot);
  const state = await syncState(projectRoot);

  console.log("\nEmber Status");
  console.log("=".repeat(60));

  const prds = Object.values(state.prds);
  if (prds.length === 0) {
    console.log("No PRDs found. Run 'ember init' first.");
    return;
  }

  // Pre-compute slice counts indexed by PRD so the table render below is
  // O(prds + slices) instead of O(prds × slices).
  const slicesByPrd = groupSlicesByPrd(state);

  printPrdTable(prds, slicesByPrd);
  printOpenSlices(state);
  printRecentHistory(state);
  printActiveRun(state);
  printNextSlice(state);
}

// --- resume ---

async function cmdResume(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  const state = await syncState(projectRoot);
  const config = await loadConfig(projectRoot);

  // Find interrupted work: check currentRun first, then orphaned "running" slices
  const sliceId = state.currentRun?.sliceId
    ?? Object.values(state.slices).find((slice) => slice.status === "running")?.id
    ?? null;

  if (!sliceId) {
    console.log("Nothing to resume.");
    return;
  }

  const slice = state.slices[sliceId];
  if (!slice) {
    console.log(`Slice ${sliceId} not found in state.`);
    return;
  }

  // The interrupted slice may have left partial edits. If so, require the
  // user to explicitly opt into discarding them — they may have inspected
  // or modified the work before resuming.
  if (await hasUncommittedChanges()) {
    if (!hasFlag(args, "--discard")) {
      console.error(
        "Working tree has uncommitted changes from the interrupted slice.\n" +
        "Run `ember resume --discard` to discard them and retry, or\n" +
        "commit/stash the changes manually first."
      );
      process.exit(1);
    }
    console.log("[resume] Discarding uncommitted changes from interrupted slice...");
    await resetWorkingTree();
  }

  if (slice.status === "running") {
    slice.status = "pending";
  }

  console.log(
    `Resuming slice ${slice.id} [${slice.kind}] (iteration ${slice.reviewIterations})`
  );

  state.currentRun = null;
  await writeState(projectRoot, state);

  // Run directly instead of going through cmdRun, which would re-assert
  // clean tree (already handled above) and re-sync state (already loaded).
  await runSliceWithRetries(projectRoot, state, slice, config, "run");
}

// --- Shared slice execution ---

interface InterruptState {
  stopping: boolean;
  forceKill: boolean;
  cleanup: () => void;
}

async function runSliceWithRetries(
  projectRoot: string,
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  mode: "run" | "afk",
  interrupt?: InterruptState,
  allowCommits = false
): Promise<string> {
  const runId = generateRunId();
  const logger = createRunLog(projectRoot, runId);

  transitionSlice(state, slice.id, "running");
  state.currentRun = {
    runId,
    mode,
    sliceId: slice.id,
    step: "work",
    reviewIteration: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await writeState(projectRoot, state);

  if (mode === "run") {
    console.log(`\nEmber run ${runId}`);
    console.log(`Slice: ${slice.id} [${slice.kind}] — ${slice.title}`);
  }

  let outcome = await executeSlice(state, slice, config, logger, projectRoot, allowCommits);

  while (
    outcome === "iterate" &&
    slice.reviewIterations < config.loop.maxReviewIterations &&
    !(interrupt?.stopping) &&
    !(interrupt?.forceKill)
  ) {
    console.log(
      `  [iterate] Retry ${slice.reviewIterations}/${config.loop.maxReviewIterations}`
    );
    state.currentRun.reviewIteration = slice.reviewIterations;
    await writeState(projectRoot, state);
    outcome = await executeSlice(state, slice, config, logger, projectRoot, allowCommits);
  }

  if (outcome === "iterate") {
    console.log(`\nMax review iterations reached. Marking as failed.`);
    transitionSlice(state, slice.id, "failed");
  }

  // Catch-all: if the slice is still "running" after an error, transition it
  // so it doesn't stay stranded and block future automation.
  if (outcome === "error" && slice.status === "running") {
    transitionSlice(state, slice.id, "failed");
  }

  if (interrupt?.forceKill) {
    state.currentRun.status = "interrupted";
    await writeState(projectRoot, state);
  } else {
    state.currentRun = null;
    await writeState(projectRoot, state);
  }

  await logger.close();

  if (mode === "run") {
    console.log(`\nRun ${runId} finished: ${outcome}`);
  }

  return outcome;
}

// --- Interrupt handling ---

function setupInterruptHandler(): InterruptState {
  const state: InterruptState = {
    stopping: false,
    forceKill: false,
    cleanup: () => process.removeListener("SIGINT", handler),
  };

  const handler = () => {
    if (state.stopping) {
      state.forceKill = true;
      console.log("\nForce stopping...");
      return;
    }
    state.stopping = true;
    console.log("\nStopping after current slice... (Ctrl+C again to force)");
  };

  process.on("SIGINT", handler);
  return state;
}

// --- Status display helpers ---

function groupSlicesByPrd(
  state: EmberState
): Map<string, { total: number; done: number }> {
  const map = new Map<string, { total: number; done: number }>();
  for (const slice of Object.values(state.slices)) {
    const entry = map.get(slice.prdId) ?? { total: 0, done: 0 };
    entry.total++;
    if (slice.status === "done") entry.done++;
    map.set(slice.prdId, entry);
  }
  return map;
}

function printPrdTable(
  prds: EmberState["prds"][string][],
  slicesByPrd: Map<string, { total: number; done: number }>
) {
  console.log(
    `${"PRD".padEnd(6)}${"Title".padEnd(25)}${"Status".padEnd(12)}${"Tracer".padEnd(8)}${"Slices".padEnd(10)}Criteria`
  );
  console.log("-".repeat(60));

  let totalSlices = 0;
  let doneSlices = 0;
  let totalCriteria = 0;
  let doneCriteria = 0;

  for (const prd of prds) {
    const criteria = Object.values(prd.criteria);
    const doneCriteriaCount = criteria.filter((criterion) => criterion.status === "done").length;
    const sliceCounts = slicesByPrd.get(prd.id) ?? { total: 0, done: 0 };

    totalSlices += sliceCounts.total;
    doneSlices += sliceCounts.done;
    totalCriteria += criteria.length;
    doneCriteria += doneCriteriaCount;

    const tracer = prd.tracerValidated ? "yes" : "no";
    console.log(
      `${prd.id.padEnd(6)}${prd.title.slice(0, 24).padEnd(25)}${prd.status.padEnd(12)}${tracer.padEnd(8)}${`${sliceCounts.done}/${sliceCounts.total}`.padEnd(10)}${doneCriteriaCount}/${criteria.length}`
    );
  }

  console.log("-".repeat(60));
  console.log(
    `${"".padEnd(6)}${"TOTAL".padEnd(25)}${"".padEnd(12)}${"".padEnd(8)}${`${doneSlices}/${totalSlices}`.padEnd(10)}${doneCriteria}/${totalCriteria}`
  );
}

function printOpenSlices(state: EmberState) {
  const openSlices = Object.values(state.slices).filter(
    (slice) => slice.status === "pending" || slice.status === "running"
  );
  if (openSlices.length === 0) return;

  console.log("\nOpen Slices:");
  for (const slice of openSlices) {
    console.log(
      `  ${slice.id.padEnd(20)}[${slice.kind}]  ${slice.title.slice(0, 35).padEnd(37)}${slice.status}`
    );
  }
}

function printRecentHistory(state: EmberState) {
  const recent = state.history.slice(-5);
  if (recent.length === 0) return;

  console.log("\nRecent History:");
  for (const entry of recent) {
    const cost = entry.costUsd ? `$${entry.costUsd.toFixed(2)}` : "";
    console.log(
      `  ${entry.sliceId.padEnd(20)}${entry.verdict.padEnd(10)}${entry.summary.slice(0, 30).padEnd(32)}${cost}`
    );
  }
}

function printActiveRun(state: EmberState) {
  if (!state.currentRun) return;
  console.log(`\nActive Run: ${state.currentRun.runId}`);
  console.log(`  Slice: ${state.currentRun.sliceId} — Step: ${state.currentRun.step}`);
}

function printNextSlice(state: EmberState) {
  const next = selectNextSlice(state);
  if (!next) return;
  console.log(`\nNext: ${next.id} [${next.kind}] — ${next.title}`);
}

// --- reset ---

async function cmdReset(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  const state = await syncState(projectRoot);

  const sliceId = parseArg(args, "--slice");
  const all = hasFlag(args, "--all");

  if (sliceId) {
    const slice = state.slices[sliceId];
    if (!slice) {
      console.error(`Slice ${sliceId} not found.`);
      process.exit(1);
    }
    if (slice.status === "done") {
      console.log(`Slice ${sliceId} is already done.`);
      return;
    }
    slice.status = "pending";
    slice.reviewIterations = 0;
    slice.blockReason = null;
    console.log(`Reset ${sliceId} to pending.`);
  } else if (all) {
    const count = unstickState(state);
    console.log(`Reset ${count} slice(s) to pending.`);
  } else {
    // Show what's stuck and ask
    const stuck = Object.values(state.slices).filter(
      (s) => s.status === "failed" || s.status === "blocked" || s.status === "running"
    );
    if (stuck.length === 0) {
      console.log("No stuck slices.");
      return;
    }
    console.log("Stuck slices:");
    for (const s of stuck) {
      console.log(`  ${s.id.padEnd(20)} ${s.status.padEnd(10)} ${s.title}`);
    }
    console.log(`\nUse --all to reset all, or --slice <id> to reset one.`);
    return;
  }

  state.currentRun = null;
  await writeState(projectRoot, state);
}

/**
 * Ensure tree is clean before running. With --clean, discard changes
 * automatically. Without it, tell the user what to do.
 */
async function ensureCleanTree(args: string[]): Promise<void> {
  if (!(await hasUncommittedChanges())) return;

  if (hasFlag(args, "--clean")) {
    console.log("Discarding uncommitted changes (--clean)...");
    await resetWorkingTree();
    return;
  }

  console.error(
    "Working tree is not clean.\n" +
    "  Run with --clean to discard uncommitted changes, or\n" +
    "  commit/stash them manually first."
  );
  process.exit(1);
}

/**
 * Reset failed/blocked/running slices back to pending.
 * Returns the count of slices reset.
 */
function unstickState(state: EmberState): number {
  let count = 0;
  for (const slice of Object.values(state.slices)) {
    if (slice.status === "failed" || slice.status === "blocked" || slice.status === "running") {
      slice.status = "pending";
      slice.reviewIterations = 0;
      slice.blockReason = null;
      count++;
    }
  }
  return count;
}

// --- Utility ---

/**
 * Ensure .ember/ directories exist and .gitignore is in place.
 * Called by run/afk/resume so the user doesn't have to remember `ember init`.
 */
async function ensureEmberDirs(projectRoot: string): Promise<void> {
  const emberDir = path.join(projectRoot, ".ember");
  const runsDir = path.join(emberDir, "runs");
  await Bun.$`mkdir -p ${runsDir}`.quiet();

  const gitignorePath = path.join(emberDir, ".gitignore");
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, "# Ember artifacts — do not track\n*\n");
  }
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseArg(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

function generateRunId(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function findProjectRoot(): Promise<string> {
  let dir = process.cwd();
  const MAX_DEPTH = 50; // safety bound on directory traversal
  for (let depth = 0; depth < MAX_DEPTH && dir !== "/"; depth++) {
    const gitDir = path.join(dir, ".git");
    const file = Bun.file(gitDir);
    if (await file.exists()) return dir;
    try {
      const result = await Bun.$`test -d ${gitDir}`.quiet();
      if (result.exitCode === 0) return dir;
    } catch {
      // .git is neither a file nor directory at this level; continue up
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exit(1);
});
