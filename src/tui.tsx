import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useCallback } from "react";

// --- Types ---

export interface SliceInfo {
  id: string;
  kind: string;
  title: string;
  criterionId: string;
  status: "pending" | "running" | "done" | "failed" | "no_changes";
}

export interface ToolEvent {
  type: "tool_use" | "tool_result" | "text" | "done" | "commit" | "slice_start" | "slice_end";
  name?: string;
  detail?: string;
  isError?: boolean;
  cost?: number;
  durationSec?: number;
  timestamp?: number;
}

export interface TuiState {
  mode: "idle" | "running" | "paused" | "finished";
  currentSliceIndex: number;
  slices: SliceInfo[];
  events: ToolEvent[];
  diff: string;
  completed: number;
  failed: number;
  totalCost: number;
  startTimeMs: number;
}

type Tab = "activity" | "diff" | "code";

// --- Exported update function for wiring to real loop ---

export type TuiUpdater = (fn: (prev: TuiState) => TuiState) => void;

// --- Header ---

function Header({ state, tab, paused }: { state: TuiState; tab: Tab; paused: boolean }) {
  const elapsed = state.startTimeMs
    ? ((Date.now() - state.startTimeMs) / 1000 / 60).toFixed(1)
    : "0.0";

  const modeLabel = paused ? "paused" : state.mode === "running" ? "afk" : state.mode;
  const modeColor = paused ? "#eab308" : state.mode === "running" ? "#22c55e" : "#666";

  return (
    <box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <text>
        <span fg="#f97316"><strong>ember</strong></span>
        <span fg={modeColor}> {modeLabel}</span>
        <span fg="#444"> │ </span>
        <span fg={tab === "activity" ? "#fff" : "#555"}>[1] Activity</span>
        <span fg="#444"> </span>
        <span fg={tab === "diff" ? "#fff" : "#555"}>[2] Diff</span>
        <span fg="#444"> </span>
        <span fg={tab === "code" ? "#fff" : "#555"}>[3] Code</span>
      </text>
      <text fg="#666">
        <span fg="#22c55e">{state.completed}</span>
        <span fg="#444">✓ </span>
        <span fg="#ef4444">{state.failed}</span>
        <span fg="#444">✗ </span>
        <span fg="#888">{elapsed}m</span>
        <span fg="#444"> · </span>
        <span fg="#f97316">${state.totalCost.toFixed(2)}</span>
      </text>
    </box>
  );
}

// --- Slice List (left panel) ---

function SliceList({ state, scrollOffset, maxVisible }: { state: TuiState; scrollOffset: number; maxVisible: number }) {
  const visible = state.slices.slice(scrollOffset, scrollOffset + maxVisible);
  const hasMore = state.slices.length > scrollOffset + maxVisible;
  const hasLess = scrollOffset > 0;

  return (
    <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1} flexGrow={1}>
      {hasLess && <text fg="#555">  ↑ {scrollOffset} more</text>}
      {visible.map((slice, i) => (
        <SliceRow
          key={slice.id}
          slice={slice}
          active={scrollOffset + i === state.currentSliceIndex && state.mode === "running"}
        />
      ))}
      {hasMore && <text fg="#555">  ↓ {state.slices.length - scrollOffset - maxVisible} more</text>}
    </box>
  );
}

function SliceRow({ slice, active }: { slice: SliceInfo; active: boolean }) {
  const icon = slice.status === "done" ? "✓"
    : slice.status === "failed" ? "✗"
    : slice.status === "no_changes" ? "○"
    : slice.status === "running" ? "▸"
    : "·";

  const iconColor = slice.status === "done" ? "#22c55e"
    : slice.status === "failed" ? "#ef4444"
    : slice.status === "running" ? "#f97316"
    : "#333";

  const textColor = active ? "#fff"
    : slice.status === "done" ? "#555"
    : slice.status === "failed" ? "#666"
    : "#999";

  return (
    <box flexDirection="row" backgroundColor={active ? "#1a1a2e" : undefined}>
      <text fg={iconColor} width={2}>{icon}</text>
      <text fg="#666" width={8}>{slice.criterionId}</text>
      <text fg={textColor}>{slice.title.slice(0, 50)}</text>
    </box>
  );
}

// --- Activity Tab ---

function ActivityTab({ events, maxVisible }: { events: ToolEvent[]; maxVisible: number }) {
  const visible = events.slice(-maxVisible);

  return (
    <box flexDirection="column" paddingX={1}>
      {visible.map((event, i) => (
        <EventRow key={i} event={event} />
      ))}
      {visible.length === 0 && <text fg="#555">Waiting for activity...</text>}
    </box>
  );
}

function EventRow({ event }: { event: ToolEvent }) {
  if (event.type === "tool_use") {
    const nameColor = event.name === "Write" || event.name === "Edit" ? "#f97316"
      : event.name === "Bash" ? "#a855f7"
      : event.name === "Read" || event.name === "Glob" || event.name === "Grep" ? "#3b82f6"
      : "#eab308";
    return (
      <box flexDirection="row">
        <text fg={nameColor} width={10}><strong>{event.name ?? "tool"}</strong></text>
        <text fg="#777">{event.detail?.slice(0, 90) ?? ""}</text>
      </box>
    );
  }

  if (event.type === "tool_result") {
    const icon = event.isError ? "  ✗ error" : "  ✓";
    const color = event.isError ? "#ef4444" : "#333";
    return <text fg={color}>{icon}</text>;
  }

  if (event.type === "text") {
    return <text fg="#a3a3a3">  {event.detail?.slice(0, 90) ?? ""}</text>;
  }

  if (event.type === "done") {
    const cost = event.cost ? ` $${event.cost.toFixed(4)}` : "";
    const dur = event.durationSec ? ` ${event.durationSec.toFixed(1)}s` : "";
    return <text fg="#22c55e">  ✓ done{cost}{dur}</text>;
  }

  if (event.type === "commit") {
    return (
      <box flexDirection="row">
        <text fg="#22c55e"><strong>  commit </strong></text>
        <text fg="#888">{event.detail ?? ""}</text>
      </box>
    );
  }

  if (event.type === "slice_start") {
    return (
      <box marginTop={1}>
        <text fg="#f97316">━━ {event.detail} ━━</text>
      </box>
    );
  }

  if (event.type === "slice_end") {
    const color = event.isError ? "#ef4444" : "#22c55e";
    return <text fg={color}>━━ {event.detail} ━━</text>;
  }

  return null;
}

// --- Diff Tab ---

function DiffTab({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return (
      <box paddingX={1}>
        <text fg="#555">No diff yet — changes will appear here after the work step.</text>
      </box>
    );
  }

  return (
    <scrollbox focused flexGrow={1}>
      <diff
        diff={diff}
        view="unified"
        filetype="typescript"
        showLineNumbers
        addedBg="#0d2818"
        removedBg="#2d0f0f"
        addedSignColor="#22c55e"
        removedSignColor="#ef4444"
        lineNumberFg="#555"
        fg="#d4d4d4"
      />
    </scrollbox>
  );
}

// --- Code Tab (recent file changes) ---

function CodeTab({ events }: { events: ToolEvent[] }) {
  // Show a summary of files touched
  const writes = events.filter((e) => e.type === "tool_use" && (e.name === "Write" || e.name === "Edit"));
  const reads = events.filter((e) => e.type === "tool_use" && (e.name === "Read" || e.name === "Glob" || e.name === "Grep"));
  const commands = events.filter((e) => e.type === "tool_use" && e.name === "Bash");

  return (
    <box flexDirection="column" paddingX={1} gap={1}>
      <box flexDirection="column">
        <text fg="#f97316" marginBottom={1}><strong>Files Modified ({writes.length})</strong></text>
        {writes.length === 0 && <text fg="#555">  None yet</text>}
        {writes.map((e, i) => (
          <box key={i} flexDirection="row">
            <text fg={e.name === "Write" ? "#22c55e" : "#eab308"} width={8}>  {e.name}</text>
            <text fg="#999">{e.detail?.slice(0, 80)}</text>
          </box>
        ))}
      </box>

      <box flexDirection="column">
        <text fg="#3b82f6" marginBottom={1}><strong>Files Read ({reads.length})</strong></text>
        {reads.slice(-10).map((e, i) => (
          <box key={i} flexDirection="row">
            <text fg="#555" width={8}>  {e.name}</text>
            <text fg="#666">{e.detail?.slice(0, 80)}</text>
          </box>
        ))}
      </box>

      {commands.length > 0 && (
        <box flexDirection="column">
          <text fg="#a855f7" marginBottom={1}><strong>Commands ({commands.length})</strong></text>
          {commands.slice(-5).map((e, i) => (
            <text key={i} fg="#777">  $ {e.detail?.slice(0, 80)}</text>
          ))}
        </box>
      )}
    </box>
  );
}

// --- Footer ---

function Footer({ tab, paused }: { tab: Tab; paused: boolean }) {
  return (
    <box paddingX={1} flexDirection="row" justifyContent="space-between">
      <text fg="#555">
        <span fg="#888">1</span> activity  <span fg="#888">2</span> diff  <span fg="#888">3</span> code
        <span fg="#444"> │ </span>
        <span fg="#888">↑↓</span> scroll
        <span fg="#444"> │ </span>
        <span fg="#888">p</span> {paused ? "resume" : "pause"}
        <span fg="#444"> │ </span>
        <span fg="#888">s</span> skip
        <span fg="#444"> │ </span>
        <span fg="#888">q</span> quit
      </text>
    </box>
  );
}

// --- Main App ---

function App({ initialState, onExit, onPause, onSkip }: {
  initialState: TuiState;
  onExit: () => void;
  onPause: () => void;
  onSkip: () => void;
}) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<Tab>("activity");
  const [paused, setPaused] = useState(false);
  const [sliceScroll, setSliceScroll] = useState(0);
  const [diffScroll, setDiffScroll] = useState(0);
  const { width, height } = useTerminalDimensions();

  // Expose setState globally so the runner can push updates
  (globalThis as any).__emberTuiUpdate = setState;

  const maxSliceVisible = Math.max(5, height - 6);
  const maxRightPanelLines = Math.max(5, height - 6);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onExit();
    if (key.ctrl && key.name === "c") onExit();

    // Tabs
    if (key.name === "1") { setTab("activity"); setDiffScroll(0); }
    if (key.name === "2") { setTab("diff"); setDiffScroll(0); }
    if (key.name === "3") setTab("code");

    // Scroll
    if (key.name === "up") {
      if (tab === "diff") setDiffScroll((s) => Math.max(0, s - 1));
      else setSliceScroll((s) => Math.max(0, s - 1));
    }
    if (key.name === "down") {
      if (tab === "diff") setDiffScroll((s) => s + 1);
      else setSliceScroll((s) => Math.min(state.slices.length - 1, s + 1));
    }
    if (key.name === "pageup") {
      if (tab === "diff") setDiffScroll((s) => Math.max(0, s - 20));
      else setSliceScroll((s) => Math.max(0, s - 10));
    }
    if (key.name === "pagedown") {
      if (tab === "diff") setDiffScroll((s) => s + 20);
      else setSliceScroll((s) => Math.min(state.slices.length - 1, s + 10));
    }

    // Controls
    if (key.name === "p") {
      setPaused((p) => !p);
      onPause();
    }
    if (key.name === "s") onSkip();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      <Header state={state} tab={tab} paused={paused} />

      <box flexDirection="row" flexGrow={1}>
        <box width="35%" flexDirection="column">
          <SliceList state={state} scrollOffset={sliceScroll} maxVisible={maxSliceVisible} />
        </box>

        <box width="65%" flexDirection="column" border borderStyle="single" borderColor="#333">
          <box paddingX={1}>
            <text fg="#888">
              {tab === "activity" ? "Activity" : tab === "diff" ? "Diff" : "Files"}
              {tab === "diff" && state.diff ? ` (${state.diff.split("\n").length} lines)` : ""}
            </text>
          </box>

          <box flexGrow={1} flexDirection="column">
            {tab === "activity" && <ActivityTab events={state.events} maxVisible={maxRightPanelLines} />}
            {tab === "diff" && <DiffTab diff={state.diff} />}
            {tab === "code" && <CodeTab events={state.events} />}
          </box>
        </box>
      </box>

      <Footer tab={tab} paused={paused} />
    </box>
  );
}

// --- Clean exit ---

function cleanExit(renderer: Awaited<ReturnType<typeof createCliRenderer>>) {
  renderer.destroy();
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1003l\x1b[?2004l\x1b[0m");
  process.exit(0);
}

// --- Entry point ---

export async function startTui(initialState: TuiState): Promise<TuiUpdater> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  const exit = () => cleanExit(renderer);
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);

  // Placeholder callbacks — will be wired when integrating with real loop
  const onPause = () => {};
  const onSkip = () => {};

  createRoot(renderer).render(
    <App
      initialState={initialState}
      onExit={exit}
      onPause={onPause}
      onSkip={onSkip}
    />
  );

  // Return the updater function so the runner can push state changes
  const update: TuiUpdater = (fn) => {
    const tuiUpdate = (globalThis as any).__emberTuiUpdate;
    if (tuiUpdate) tuiUpdate(fn);
  };

  return update;
}

// --- Demo with simulated activity ---

async function demo() {
  const mockSlices: SliceInfo[] = [
    { id: "001:ac-001", kind: "direct", title: "Upgrade to Vite 8", criterionId: "AC-001", status: "done" },
    { id: "001:ac-002", kind: "direct", title: "Install TanStack Router", criterionId: "AC-002", status: "done" },
    { id: "001:ac-003", kind: "direct", title: "Migrate existing pages to TanStack Router", criterionId: "AC-003", status: "running" },
    { id: "001:ac-004", kind: "direct", title: "Install TanStack Query", criterionId: "AC-004", status: "pending" },
    { id: "001:ac-005", kind: "direct", title: "Replace useFetch with useQuery hooks", criterionId: "AC-005", status: "pending" },
    { id: "001:ac-006", kind: "direct", title: "Install and configure oxlint", criterionId: "AC-006", status: "pending" },
    { id: "001:ac-007", kind: "direct", title: "Configure oxfmt for formatting", criterionId: "AC-007", status: "pending" },
    { id: "001:ac-008", kind: "direct", title: "Remove react-router-dom", criterionId: "AC-008", status: "pending" },
    { id: "001:ac-009", kind: "direct", title: "Add @base-ui/react", criterionId: "AC-009", status: "pending" },
    { id: "001:ac-010", kind: "direct", title: "New Hono route for pipeline", criterionId: "AC-010", status: "pending" },
    { id: "001:ac-011", kind: "direct", title: "GET /api/pipeline/today endpoint", criterionId: "AC-011", status: "pending" },
    { id: "001:ac-012", kind: "direct", title: "GET /api/pipeline/date/:date endpoint", criterionId: "AC-012", status: "pending" },
    { id: "001:ac-016", kind: "direct", title: "Pipeline page route at /pipeline", criterionId: "AC-016", status: "pending" },
  ];

  const mockDiff = `diff --git a/packages/dashboard/src/client/routes/overview.tsx b/packages/dashboard/src/client/routes/overview.tsx
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/packages/dashboard/src/client/routes/overview.tsx
@@ -0,0 +1,45 @@
+import { createFileRoute } from '@tanstack/react-router'
+import { useQuery } from '@tanstack/react-query'
+
+export const Route = createFileRoute('/overview')({
+  component: OverviewPage,
+})
+
+function OverviewPage() {
+  const { data, isLoading } = useQuery({
+    queryKey: ['overview'],
+    queryFn: () => fetch('/api/overview').then(r => r.json()),
+    staleTime: 30_000,
+  })
+
+  if (isLoading) return <div>Loading...</div>
+
+  return (
+    <div className="p-6">
+      <h1 className="text-2xl font-bold text-gray-100">Overview</h1>
+      {/* ... */}
+    </div>
+  )
+}
diff --git a/packages/dashboard/src/client/App.tsx b/packages/dashboard/src/client/App.tsx
index abc1234..def5678 100644
--- a/packages/dashboard/src/client/App.tsx
+++ b/packages/dashboard/src/client/App.tsx
@@ -1,8 +1,6 @@
-import { BrowserRouter, Routes, Route } from 'react-router-dom'
-import Overview from './pages/Overview'
+import { RouterProvider, createRouter } from '@tanstack/react-router'
+import { routeTree } from './routeTree.gen'

-export default function App() {
-  return (
-    <BrowserRouter>
-      <Routes>
-        <Route path="/" element={<Overview />} />
-      </Routes>
-    </BrowserRouter>
-  )
+const router = createRouter({ routeTree })
+
+export default function App() {
+  return <RouterProvider router={router} />
 }`;

  const initialState: TuiState = {
    mode: "running",
    currentSliceIndex: 2,
    slices: mockSlices,
    events: [
      { type: "slice_start", detail: "AC-003 — Migrate existing pages to TanStack Router" },
      { type: "tool_use", name: "Read", detail: "packages/dashboard/src/client/App.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Read", detail: "packages/dashboard/src/client/pages/Overview.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Glob", detail: "src/client/pages/*.tsx" },
      { type: "tool_result", isError: false },
      { type: "text", detail: "Migrating Overview page to TanStack Router route file..." },
      { type: "tool_use", name: "Write", detail: "src/client/routes/overview.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Edit", detail: "src/client/App.tsx — replace BrowserRouter with RouterProvider" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Bash", detail: "cd packages/dashboard && bun run typecheck 2>&1" },
      { type: "tool_result", isError: false },
      { type: "text", detail: "Typecheck passes. Migrating Markets page next..." },
      { type: "tool_use", name: "Read", detail: "packages/dashboard/src/client/pages/Markets.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Write", detail: "src/client/routes/markets.tsx" },
      { type: "tool_result", isError: false },
    ],
    diff: mockDiff,
    completed: 2,
    failed: 0,
    totalCost: 0.0847,
    startTimeMs: Date.now() - 180_000,
  };

  const update = await startTui(initialState);

  // Simulate live activity every 2s
  let eventIndex = 0;
  const simulatedEvents: ToolEvent[] = [
    { type: "tool_use", name: "Write", detail: "src/client/routes/trades.tsx" },
    { type: "tool_result", isError: false },
    { type: "tool_use", name: "Write", detail: "src/client/routes/models.tsx" },
    { type: "tool_result", isError: false },
    { type: "tool_use", name: "Bash", detail: "cd packages/dashboard && bun run typecheck 2>&1" },
    { type: "tool_result", isError: false },
    { type: "tool_use", name: "Bash", detail: "cd packages/dashboard && bun run build 2>&1" },
    { type: "tool_result", isError: false },
    { type: "commit", detail: "[ember:001:ac-003] Migrate all pages to TanStack Router" },
    { type: "done", cost: 0.0423, durationSec: 67.3 },
    { type: "slice_end", detail: "AC-003 done ✓" },
  ];

  setInterval(() => {
    if (eventIndex < simulatedEvents.length) {
      const event = simulatedEvents[eventIndex++];
      update((prev) => ({
        ...prev,
        events: [...prev.events, event],
      }));

      // When we hit slice_end, advance to next slice
      if (event.type === "slice_end") {
        update((prev) => {
          const slices = [...prev.slices];
          slices[2] = { ...slices[2], status: "done" };
          slices[3] = { ...slices[3], status: "running" };
          return {
            ...prev,
            slices,
            currentSliceIndex: 3,
            completed: prev.completed + 1,
            totalCost: prev.totalCost + 0.0423,
          };
        });
      }
    }
  }, 1500);
}

// Run demo if executed directly
demo();
