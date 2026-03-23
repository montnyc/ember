import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import type { AppState, ToolEvent } from "./types";

type Tab = "activity" | "diff" | "code";

export function RunScreen({ state, onExit, onPause, onSkip, onHome }: {
  state: AppState;
  onExit: () => void;
  onPause: () => void;
  onSkip: () => void;
  onHome: () => void;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const [sliceScroll, setSliceScroll] = useState(0);
  const { height } = useTerminalDimensions();
  const [elapsedDisplay, setElapsedDisplay] = useState("0.0");

  // Live elapsed timer
  useEffect(() => {
    if (state.mode !== "running" || !state.startTimeMs) return;
    const interval = setInterval(() => {
      setElapsedDisplay(((Date.now() - state.startTimeMs) / 1000 / 60).toFixed(1));
    }, 1000);
    return () => clearInterval(interval);
  }, [state.mode, state.startTimeMs]);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      if (state.mode === "finished") onHome();
      else onExit();
    }
    if (key.ctrl && key.name === "c") onExit();

    if (key.name === "1") setTab("activity");
    if (key.name === "2") setTab("diff");
    if (key.name === "3") setTab("code");

    if (key.name === "up") setSliceScroll((s) => Math.max(0, s - 1));
    if (key.name === "down") setSliceScroll((s) => Math.min(state.slices.length - 1, s + 1));
    if (key.name === "pageup") setSliceScroll((s) => Math.max(0, s - 10));
    if (key.name === "pagedown") setSliceScroll((s) => Math.min(state.slices.length - 1, s + 10));

    if (key.name === "p") onPause();
    if (key.name === "s") onSkip();
    if (key.name === "h" && state.mode === "finished") onHome();
  });

  const maxVisible = Math.max(5, height - 6);
  const paused = state.mode === "paused";
  const modeLabel = paused ? "paused" : state.mode === "running" ? "running" : state.mode;
  const modeColor = paused ? "#eab308" : state.mode === "running" ? "#22c55e" : state.mode === "finished" ? "#3b82f6" : "#666";

  // Progress
  const total = state.slices.length;
  const done = state.completed + state.failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barWidth = 20;
  const filled = Math.round((pct / 100) * barWidth);
  const progressBar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      {/* Header */}
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
        <text>
          <span fg="#22c55e">{state.completed}</span>
          <span fg="#444">✓ </span>
          <span fg="#ef4444">{state.failed}</span>
          <span fg="#444">✗ </span>
          <span fg="#888">{elapsedDisplay}m</span>
          <span fg="#444"> · </span>
          <span fg="#f97316">${state.totalCost.toFixed(2)}</span>
        </text>
      </box>

      {/* Progress bar */}
      <box paddingX={1}>
        <text fg="#555">{progressBar} {pct}% ({done}/{total})</text>
      </box>

      {/* Main content */}
      <box flexDirection="row" flexGrow={1}>
        {/* Slice list */}
        <box width="35%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <SliceList state={state} scrollOffset={sliceScroll} maxVisible={maxVisible} />
        </box>

        {/* Right panel */}
        <box width="65%" flexDirection="column" border borderStyle="single" borderColor="#333">
          <box paddingX={1}>
            <text fg="#888">
              {tab === "activity" ? "Activity" : tab === "diff" ? "Diff" : "Files"}
              {tab === "diff" && state.diff ? ` (${state.diff.split("\n").length} lines)` : ""}
            </text>
          </box>
          <box flexGrow={1} flexDirection="column">
            {tab === "activity" && <ActivityTab events={state.events} maxVisible={maxVisible} />}
            {tab === "diff" && <DiffTab diff={state.diff} />}
            {tab === "code" && <CodeTab events={state.events} />}
          </box>
        </box>
      </box>

      {/* Footer */}
      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">1</span> activity  <span fg="#888">2</span> diff  <span fg="#888">3</span> code
          <span fg="#444"> │ </span>
          <span fg="#888">↑↓</span> scroll
          {state.mode === "running" && <>
            <span fg="#444"> │ </span>
            <span fg="#888">p</span> pause
            <span fg="#444"> │ </span>
            <span fg="#888">s</span> skip
          </>}
          {state.mode === "paused" && <>
            <span fg="#444"> │ </span>
            <span fg="#888">p</span> resume
          </>}
          {state.mode === "finished" && <>
            <span fg="#444"> │ </span>
            <span fg="#888">h</span> home
          </>}
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> quit
        </text>
      </box>
    </box>
  );
}

// --- Slice List ---

function SliceList({ state, scrollOffset, maxVisible }: { state: AppState; scrollOffset: number; maxVisible: number }) {
  const visible = state.slices.slice(scrollOffset, scrollOffset + maxVisible);
  const hasMore = state.slices.length > scrollOffset + maxVisible;
  const hasLess = scrollOffset > 0;

  return (
    <>
      {hasLess && <text fg="#555">  ↑ {scrollOffset} more</text>}
      {visible.map((slice, i) => {
        const idx = scrollOffset + i;
        const active = idx === state.currentSliceIndex && state.mode === "running";
        const icon = slice.status === "done" ? "✓"
          : slice.status === "failed" ? "✗"
          : slice.status === "no_changes" ? "○"
          : slice.status === "running" ? "▸"
          : "·";
        const iconColor = slice.status === "done" ? "#22c55e"
          : slice.status === "failed" ? "#ef4444"
          : slice.status === "running" ? "#f97316"
          : "#333";
        const textColor = active ? "#fff" : slice.status === "done" ? "#555" : "#999";

        return (
          <box key={slice.id} flexDirection="row" backgroundColor={active ? "#1a1a2e" : undefined}>
            <text fg={iconColor} width={2}>{icon}</text>
            <text fg="#666" width={8}>{slice.criterionId}</text>
            <text fg={textColor}>{slice.title.slice(0, 45)}</text>
          </box>
        );
      })}
      {hasMore && <text fg="#555">  ↓ {state.slices.length - scrollOffset - maxVisible} more</text>}
    </>
  );
}

// --- Activity Tab ---

function ActivityTab({ events, maxVisible }: { events: ToolEvent[]; maxVisible: number }) {
  const visible = events.slice(-maxVisible);

  return (
    <scrollbox focused flexGrow={1} paddingX={1}>
      {visible.length === 0 && <text fg="#555">Waiting for activity...</text>}
      {visible.map((event, i) => (
        <EventRow key={i} event={event} />
      ))}
    </scrollbox>
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

  if (event.type === "text") return <text fg="#a3a3a3">  {event.detail?.slice(0, 90)}</text>;

  if (event.type === "done") {
    const cost = event.cost ? ` $${event.cost.toFixed(4)}` : "";
    const dur = event.durationSec ? ` ${event.durationSec.toFixed(1)}s` : "";
    return <text fg="#22c55e">  ✓ done{cost}{dur}</text>;
  }

  if (event.type === "commit") {
    return (
      <box flexDirection="row">
        <text fg="#22c55e"><strong>  commit </strong></text>
        <text fg="#888">{event.detail}</text>
      </box>
    );
  }

  if (event.type === "slice_start") {
    return <text fg="#f97316" marginTop={1}>━━ {event.detail} ━━</text>;
  }

  if (event.type === "slice_end") {
    return <text fg={event.isError ? "#ef4444" : "#22c55e"}>━━ {event.detail} ━━</text>;
  }

  if (event.type === "error") {
    return <text fg="#ef4444">  ✗ {event.detail}</text>;
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

// --- Code Tab ---

function CodeTab({ events }: { events: ToolEvent[] }) {
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
