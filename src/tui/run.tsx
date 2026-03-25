import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect } from "react";
import type { AppState, ToolEvent } from "./types";
import { MessageBlock } from "./messages";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./palette";
import type { PaletteAction } from "./palette";

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
  const [showPalette, setShowPalette] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const { height } = useTerminalDimensions();
  const [elapsedDisplay, setElapsedDisplay] = useState("0.0");

  useEffect(() => {
    if (state.mode !== "running" || !state.startTimeMs) return;
    const interval = setInterval(() => {
      setElapsedDisplay(((Date.now() - state.startTimeMs) / 1000 / 60).toFixed(1));
    }, 1000);
    return () => clearInterval(interval);
  }, [state.mode, state.startTimeMs]);

  const paletteActions: PaletteAction[] = [
    { id: "tab-activity", title: "Show Activity", shortcut: "1", action: () => setTab("activity") },
    { id: "tab-diff", title: "Show Diff", shortcut: "2", action: () => setTab("diff") },
    { id: "tab-code", title: "Show Files", shortcut: "3", action: () => setTab("code") },
    { id: "toggle-sidebar", title: "Toggle Sidebar", shortcut: "b", action: () => setShowSidebar((s) => !s) },
    { id: "pause", title: state.mode === "paused" ? "Resume" : "Pause", shortcut: "p", action: onPause },
    { id: "skip", title: "Skip Current Slice", shortcut: "s", action: onSkip },
    { id: "home", title: "Go Home", shortcut: "h", action: onHome },
    { id: "quit", title: "Quit", shortcut: "q", action: onExit },
  ];

  useKeyboard((key) => {
    if (showPalette) return; // palette handles its own keys

    if (key.ctrl && key.name === "p") { setShowPalette(true); return; }
    if (key.name === "q" || key.name === "escape") {
      if (state.mode === "finished") onHome();
      else onExit();
    }
    if (key.ctrl && key.name === "c") onExit();

    if (key.name === "1") setTab("activity");
    if (key.name === "2") setTab("diff");
    if (key.name === "3") setTab("code");
    if (key.name === "b") setShowSidebar((s) => !s);

    if (key.name === "up") setSliceScroll((s) => Math.max(0, s - 1));
    if (key.name === "down") setSliceScroll((s) => Math.min(state.slices.length - 1, s + 1));

    if (key.name === "p") onPause();
    if (key.name === "s") onSkip();
    if (key.name === "h" && state.mode === "finished") onHome();
  });

  const maxVisible = Math.max(5, height - 6);
  const paused = state.mode === "paused";
  const modeLabel = paused ? "paused" : state.mode === "running" ? "running" : state.mode;
  const modeColor = paused ? "#eab308" : state.mode === "running" ? "#22c55e" : state.mode === "finished" ? "#3b82f6" : "#666";

  const total = state.slices.length;
  const done = state.completed + state.failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barWidth = 20;
  const filled = Math.round((pct / 100) * barWidth);
  const progressBar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      {/* Command palette overlay */}
      {showPalette && (
        <box position="absolute" top={2} left={10} zIndex={100}>
          <CommandPalette actions={paletteActions} onClose={() => setShowPalette(false)} />
        </box>
      )}

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
        <box width="30%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <SliceList state={state} scrollOffset={sliceScroll} maxVisible={maxVisible} />
        </box>

        {/* Center: Activity/Diff/Code */}
        <box flexGrow={1} flexDirection="column" border borderStyle="single" borderColor="#333">
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

        {/* Right sidebar */}
        {showSidebar && <Sidebar state={state} />}
      </box>

      {/* Footer */}
      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">ctrl+p</span> commands
          <span fg="#444"> │ </span>
          <span fg="#888">1-3</span> tabs
          <span fg="#444"> │ </span>
          <span fg="#888">b</span> sidebar
          <span fg="#444"> │ </span>
          <span fg="#888">↑↓</span> scroll
          {state.mode === "running" && <>
            <span fg="#444"> │ </span>
            <span fg="#888">p</span> pause
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

// --- Sub-components ---

function SliceList({ state, scrollOffset, maxVisible }: { state: AppState; scrollOffset: number; maxVisible: number }) {
  const visible = state.slices.slice(scrollOffset, scrollOffset + maxVisible);
  const hasMore = state.slices.length > scrollOffset + maxVisible;
  const hasLess = scrollOffset > 0;

  return (
    <>
      {hasLess && <text fg="#555"> ↑ {scrollOffset} more</text>}
      {visible.map((slice, i) => {
        const idx = scrollOffset + i;
        const active = idx === state.currentSliceIndex && state.mode === "running";
        const icon = slice.status === "done" ? "✓" : slice.status === "failed" ? "✗" : slice.status === "running" ? "▸" : slice.status === "no_changes" ? "○" : "·";
        const iconColor = slice.status === "done" ? "#22c55e" : slice.status === "failed" ? "#ef4444" : slice.status === "running" ? "#f97316" : "#333";
        const textColor = active ? "#fff" : slice.status === "done" ? "#555" : "#999";

        return (
          <box key={slice.id} flexDirection="row" backgroundColor={active ? "#1a1a2e" : undefined}>
            <text fg={iconColor} width={2}>{icon}</text>
            <text fg="#666" width={8}>{slice.criterionId}</text>
            <text fg={textColor}>{slice.title.slice(0, 35)}</text>
          </box>
        );
      })}
      {hasMore && <text fg="#555"> ↓ {state.slices.length - scrollOffset - maxVisible} more</text>}
    </>
  );
}

function ActivityTab({ events, maxVisible }: { events: ToolEvent[]; maxVisible: number }) {
  const visible = events.slice(-maxVisible);

  return (
    <scrollbox focused flexGrow={1} paddingX={1}>
      {visible.length === 0 && <text fg="#555">Waiting for activity...</text>}
      {visible.map((event, i) => (
        <MessageBlock key={i} event={event} />
      ))}
    </scrollbox>
  );
}

function DiffTab({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return (
      <box paddingX={1}>
        <text fg="#555">No diff yet — changes appear after the work step.</text>
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

function CodeTab({ events }: { events: ToolEvent[] }) {
  const writes = events.filter((e) => e.type === "tool_use" && (e.name === "Write" || e.name === "Edit"));
  const reads = events.filter((e) => e.type === "tool_use" && (e.name === "Read" || e.name === "Glob" || e.name === "Grep"));
  const commands = events.filter((e) => e.type === "tool_use" && e.name === "Bash");

  return (
    <box flexDirection="column" paddingX={1} gap={1}>
      <box flexDirection="column">
        <text fg="#f97316" marginBottom={1}><strong>Modified ({writes.length})</strong></text>
        {writes.length === 0 && <text fg="#555">  None yet</text>}
        {writes.map((e, i) => (
          <box key={i} flexDirection="row">
            <text fg={e.name === "Write" ? "#22c55e" : "#eab308"} width={8}>  {e.name}</text>
            <text fg="#999">{e.detail?.slice(0, 70)}</text>
          </box>
        ))}
      </box>

      <box flexDirection="column">
        <text fg="#3b82f6" marginBottom={1}><strong>Read ({reads.length})</strong></text>
        {reads.slice(-8).map((e, i) => (
          <box key={i} flexDirection="row">
            <text fg="#555" width={8}>  {e.name}</text>
            <text fg="#666">{e.detail?.slice(0, 70)}</text>
          </box>
        ))}
      </box>

      {commands.length > 0 && (
        <box flexDirection="column">
          <text fg="#a855f7" marginBottom={1}><strong>Commands ({commands.length})</strong></text>
          {commands.slice(-5).map((e, i) => (
            <text key={i} fg="#777">  $ {e.detail?.slice(0, 70)}</text>
          ))}
        </box>
      )}
    </box>
  );
}
