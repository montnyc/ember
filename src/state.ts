import path from "node:path";
import { rename } from "node:fs/promises";
import { parseAllPrds } from "./prd";
import { createSlicesForPrd } from "./slices";
import type { EmberState, ParsedPrd, PrdState, CriterionState } from "./types";

const EMBER_DIR = ".ember";
const STATE_FILE = "state.json";

function statePath(projectRoot: string): string {
  return path.join(projectRoot, EMBER_DIR, STATE_FILE);
}

export function defaultState(projectRoot: string): EmberState {
  return {
    version: 1,
    projectRoot,
    lastSyncedAt: new Date().toISOString(),
    prds: {},
    slices: {},
    currentRun: null,
    history: [],
    learnings: [],
  };
}

export async function readState(
  projectRoot: string
): Promise<EmberState | null> {
  const file = Bun.file(statePath(projectRoot));
  if (!(await file.exists())) return null;

  try {
    const data = await file.json();
    if (data.version !== 1) {
      console.error(`Unknown state version: ${data.version}. Expected 1.`);
      return null;
    }
    return data as EmberState;
  } catch (error) {
    console.error(`Corrupt state file at ${statePath(projectRoot)}: ${(error as Error).message}`);
    return null;
  }
}

export async function writeState(
  projectRoot: string,
  state: EmberState
): Promise<void> {
  state.lastSyncedAt = new Date().toISOString();

  const filePath = statePath(projectRoot);
  const dir = path.dirname(filePath);
  await Bun.$`mkdir -p ${dir}`.quiet();

  const tmpFile = `${filePath}.tmp.${Date.now()}`;
  await Bun.write(tmpFile, JSON.stringify(state, null, 2) + "\n");
  await rename(tmpFile, filePath);
}

export async function syncState(projectRoot: string): Promise<EmberState> {
  const existing = await readState(projectRoot);
  const parsedPrds = await parseAllPrds(
    path.join(projectRoot, "docs", "prd")
  );
  const state = existing ?? defaultState(projectRoot);
  state.projectRoot = projectRoot;

  const seenPrdIds = new Set<string>();

  for (const parsed of parsedPrds) {
    seenPrdIds.add(parsed.id);
    const existingPrd = state.prds[parsed.id];

    if (existingPrd) {
      updateExistingPrd(existingPrd, parsed);
      // Create slices for any new criteria added to existing PRDs
      for (const slice of createSlicesForPrd(existingPrd, state.slices)) {
        state.slices[slice.id] = slice;
      }
    } else {
      addNewPrd(state, parsed);
    }
  }

  archiveRemovedPrds(state, seenPrdIds);

  await writeState(projectRoot, state);
  return state;
}

// --- Sync helpers ---

function updateExistingPrd(existingPrd: PrdState, parsed: ParsedPrd): void {
  // Merge strategy: preserve "done" criteria across PRD edits so that
  // renaming or reordering criteria doesn't lose progress. Criteria that
  // were pending get reset because their text may have changed meaning.
  existingPrd.criteria = mergeCriteria(existingPrd.criteria, parsed.criteria);
  existingPrd.title = parsed.title;
  existingPrd.dependsOn = parsed.dependsOn;
  existingPrd.priority = parsed.priority;
  existingPrd.status = computePrdStatus(existingPrd.criteria);
}

function addNewPrd(state: EmberState, parsed: ParsedPrd): void {
  const criteria = createFreshCriteria(parsed.criteria);

  const prd: PrdState = {
    id: parsed.id,
    title: parsed.title,
    filename: parsed.filename,
    status: "pending",
    priority: parsed.priority,
    dependsOn: parsed.dependsOn,
    criteria,
    tracerValidated: false,
  };

  state.prds[parsed.id] = prd;

  // Create one slice per pending criterion
  for (const slice of createSlicesForPrd(prd, state.slices)) {
    state.slices[slice.id] = slice;
  }
}

function archiveRemovedPrds(state: EmberState, seenPrdIds: Set<string>): void {
  for (const prdId of Object.keys(state.prds)) {
    if (!seenPrdIds.has(prdId) && state.prds[prdId].status !== "archived") {
      state.prds[prdId].status = "archived";
    }
  }
}

// --- Criteria helpers ---

function mergeCriteria(
  existing: Record<string, CriterionState>,
  parsed: { id: string; text: string }[]
): Record<string, CriterionState> {
  const merged: Record<string, CriterionState> = {};
  for (const parsedCriterion of parsed) {
    const existingCriterion = existing[parsedCriterion.id];
    if (existingCriterion && existingCriterion.status === "done") {
      // Keep completion data, update text in case wording changed
      merged[parsedCriterion.id] = { ...existingCriterion, text: parsedCriterion.text };
    } else {
      merged[parsedCriterion.id] = freshCriterion(parsedCriterion.id, parsedCriterion.text);
    }
  }
  return merged;
}

function createFreshCriteria(
  parsed: { id: string; text: string }[]
): Record<string, CriterionState> {
  const criteria: Record<string, CriterionState> = {};
  for (const parsedCriterion of parsed) {
    criteria[parsedCriterion.id] = freshCriterion(parsedCriterion.id, parsedCriterion.text);
  }
  return criteria;
}

function freshCriterion(id: string, text: string): CriterionState {
  return { id, text, status: "pending", completedAt: null, completedBySlice: null };
}

function computePrdStatus(
  criteria: Record<string, CriterionState>
): PrdState["status"] {
  const values = Object.values(criteria);
  if (values.length === 0) return "pending";
  if (values.every((criterion) => criterion.status === "done")) return "completed";
  if (values.some((criterion) => criterion.status === "done")) return "in_progress";
  return "pending";
}
