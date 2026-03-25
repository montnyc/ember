#!/usr/bin/env bun

import path from "node:path";
import { syncState, writeState } from "./state";
import { loadConfig, writeDefaultConfig } from "./config";
import { selectNextSlice } from "./select";
import { transitionSlice, createFixSlice } from "./slices";
import { executeSlice } from "./loop";
import type { SliceResult } from "./loop";
import { createRunLog } from "./log";
import { resetWorkingTree, hasUncommittedChanges, setGitRoot } from "./git";
import type { EmberConfig, EmberState, SliceState } from "./types";

/** After this many consecutive no-change results, auto-advance the slice.
 * Set to 3 (not 2) to reduce false positives — Claude must confirm 3 times
 * that no changes are needed before we believe it. */
const NO_CHANGES_THRESHOLD = 3;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    // No args → launch TUI
    const { launchTui } = await import("./tui/index");
    const projectRoot = await findProjectRoot();
    await launchTui(projectRoot);
    return;
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
    case "plan":
      await cmdPlan(args.slice(1));
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

// --- plan ---

async function cmdPlan(args: string[]) {
  const description = args.join(" ").trim();
  if (!description) {
    console.error('Usage: ember plan "Build a dashboard for daily pipeline runs"');
    process.exit(1);
  }

  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);

  const { generatePrd } = await import("./planner");
  await generatePrd(description, projectRoot);
}

function printUsage() {
  console.log(`Usage: ember <command>

Commands:
  plan "<description>"          Generate a PRD from a brief description
  init                          Initialize and sync PRDs (re-run to unstick)
  run [--slice <id>]            Run one slice
  afk [--max-slices N]          Run slices until done or cap
  resume [--discard]            Resume an interrupted run
  reset [--slice <id>] [--all]  Reset failed/blocked slices to pending
  status                        Show current state
  install-skill                 Install /ember-prd skill for Claude Code

Options:
  --clean                       Discard uncommitted changes before running
  --tui                         Run inside the interactive TUI dashboard`);
}

// --- init ---

async function cmdInit() {
  const projectRoot = await findProjectRoot();
  const emberDir = path.join(projectRoot, ".ember");
  const runsDir = path.join(emberDir, "runs");

  await Bun.$`mkdir -p ${runsDir}`.quiet();
  await writeDefaultConfig(projectRoot);

  const gitignorePath = path.join(emberDir, ".gitignore");
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, "# Ember artifacts — do not track\n*\n");
  }
  const state = await syncState(projectRoot);

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

  // Auto-install /ember-prd skill for Claude Code if not already present
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const skillPath = path.join(HOME, ".claude", "skills", "ember-prd", "SKILL.md");
  if (HOME && !(await Bun.file(skillPath).exists())) {
    try {
      await import("./install-skill");
    } catch {
      // Skill install is non-critical — don't block init
    }
  }

  console.log(`Ember initialized in ${projectRoot}`);
  console.log(`  PRDs:     ${prdCount}`);
  console.log(`  Criteria: ${criteriaCount}`);
  console.log(`  Slices:   ${sliceCount} (${pendingSlices} pending)`);
  if (prdCount === 0) {
    console.log(`\n  No PRDs found. Create one with:`);
    console.log(`    ember plan "describe what you want to build"`);
  }
}

// --- run ---

async function cmdRun(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  await ensureCleanTree(args);
  const state = await syncState(projectRoot);
  const config = await loadConfig(projectRoot);

  const sliceId = parseArg(args, "--slice");
  const slice = sliceId ? state.slices[sliceId] : selectNextSlice(state);

  if (!slice) {
    console.log(sliceId ? `Slice ${sliceId} not found.` : "No actionable slices.");
    return;
  }

  // If targeting a specific slice that's stuck, auto-reset it
  if (sliceId && slice.status !== "pending" && slice.status !== "done") {
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

  console.log(`\nEmber run: ${slice.id} [${slice.kind}] — ${slice.title}`);
  await runOneSlice(projectRoot, state, slice, config);
}

// --- afk ---

async function cmdAfk(args: string[]) {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);

  const config = await loadConfig(projectRoot);
  const maxSlicesArg = parseArg(args, "--max-slices");
  const maxSlices = maxSlicesArg ? parseInt(maxSlicesArg, 10) : config.loop.maxAfkSlices;

  // --tui flag: run inside the TUI instead of terminal mode
  if (hasFlag(args, "--tui")) {
    const { launchTui } = await import("./tui/index");
    await launchTui(projectRoot, maxSlices);
    return;
  }

  await ensureCleanTree(args);

  const interrupt = setupInterruptHandler();
  const startTimeMs = Date.now();
  let completed = 0;
  let totalCostUsd = 0;
  let consecutiveErrors = 0;
  let pendingCheckFailure: string | null = null; // check output from previous slice to feed into fix

  const CIRCUIT_BREAKER_THRESHOLD = 5;
  const MAX_FIX_ATTEMPTS = 3;

  console.log(`\nEmber AFK mode — max ${maxSlices} slices`);

  try {
    while (completed < maxSlices && !interrupt.stopping) {
      // Circuit breaker: stop after too many consecutive errors
      if (consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD) {
        console.log(`\n⚠ Circuit breaker: ${consecutiveErrors} consecutive errors. Stopping.`);
        break;
      }

      const state = await syncState(projectRoot);
      const slice = selectNextSlice(state);

      if (!slice) {
        console.log("\nAll slices done (or blocked).");
        break;
      }

      console.log(
        `\n${"=".repeat(50)}\n  Slice ${completed + 1}/${maxSlices}: ${slice.id} [${slice.kind}]\n  ${slice.title}\n${"=".repeat(50)}`
      );

      const sliceResult = await runOneSlice(projectRoot, state, slice, config, pendingCheckFailure);
      pendingCheckFailure = null; // consumed

      if (interrupt.forceKill) break;

      if (sliceResult.status === "done") {
        consecutiveErrors = 0;
        completed++;
        const lastHistory = state.history[state.history.length - 1];
        if (lastHistory?.costUsd) totalCostUsd += lastHistory.costUsd;

        // If checks failed, create a fix slice for the next iteration
        if (sliceResult.checksPassed === false && sliceResult.checkOutput) {
          const fixCount = Object.keys(state.slices).filter((id) => id.includes(":fix-")).length;
          if (fixCount < MAX_FIX_ATTEMPTS) {
            const fixSlice = createFixSlice(slice, sliceResult.checkOutput, state.slices);
            state.slices[fixSlice.id] = fixSlice;
            await writeState(projectRoot, state);
            pendingCheckFailure = sliceResult.checkOutput;
            console.log(`  Created fix slice: ${fixSlice.id}`);
          } else {
            console.log(`  Checks failed but max fix attempts (${MAX_FIX_ATTEMPTS}) reached.`);
          }
        }
      } else if (sliceResult.status === "no_changes") {
        consecutiveErrors = 0;
        completed++;
      } else {
        consecutiveErrors++;
        await resetWorkingTree();
      }
    }
  } finally {
    interrupt.cleanup();
  }

  const elapsedMinutes = ((Date.now() - startTimeMs) / 1000 / 60).toFixed(1);
  console.log(`\n=== AFK Summary ===`);
  console.log(`  Completed: ${completed}`);
  console.log(`  Time:      ${elapsedMinutes} min`);
  console.log(`  Cost:      $${totalCostUsd.toFixed(2)}`);
  if (consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD) {
    console.log(`  ⚠ Stopped due to ${consecutiveErrors} consecutive errors`);
  }
}

// --- status ---

async function cmdStatus() {
  const projectRoot = await findProjectRoot();
  setGitRoot(projectRoot);
  await ensureEmberDirs(projectRoot);
  const state = await syncState(projectRoot);

  console.log("\nEmber Status");
  console.log("=".repeat(60));

  const prds = Object.values(state.prds);
  if (prds.length === 0) {
    console.log("No PRDs found. Run 'ember init' first.");
    return;
  }

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

  const sliceId = state.currentRun?.sliceId
    ?? Object.values(state.slices).find((s) => s.status === "running")?.id
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

  if (await hasUncommittedChanges()) {
    if (!hasFlag(args, "--discard")) {
      console.error(
        "Working tree has uncommitted changes.\n" +
        "Run `ember resume --discard` to discard them, or\n" +
        "commit/stash them manually first."
      );
      process.exit(1);
    }
    console.log("Discarding uncommitted changes...");
    await resetWorkingTree();
  }

  if (slice.status === "running") {
    slice.status = "pending";
  }

  state.currentRun = null;
  await writeState(projectRoot, state);

  console.log(`Resuming: ${slice.id} [${slice.kind}] — ${slice.title}`);
  await runOneSlice(projectRoot, state, slice, config);
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
    if (!slice) { console.error(`Slice ${sliceId} not found.`); process.exit(1); }
    if (slice.status === "done") { console.log(`${sliceId} is already done.`); return; }
    slice.status = "pending";
    slice.reviewIterations = 0;
    slice.blockReason = null;
    console.log(`Reset ${sliceId} to pending.`);
  } else if (all) {
    console.log(`Reset ${unstickState(state)} slice(s) to pending.`);
  } else {
    const stuck = Object.values(state.slices).filter(
      (s) => s.status === "failed" || s.status === "blocked" || s.status === "running"
    );
    if (stuck.length === 0) { console.log("No stuck slices."); return; }
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

// --- Core slice runner ---
// Simple: run Claude, check for changes, commit or auto-advance. No review/gate.

async function runOneSlice(
  projectRoot: string,
  state: EmberState,
  slice: SliceState,
  config: EmberConfig,
  checkFailureContext?: string | null
): Promise<SliceResult> {
  const runId = generateRunId();
  const logger = createRunLog(projectRoot, runId);

  transitionSlice(state, slice.id, "running");
  state.currentRun = {
    runId,
    mode: "run",
    sliceId: slice.id,
    step: "work",
    reviewIteration: 0,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await writeState(projectRoot, state);

  const sliceResult = await executeSlice(state, slice, config, logger, projectRoot, checkFailureContext ?? undefined);

  if (sliceResult.status === "no_changes") {
    slice.reviewIterations++;

    if (slice.reviewIterations >= NO_CHANGES_THRESHOLD) {
      console.log(`  ⚠ Auto-advancing: Claude reported no changes needed ${slice.reviewIterations}x. Marking as done.`);
      transitionSlice(state, slice.id, "done");

      for (const criterionId of slice.criterionIds) {
        const prd = state.prds[slice.prdId];
        const criterion = prd?.criteria[criterionId];
        if (criterion && criterion.status !== "done") {
          criterion.status = "done";
          criterion.completedAt = new Date().toISOString();
          criterion.completedBySlice = slice.id;
        }
      }

      const prd = state.prds[slice.prdId];
      if (prd) {
        const allDone = Object.values(prd.criteria).every((c) => c.status === "done");
        prd.status = allDone ? "completed" : "in_progress";
        if (slice.kind === "tracer") prd.tracerValidated = true;
      }
    } else {
      console.log(`  No changes (attempt ${slice.reviewIterations}/${NO_CHANGES_THRESHOLD})`);
    }
  }

  if (slice.status === "running") {
    transitionSlice(state, slice.id, "failed");
  }

  state.currentRun = null;
  await writeState(projectRoot, state);
  await logger.close();

  return sliceResult;
}

// --- Interrupt handling ---

interface InterruptState {
  stopping: boolean;
  forceKill: boolean;
  cleanup: () => void;
}

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

// --- Status display ---

function groupSlicesByPrd(state: EmberState): Map<string, { total: number; done: number }> {
  const map = new Map<string, { total: number; done: number }>();
  for (const slice of Object.values(state.slices)) {
    const entry = map.get(slice.prdId) ?? { total: 0, done: 0 };
    entry.total++;
    if (slice.status === "done") entry.done++;
    map.set(slice.prdId, entry);
  }
  return map;
}

function printPrdTable(prds: EmberState["prds"][string][], slicesByPrd: Map<string, { total: number; done: number }>) {
  console.log(`${"PRD".padEnd(6)}${"Title".padEnd(25)}${"Status".padEnd(12)}${"Tracer".padEnd(8)}${"Slices".padEnd(10)}Criteria`);
  console.log("-".repeat(60));
  let totalSlices = 0, doneSlices = 0, totalCriteria = 0, doneCriteria = 0;
  for (const prd of prds) {
    const criteria = Object.values(prd.criteria);
    const done = criteria.filter((c) => c.status === "done").length;
    const sc = slicesByPrd.get(prd.id) ?? { total: 0, done: 0 };
    totalSlices += sc.total; doneSlices += sc.done; totalCriteria += criteria.length; doneCriteria += done;
    console.log(`${prd.id.padEnd(6)}${prd.title.slice(0, 24).padEnd(25)}${prd.status.padEnd(12)}${(prd.tracerValidated ? "yes" : "no").padEnd(8)}${`${sc.done}/${sc.total}`.padEnd(10)}${done}/${criteria.length}`);
  }
  console.log("-".repeat(60));
  console.log(`${"".padEnd(6)}${"TOTAL".padEnd(25)}${"".padEnd(12)}${"".padEnd(8)}${`${doneSlices}/${totalSlices}`.padEnd(10)}${doneCriteria}/${totalCriteria}`);
}

function printOpenSlices(state: EmberState) {
  const open = Object.values(state.slices).filter((s) => s.status === "pending" || s.status === "running");
  if (open.length === 0) return;
  console.log("\nOpen Slices:");
  for (const s of open) console.log(`  ${s.id.padEnd(20)}[${s.kind}]  ${s.title.slice(0, 40)}`);
}

function printRecentHistory(state: EmberState) {
  const recent = state.history.slice(-5);
  if (recent.length === 0) return;
  console.log("\nRecent History:");
  for (const h of recent) {
    const cost = h.costUsd ? `$${h.costUsd.toFixed(2)}` : "";
    console.log(`  ${h.sliceId.padEnd(20)}${h.verdict.padEnd(10)}${h.summary.slice(0, 30).padEnd(32)}${cost}`);
  }
}

function printActiveRun(state: EmberState) {
  if (!state.currentRun) return;
  console.log(`\nActive Run: ${state.currentRun.runId} — ${state.currentRun.sliceId}`);
}

function printNextSlice(state: EmberState) {
  const next = selectNextSlice(state);
  if (!next) return;
  console.log(`\nNext: ${next.id} [${next.kind}] — ${next.title}`);
}

// --- Utility ---

async function ensureEmberDirs(projectRoot: string): Promise<void> {
  const emberDir = path.join(projectRoot, ".ember");
  await Bun.$`mkdir -p ${path.join(emberDir, "runs")}`.quiet();
  const gitignorePath = path.join(emberDir, ".gitignore");
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, "# Ember artifacts — do not track\n*\n");
  }
}

async function ensureCleanTree(args: string[]): Promise<void> {
  if (!(await hasUncommittedChanges())) return;
  if (hasFlag(args, "--clean")) {
    console.log("Discarding uncommitted changes (--clean)...");
    await resetWorkingTree();
    return;
  }
  console.error("Working tree is not clean.\n  Run with --clean to discard, or commit/stash manually.");
  process.exit(1);
}

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

function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }
function parseArg(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

function generateRunId(): string {
  const now = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

async function findProjectRoot(): Promise<string> {
  let dir = process.cwd();
  // Walk up to 50 ancestor directories (typical filesystem depth < 10)
  for (let depth = 0; depth < 50 && dir !== "/"; depth++) {
    const gitDir = path.join(dir, ".git");
    if (await Bun.file(gitDir).exists()) return dir;
    try {
      if ((await Bun.$`test -d ${gitDir}`.quiet()).exitCode === 0) return dir;
    } catch {
      // .git is neither a file nor directory at this level; continue up
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
