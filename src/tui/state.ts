import type { AppState, ToolEvent, PrdInfo } from "./types";
import { syncState } from "../state";

/**
 * Update TUI state via the global hook exposed by the App component.
 */
export function updateState(fn: (prev: AppState) => AppState) {
  const updater = (globalThis as any).__emberTuiUpdate;
  if (updater) updater(fn);
}

/**
 * Push a single event to the TUI activity log.
 */
export function pushEvent(event: ToolEvent) {
  updateState((s) => ({ ...s, events: [...s.events, event] }));
}

/**
 * Build the TUI home screen state from disk (PRDs, history, slices).
 */
export async function buildHomeState(projectRoot: string): Promise<AppState> {
  const state = await syncState(projectRoot);

  const prds: PrdInfo[] = Object.values(state.prds).map((prd) => {
    const criteria = Object.values(prd.criteria);
    const slices = Object.values(state.slices).filter((s) => s.prdId === prd.id);
    return {
      id: prd.id,
      title: prd.title,
      filename: prd.filename,
      priority: prd.priority,
      totalCriteria: criteria.length,
      doneCriteria: criteria.filter((c) => c.status === "done").length,
      totalSlices: slices.length,
      doneSlices: slices.filter((s) => s.status === "done").length,
    };
  });

  const history = state.history.slice(-10).map((h) => ({
    runId: h.runId,
    sliceId: h.sliceId,
    date: h.completedAt.slice(0, 10),
    verdict: h.verdict,
    slicesCompleted: h.verdict === "done" ? 1 : 0,
    slicesFailed: h.verdict !== "done" ? 1 : 0,
    totalCost: h.costUsd ?? 0,
    durationMin: 0,
  }));

  return {
    screen: "home",
    prds,
    history,
    mode: "idle",
    currentSliceIndex: -1,
    slices: [],
    events: [],
    diff: "",
    completed: 0,
    failed: 0,
    totalCost: 0,
    startTimeMs: 0,
    elapsedMs: 0,
  };
}
