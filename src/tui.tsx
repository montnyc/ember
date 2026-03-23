import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect, useRef } from "react";

// --- Types ---

interface SliceInfo {
  id: string;
  kind: string;
  title: string;
  criterionId: string;
  status: "pending" | "running" | "done" | "failed" | "no_changes";
}

interface ToolEvent {
  type: "tool_use" | "tool_result" | "text" | "done";
  name?: string;
  detail?: string;
  isError?: boolean;
  cost?: number;
  durationSec?: number;
}

interface RunState {
  mode: "idle" | "running" | "finished";
  currentSliceIndex: number;
  slices: SliceInfo[];
  events: ToolEvent[];
  completed: number;
  failed: number;
  totalCost: number;
  startTimeMs: number;
}

// --- Components ---

function Header({ state }: { state: RunState }) {
  const elapsed = state.startTimeMs
    ? ((Date.now() - state.startTimeMs) / 1000 / 60).toFixed(1)
    : "0.0";

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      padding={1}
      paddingY={0}
      border
      borderStyle="single"
      borderColor="#444"
    >
      <text>
        <span fg="#f97316"><strong>ember</strong></span>
        <span fg="#666"> {state.mode === "running" ? "afk" : state.mode}</span>
      </text>
      <text fg="#666">
        {state.completed} done · {state.failed} failed · {elapsed}m · ${state.totalCost.toFixed(2)}
      </text>
    </box>
  );
}

function SliceList({ state }: { state: RunState }) {
  return (
    <box flexDirection="column" border borderStyle="single" borderColor="#333" padding={1} paddingY={0}>
      <text fg="#888" marginBottom={1}>Slices</text>
      {state.slices.map((slice, i) => (
        <SliceRow key={slice.id} slice={slice} active={i === state.currentSliceIndex && state.mode === "running"} />
      ))}
    </box>
  );
}

function SliceRow({ slice, active }: { slice: SliceInfo; active: boolean }) {
  const icon = slice.status === "done" ? "✓"
    : slice.status === "failed" ? "✗"
    : slice.status === "no_changes" ? "○"
    : slice.status === "running" ? "▸"
    : " ";

  const iconColor = slice.status === "done" ? "#22c55e"
    : slice.status === "failed" ? "#ef4444"
    : slice.status === "running" ? "#f97316"
    : "#555";

  const textColor = active ? "#fff" : slice.status === "done" ? "#666" : "#999";

  return (
    <box flexDirection="row" backgroundColor={active ? "#1a1a2e" : undefined}>
      <text fg={iconColor} width={3}>{icon} </text>
      <text fg="#888" width={10}>{slice.criterionId} </text>
      <text fg={textColor}>{slice.title.slice(0, 60)}</text>
    </box>
  );
}

function ActivityLog({ events }: { events: ToolEvent[] }) {
  const visible = events.slice(-15);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="single"
      borderColor="#333"
      padding={1}
      paddingY={0}
      flexGrow={1}
    >
      <text fg="#888" marginBottom={1}>Activity</text>
      {visible.map((event, i) => (
        <EventRow key={i} event={event} />
      ))}
    </box>
  );
}

function EventRow({ event }: { event: ToolEvent }) {
  if (event.type === "tool_use") {
    return (
      <box flexDirection="row">
        <text fg="#eab308" width={12}>{event.name ?? "tool"} </text>
        <text fg="#666">{event.detail?.slice(0, 80) ?? ""}</text>
      </box>
    );
  }

  if (event.type === "tool_result") {
    const icon = event.isError ? "✗" : "✓";
    const color = event.isError ? "#ef4444" : "#22c55e";
    return <text fg={color}>{icon}</text>;
  }

  if (event.type === "text") {
    return <text fg="#a3a3a3">{event.detail?.slice(0, 80) ?? ""}</text>;
  }

  if (event.type === "done") {
    const cost = event.cost ? ` $${event.cost.toFixed(4)}` : "";
    const dur = event.durationSec ? ` ${event.durationSec.toFixed(1)}s` : "";
    return <text fg="#22c55e">done{cost}{dur}</text>;
  }

  return null;
}

function Footer() {
  return (
    <box padding={1} paddingY={0}>
      <text fg="#555">q quit · ctrl+c stop after current</text>
    </box>
  );
}

function App({ initialState, onExit }: { initialState: RunState; onExit: () => void }) {
  const [state, setState] = useState(initialState);
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      onExit();
    }
    if (key.ctrl && key.name === "c") {
      onExit();
    }
  });

  // Max slices to show based on terminal height
  const maxSlices = Math.max(5, Math.floor(height * 0.4));

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#0a0a0a"
    >
      <Header state={state} />
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box width="40%" flexDirection="column">
          <SliceList state={state} />
        </box>
        <box width="60%" flexDirection="column">
          <ActivityLog events={state.events} />
        </box>
      </box>
      <Footer />
    </box>
  );
}

// --- Demo ---

function cleanExit(renderer: Awaited<ReturnType<typeof createCliRenderer>>) {
  renderer.destroy();
  // Force-reset terminal state in case OpenTUI misses anything
  process.stdout.write("\x1b[?1049l"); // exit alternate screen
  process.stdout.write("\x1b[?25h");   // show cursor
  process.stdout.write("\x1b[?1000l"); // disable mouse tracking
  process.stdout.write("\x1b[?1003l"); // disable all mouse tracking
  process.stdout.write("\x1b[?2004l"); // disable bracketed paste
  process.stdout.write("\x1b[0m");     // reset colors
  process.exit(0);
}

async function demo() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  const mockState: RunState = {
    mode: "running",
    currentSliceIndex: 2,
    slices: [
      { id: "001:ac-001", kind: "direct", title: "Upgrade to Vite 8", criterionId: "AC-001", status: "done" },
      { id: "001:ac-002", kind: "direct", title: "Install TanStack Router", criterionId: "AC-002", status: "done" },
      { id: "001:ac-003", kind: "direct", title: "Migrate existing pages to TanStack Router", criterionId: "AC-003", status: "running" },
      { id: "001:ac-004", kind: "direct", title: "Install TanStack Query", criterionId: "AC-004", status: "pending" },
      { id: "001:ac-005", kind: "direct", title: "Replace useFetch with useQuery hooks", criterionId: "AC-005", status: "pending" },
      { id: "001:ac-006", kind: "direct", title: "Install and configure oxlint", criterionId: "AC-006", status: "pending" },
      { id: "001:ac-010", kind: "direct", title: "New Hono route for pipeline", criterionId: "AC-010", status: "pending" },
      { id: "001:ac-016", kind: "direct", title: "Pipeline page route at /pipeline", criterionId: "AC-016", status: "pending" },
    ],
    events: [
      { type: "tool_use", name: "Read", detail: "packages/dashboard/src/client/App.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Read", detail: "packages/dashboard/src/client/pages/Overview.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Glob", detail: "src/client/pages/*.tsx" },
      { type: "tool_result", isError: false },
      { type: "text", detail: "Migrating Overview page to TanStack Router route file..." },
      { type: "tool_use", name: "Write", detail: "src/client/routes/overview.tsx" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Edit", detail: "src/client/App.tsx — remove old route import" },
      { type: "tool_result", isError: false },
      { type: "tool_use", name: "Bash", detail: "bun run typecheck 2>&1" },
      { type: "tool_result", isError: false },
    ],
    completed: 2,
    failed: 0,
    totalCost: 0.0847,
    startTimeMs: Date.now() - 180_000,
  };

  const exit = () => cleanExit(renderer);
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);

  createRoot(renderer).render(<App initialState={mockState} onExit={exit} />);
}

demo();
