import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState } from "react";
import { HomeScreen } from "./home";
import { RunScreen } from "./run";
import { SessionList } from "./sessions";
import type { AppState, SliceInfo } from "./types";
import { buildHomeState, updateState, pushEvent } from "./state";
import { streamEventToToolEvent } from "./events";
import { runAfkLoop } from "../afk-loop";
import type { AfkReporter } from "../afk-loop";
import { setGitRoot } from "../git";
import path from "node:path";

// --- App component ---

function App({ initialState, onExit, onStartRun, onPause, onSkip, onHome, onPlan, onCreateDir }: {
  initialState: AppState;
  onExit: () => void;
  onStartRun: (maxSlices?: number) => void;
  onPause: () => void;
  onSkip: () => void;
  onHome: () => void;
  onPlan: () => void;
  onCreateDir: () => void;
}) {
  const [state, setState] = useState(initialState);
  (globalThis as any).__emberTuiUpdate = setState;

  if (state.screen === "home") {
    return <HomeScreen
      state={state}
      onStartRun={onStartRun}
      onExit={onExit}
      onSessions={() => setState((s) => ({ ...s, screen: "sessions" }))}
      onPlan={onPlan}
      onCreateDir={onCreateDir}
    />;
  }
  if (state.screen === "sessions") {
    return <SessionList state={state} onBack={() => setState((s) => ({ ...s, screen: "home" }))} />;
  }
  return <RunScreen state={state} onExit={onExit} onPause={onPause} onSkip={onSkip} onHome={onHome} />;
}

// --- Renderer lifecycle ---

let _renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

export function cleanExit() {
  if (_renderer) { _renderer.destroy(); _renderer = null; }
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1003l\x1b[?2004l\x1b[0m\n");
  process.exit(0);
}

// --- TUI reporter: same interface as terminal reporter, but updates React state ---

function tuiReporter(): AfkReporter {
  return {
    onStart(sliceCount) {
      pushEvent({ type: "text", detail: `Starting AFK run — ${sliceCount} slices queued`, timestamp: Date.now() });
    },
    onSliceStart(_index, _total, slice) {
      // Update slice list to show "running"
      updateState((s) => {
        const idx = s.slices.findIndex((sl) => sl.id === slice.id);
        const newSlices = [...s.slices];
        if (idx >= 0) newSlices[idx] = { ...newSlices[idx], status: "running" };
        return {
          ...s,
          currentSliceIndex: idx,
          slices: newSlices,
          events: [...s.events, { type: "slice_start", detail: `${slice.criterionIds[0] ?? slice.id} — ${slice.title}`, timestamp: Date.now() }],
        };
      });
    },
    onSliceDone(slice, checksFailed, completed, totalCost) {
      updateState((s) => {
        const idx = s.slices.findIndex((sl) => sl.id === slice.id);
        const newSlices = [...s.slices];
        if (idx >= 0) newSlices[idx] = { ...newSlices[idx], status: checksFailed ? "failed" : "done" };
        return {
          ...s, slices: newSlices, completed, totalCost,
          events: [...s.events, {
            type: "slice_end",
            detail: checksFailed ? `${slice.criterionIds[0]} — checks/eval failed` : `${slice.criterionIds[0]} done ✓`,
            isError: checksFailed, timestamp: Date.now(),
          }],
        };
      });
    },
    onSliceNoChanges(slice, attempt, threshold) {
      updateState((s) => {
        const idx = s.slices.findIndex((sl) => sl.id === slice.id);
        const newSlices = [...s.slices];
        if (idx >= 0) newSlices[idx] = { ...newSlices[idx], status: "no_changes" };
        return { ...s, slices: newSlices, events: [...s.events, { type: "text", detail: `No changes (${attempt}/${threshold})`, timestamp: Date.now() }] };
      });
    },
    onSliceAutoAdvanced(slice, completed) {
      updateState((s) => {
        const idx = s.slices.findIndex((sl) => sl.id === slice.id);
        const newSlices = [...s.slices];
        if (idx >= 0) newSlices[idx] = { ...newSlices[idx], status: "done" };
        return { ...s, slices: newSlices, completed, events: [...s.events, { type: "slice_end", detail: `${slice.criterionIds[0]} auto-advanced`, timestamp: Date.now() }] };
      });
    },
    onSliceError(slice, failed) {
      updateState((s) => {
        const idx = s.slices.findIndex((sl) => sl.id === slice.id);
        const newSlices = [...s.slices];
        if (idx >= 0) newSlices[idx] = { ...newSlices[idx], status: "failed" };
        return { ...s, slices: newSlices, failed, events: [...s.events, { type: "slice_end", detail: `${slice.criterionIds[0]} error ✗`, isError: true, timestamp: Date.now() }] };
      });
    },
    onFixSliceCreated(fixSliceId) {
      pushEvent({ type: "text", detail: `Created fix slice: ${fixSliceId}`, timestamp: Date.now() });
    },
    onCircuitBreaker(consecutiveErrors) {
      pushEvent({ type: "error", detail: `Circuit breaker: ${consecutiveErrors} consecutive errors.`, timestamp: Date.now() });
    },
    onAllDone() {
      pushEvent({ type: "text", detail: "All slices done (or blocked).", timestamp: Date.now() });
    },
    onDiffUpdate(diff) {
      updateState((s) => ({ ...s, diff }));
    },
    onFinished(completed, failed, totalCost, elapsedMs) {
      updateState((s) => ({ ...s, mode: "finished" }));
    },
  };
}

// --- Run AFK inside TUI ---

async function runAfkInTui(projectRoot: string, maxSlices: number) {
  // Build slice list for TUI display
  const { syncState } = await import("../state");
  const emberState = await syncState(projectRoot);
  const tuiSlices: SliceInfo[] = Object.values(emberState.slices).map((s) => ({
    id: s.id, kind: s.kind, title: s.title,
    criterionId: s.criterionIds[0] ?? s.id,
    status: s.status as SliceInfo["status"],
  }));

  updateState((s) => ({
    ...s, screen: "run", mode: "running", slices: tuiSlices,
    events: [], diff: "", completed: 0, failed: 0, totalCost: 0,
    startTimeMs: Date.now(), currentSliceIndex: -1,
  }));

  // Intercept runner's print events for TUI display
  const originalPrint = (globalThis as any).__emberPrintEvent;
  (globalThis as any).__emberPrintEvent = (event: Record<string, unknown>) => {
    const tuiEvent = streamEventToToolEvent(event);
    if (tuiEvent) pushEvent(tuiEvent);
  };

  await runAfkLoop({
    projectRoot,
    maxSlices,
    reporter: tuiReporter(),
  });

  (globalThis as any).__emberPrintEvent = originalPrint;
}

// --- Entry ---

export async function launchTui(projectRoot: string, maxSlices?: number) {
  setGitRoot(projectRoot);

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
      onStartRun={(max) => { runAfkInTui(projectRoot, max ?? maxSlices ?? 20); }}
      onPause={() => {}}
      onSkip={() => {}}
      onHome={async () => {
        const fresh = await buildHomeState(projectRoot);
        updateState(() => fresh);
      }}
      onPlan={async () => {
        // Exit TUI, run plan command in terminal, then relaunch
        cleanExit();
        console.log("\nTo generate a PRD, run:\n");
        console.log('  ember plan "describe what you want to build"\n');
      }}
      onCreateDir={async () => {
        const prdDir = path.join(projectRoot, "docs", "prd");
        await Bun.$`mkdir -p ${prdDir}`.quiet();
        // Refresh home state
        const fresh = await buildHomeState(projectRoot);
        updateState(() => fresh);
      }}
    />
  );

  if (maxSlices) {
    runAfkInTui(projectRoot, maxSlices);
  }
}
