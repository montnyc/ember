import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { AppState, PrdInfo, RunHistoryEntry } from "./types";

interface MenuAction {
  label: string;
  description: string;
  key: string; // shortcut key
  action: () => void;
  disabled?: boolean;
}

export function HomeScreen({ state, onStartRun, onExit, onSessions }: {
  state: AppState;
  onStartRun: (maxSlices?: number) => void;
  onExit: () => void;
  onSessions: () => void;
}) {
  const [menuIdx, setMenuIdx] = useState(0);

  const hasPrds = state.prds.length > 0;
  const pendingSlices = state.prds.reduce((sum, p) => sum + p.totalSlices - p.doneSlices, 0);

  const actions: MenuAction[] = [
    {
      label: `Run all PRDs (${pendingSlices} slices)`,
      description: "Start AFK loop across all pending slices",
      key: "a",
      action: () => onStartRun(pendingSlices || 20),
      disabled: !hasPrds,
    },
    {
      label: "Run 5 slices",
      description: "Quick run — do 5 slices then stop",
      key: "5",
      action: () => onStartRun(5),
      disabled: !hasPrds,
    },
    {
      label: "Run 20 slices",
      description: "Medium run — do 20 slices then stop",
      key: "2",
      action: () => onStartRun(20),
      disabled: !hasPrds,
    },
    {
      label: "View past sessions",
      description: "Browse run history and details",
      key: "v",
      action: onSessions,
    },
    {
      label: "Quit",
      description: "",
      key: "q",
      action: onExit,
    },
  ];

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onExit();
    if (key.ctrl && key.name === "c") onExit();

    if (key.name === "up" || key.name === "k") {
      setMenuIdx((i) => Math.max(0, i - 1));
    }
    if (key.name === "down" || key.name === "j") {
      setMenuIdx((i) => Math.min(actions.length - 1, i + 1));
    }

    if (key.name === "return" || key.name === "enter") {
      const action = actions[menuIdx];
      if (action && !action.disabled) action.action();
    }

    // Shortcut keys
    for (const action of actions) {
      if (key.name === action.key && !action.disabled) {
        action.action();
        return;
      }
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      {/* Header */}
      <box paddingX={1}>
        <text>
          <span fg="#f97316"><strong>ember</strong></span>
          <span fg="#666"> — PRD-driven autonomous coding loop</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {/* Left: Menu + PRDs */}
        <box width="50%" flexDirection="column">
          {/* Action menu */}
          <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
            <text fg="#888" marginBottom={1}>Actions</text>
            {actions.map((action, i) => (
              <MenuItem
                key={action.label}
                action={action}
                selected={i === menuIdx}
              />
            ))}
          </box>

          {/* PRD list */}
          <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1} flexGrow={1}>
            <text fg="#888" marginBottom={1}>PRDs</text>
            {!hasPrds && (
              <box flexDirection="column">
                <text fg="#555">No PRDs found.</text>
                <text fg="#888" marginTop={1}>Create one with:</text>
                <text fg="#f97316">  ember plan "describe what to build"</text>
              </box>
            )}
            {state.prds.map((prd) => (
              <PrdRow key={prd.id} prd={prd} />
            ))}
          </box>
        </box>

        {/* Right: History */}
        <box width="50%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>Recent Runs</text>
          {state.history.length === 0 && (
            <text fg="#555">No runs yet.</text>
          )}
          {state.history.slice(-15).reverse().map((entry, i) => (
            <HistoryRow key={`${entry.runId}-${i}`} entry={entry} />
          ))}
        </box>
      </box>

      {/* Footer */}
      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">↑↓</span> navigate
          <span fg="#444"> │ </span>
          <span fg="#888">enter</span> select
          <span fg="#444"> │ </span>
          <span fg="#888">a</span> run all
          <span fg="#444"> │ </span>
          <span fg="#888">5</span> quick
          <span fg="#444"> │ </span>
          <span fg="#888">v</span> sessions
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> quit
        </text>
      </box>
    </box>
  );
}

function MenuItem({ action, selected }: { action: MenuAction; selected: boolean }) {
  const fg = action.disabled ? "#333" : selected ? "#fff" : "#999";
  const icon = selected ? "▸" : " ";
  const iconColor = selected ? "#f97316" : "#333";
  const bg = selected ? "#1a1a2e" : undefined;
  const shortcut = action.key !== "q" ? `[${action.key}]` : "";

  return (
    <box flexDirection="row" backgroundColor={bg}>
      <text fg={iconColor} width={2}>{icon}</text>
      <text fg={fg}>{action.label}</text>
      {shortcut && <text fg="#444"> {shortcut}</text>}
    </box>
  );
}

function PrdRow({ prd }: { prd: PrdInfo }) {
  const pct = prd.totalCriteria > 0
    ? Math.round((prd.doneCriteria / prd.totalCriteria) * 100)
    : 0;

  const barWidth = 15;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const barColor = pct === 100 ? "#22c55e" : pct > 50 ? "#eab308" : "#555";
  const titleColor = pct === 100 ? "#555" : "#fff";

  return (
    <box flexDirection="row" marginBottom={0}>
      <text fg="#666" width={5}>{prd.id}</text>
      <text fg={titleColor} width={25}>{prd.title.slice(0, 24)}</text>
      <text fg={barColor}>{bar}</text>
      <text fg="#666"> {prd.doneCriteria}/{prd.totalCriteria}</text>
    </box>
  );
}

function HistoryRow({ entry }: { entry: RunHistoryEntry }) {
  const hasFailures = entry.slicesFailed > 0;
  return (
    <box flexDirection="row">
      <text fg="#555" width={12}>{entry.date}</text>
      <text fg="#22c55e" width={4}>{entry.slicesCompleted}✓</text>
      <text fg={hasFailures ? "#ef4444" : "#333"} width={4}>{entry.slicesFailed}✗</text>
      <text fg="#f97316">${entry.totalCost.toFixed(2)}</text>
    </box>
  );
}
