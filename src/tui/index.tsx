import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState } from "react";
import { HomeScreen } from "./home";
import { RunScreen } from "./run";
import type { AppState, ToolEvent, PrdInfo, SliceInfo } from "./types";
import { syncState } from "../state";
import { loadConfig } from "../config";
import { selectNextSlice } from "../select";
import { executeSlice } from "../loop";
import { createRunLog } from "../log";
import { transitionSlice } from "../slices";
import { writeState } from "../state";
import { resetWorkingTree, hasUncommittedChanges, setGitRoot, getFullDiff } from "../git";
import path from "node:path";

// --- App ---

function App({ initialState, onExit, onStartRun, onPause, onSkip, onHome }: {
  initialState: AppState;
  onExit: () => void;
  onStartRun: (prdId?: string) => void;
  onPause: () => void;
  onSkip: () => void;
  onHome: () => void;
}) {
  const [state, setState] = useState(initialState);

  // Expose setState so the runner bridge can push updates
  (globalThis as any).__emberTuiUpdate = setState;

  if (state.screen === "home") {
    return <HomeScreen state={state} onStartRun={onStartRun} onExit={onExit} />;
  }

  return <RunScreen state={state} onExit={onExit} onPause={onPause} onSkip={onSkip} onHome={onHome} />;
}

// --- Clean exit ---

let _renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

export function cleanExit() {
  if (_renderer) {
    _renderer.destroy();
    _renderer = null;
  }
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1003l\x1b[?2004l\x1b[0m\n");
  process.exit(0);
}

function updateState(fn: (prev: AppState) => AppState) {
  const updater = (globalThis as any).__emberTuiUpdate;
  if (updater) updater(fn);
}

// --- Build initial state from disk ---

async function buildHomeState(projectRoot: string): Promise<AppState> {
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
    date: h.completedAt.slice(0, 10),
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

// --- Run bridge: wire executeSlice to TUI events ---

const NO_CHANGES_THRESHOLD = 2;

async function runWithTui(projectRoot: string) {
  const config = await loadConfig(projectRoot);

  // Clean tree if needed
  if (await hasUncommittedChanges()) {
    updateState((s) => ({ ...s, events: [...s.events, { type: "text", detail: "Cleaning working tree...", timestamp: Date.now() }] }));
    await resetWorkingTree();
  }

  const emberState = await syncState(projectRoot);

  // Build slice list for TUI
  const slices: SliceInfo[] = Object.values(emberState.slices).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    criterionId: s.criterionIds[0] ?? s.id,
    status: s.status as SliceInfo["status"],
  }));

  updateState((s) => ({
    ...s,
    screen: "run",
    mode: "running",
    slices,
    events: [],
    diff: "",
    completed: 0,
    failed: 0,
    totalCost: 0,
    startTimeMs: Date.now(),
    currentSliceIndex: -1,
  }));

  let completed = 0;
  let failed = 0;
  let totalCost = 0;

  // Override the runner's printStreamEvent to feed the TUI instead
  const originalPrint = (globalThis as any).__emberPrintEvent;

  (globalThis as any).__emberPrintEvent = (event: Record<string, unknown>) => {
    const tuiEvent = streamEventToToolEvent(event);
    if (tuiEvent) {
      updateState((s) => ({ ...s, events: [...s.events, tuiEvent] }));
    }
  };

  const maxSlices = config.loop.maxAfkSlices;

  for (let i = 0; i < maxSlices; i++) {
    const freshState = await syncState(projectRoot);
    const slice = selectNextSlice(freshState);

    if (!slice) {
      updateState((s) => ({
        ...s,
        events: [...s.events, { type: "text", detail: "All slices done (or blocked).", timestamp: Date.now() }],
        mode: "finished",
      }));
      break;
    }

    // Find slice index in TUI list
    const sliceIdx = slices.findIndex((s) => s.id === slice.id);

    updateState((s) => {
      const newSlices = [...s.slices];
      if (sliceIdx >= 0) newSlices[sliceIdx] = { ...newSlices[sliceIdx], status: "running" };
      return {
        ...s,
        currentSliceIndex: sliceIdx,
        slices: newSlices,
        events: [...s.events, { type: "slice_start", detail: `${slice.criterionIds[0] ?? slice.id} — ${slice.title}`, timestamp: Date.now() }],
      };
    });

    // Run the slice
    const runId = `${Date.now()}`;
    const logger = createRunLog(projectRoot, runId);

    transitionSlice(freshState, slice.id, "running");
    freshState.currentRun = {
      runId,
      mode: "afk",
      sliceId: slice.id,
      step: "work",
      reviewIteration: 0,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await writeState(projectRoot, freshState);

    const outcome = await executeSlice(freshState, slice, config, logger, projectRoot);

    // Get diff after work
    const diff = await getFullDiff();
    if (diff.trim()) {
      updateState((s) => ({ ...s, diff }));
    }

    if (outcome === "done") {
      completed++;
      totalCost += freshState.history[freshState.history.length - 1]?.costUsd ?? 0;
      updateState((s) => {
        const newSlices = [...s.slices];
        if (sliceIdx >= 0) newSlices[sliceIdx] = { ...newSlices[sliceIdx], status: "done" };
        return {
          ...s,
          slices: newSlices,
          completed,
          totalCost,
          events: [...s.events, { type: "slice_end", detail: `${slice.criterionIds[0]} done ✓`, timestamp: Date.now() }],
        };
      });
    } else if (outcome === "no_changes") {
      slice.reviewIterations = (slice.reviewIterations ?? 0) + 1;

      if (slice.reviewIterations >= NO_CHANGES_THRESHOLD) {
        // Auto-advance
        transitionSlice(freshState, slice.id, "done");
        const prd = freshState.prds[slice.prdId];
        if (prd) {
          for (const cId of slice.criterionIds) {
            const c = prd.criteria[cId];
            if (c && c.status !== "done") {
              c.status = "done";
              c.completedAt = new Date().toISOString();
              c.completedBySlice = slice.id;
            }
          }
        }
        await writeState(projectRoot, freshState);
        completed++;

        updateState((s) => {
          const newSlices = [...s.slices];
          if (sliceIdx >= 0) newSlices[sliceIdx] = { ...newSlices[sliceIdx], status: "done" };
          return {
            ...s,
            slices: newSlices,
            completed,
            events: [...s.events, { type: "slice_end", detail: `${slice.criterionIds[0]} auto-advanced (no changes needed)`, timestamp: Date.now() }],
          };
        });
      } else {
        updateState((s) => {
          const newSlices = [...s.slices];
          if (sliceIdx >= 0) newSlices[sliceIdx] = { ...newSlices[sliceIdx], status: "no_changes" };
          return {
            ...s,
            slices: newSlices,
            events: [...s.events, { type: "text", detail: `No changes (attempt ${slice.reviewIterations}/${NO_CHANGES_THRESHOLD})`, timestamp: Date.now() }],
          };
        });
      }
    } else {
      // Error
      failed++;
      if (slice.status === "running") {
        transitionSlice(freshState, slice.id, "failed");
      }
      await resetWorkingTree();

      updateState((s) => {
        const newSlices = [...s.slices];
        if (sliceIdx >= 0) newSlices[sliceIdx] = { ...newSlices[sliceIdx], status: "failed" };
        return {
          ...s,
          slices: newSlices,
          failed,
          events: [...s.events, { type: "slice_end", detail: `${slice.criterionIds[0]} failed ✗`, isError: true, timestamp: Date.now() }],
        };
      });
    }

    freshState.currentRun = null;
    await writeState(projectRoot, freshState);
    await logger.close();
  }

  // Restore original print
  (globalThis as any).__emberPrintEvent = originalPrint;

  updateState((s) => ({ ...s, mode: "finished" }));
}

function streamEventToToolEvent(event: Record<string, unknown>): ToolEvent | null {
  const now = Date.now();

  if (event.type === "assistant") {
    const message = event.message as { content?: { type: string; name?: string; text?: string; input?: { description?: string; command?: string } }[] } | undefined;
    if (!message?.content) return null;

    for (const block of message.content) {
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          name: block.name,
          detail: block.input?.command ?? block.input?.description?.slice(0, 100) ?? "",
          timestamp: now,
        };
      }
      if (block.type === "text" && block.text) {
        const firstLine = block.text.split("\n")[0].slice(0, 120);
        if (firstLine.trim()) {
          return { type: "text", detail: firstLine, timestamp: now };
        }
      }
    }
  }

  if (event.type === "user") {
    const message = event.message as { content?: { type: string; is_error?: boolean }[] } | undefined;
    if (!message?.content) return null;
    for (const block of message.content) {
      if (block.type === "tool_result") {
        return { type: "tool_result", isError: block.is_error ?? false, timestamp: now };
      }
    }
  }

  if (event.type === "result") {
    return {
      type: "done",
      cost: (event.cost_usd as number) ?? undefined,
      durationSec: ((event.duration_ms as number) ?? 0) / 1000,
      timestamp: now,
    };
  }

  return null;
}

// --- Entry ---

export async function launchTui(projectRoot: string) {
  setGitRoot(projectRoot);

  // Ensure .ember/ exists
  const emberDir = path.join(projectRoot, ".ember");
  await Bun.$`mkdir -p ${path.join(emberDir, "runs")}`.quiet();
  const gitignorePath = path.join(emberDir, ".gitignore");
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, "# Ember artifacts — do not track\n*\n");
  }

  const initialState = await buildHomeState(projectRoot);

  _renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  process.on("SIGINT", cleanExit);
  process.on("SIGTERM", cleanExit);

  createRoot(_renderer).render(
    <App
      initialState={initialState}
      onExit={cleanExit}
      onStartRun={() => { runWithTui(projectRoot); }}
      onPause={() => { /* TODO: signal pause to runner */ }}
      onSkip={() => { /* TODO: signal skip to runner */ }}
      onHome={async () => {
        const fresh = await buildHomeState(projectRoot);
        updateState(() => fresh);
      }}
    />
  );
}
