import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { AppState, PrdInfo, RunHistoryEntry } from "./types";

interface MenuAction {
  label: string;
  key: string;
  action: () => void;
  disabled?: boolean;
}

export function HomeScreen({ state, onStartRun, onExit, onSessions, onPlan, onCreateDir }: {
  state: AppState;
  onStartRun: (maxSlices?: number) => void;
  onExit: () => void;
  onSessions: () => void;
  onPlan: () => void;
  onCreateDir: () => void;
}) {
  const hasPrds = state.prds.length > 0;
  const pendingSlices = state.prds.reduce((sum, p) => sum + p.totalSlices - p.doneSlices, 0);

  // Show different menus based on whether PRDs exist
  if (!hasPrds) {
    return <OnboardingScreen onPlan={onPlan} onCreateDir={onCreateDir} onExit={onExit} />;
  }

  return <MainHomeScreen
    state={state}
    pendingSlices={pendingSlices}
    onStartRun={onStartRun}
    onExit={onExit}
    onSessions={onSessions}
    onPlan={onPlan}
  />;
}

// --- Onboarding: no PRDs yet ---

function OnboardingScreen({ onPlan, onCreateDir, onExit }: {
  onPlan: () => void;
  onCreateDir: () => void;
  onExit: () => void;
}) {
  const [menuIdx, setMenuIdx] = useState(0);

  const actions: MenuAction[] = [
    { label: "Generate a PRD from a description", key: "g", action: onPlan },
    { label: "Create docs/prd/ directory (I'll write PRDs manually)", key: "d", action: onCreateDir },
    { label: "Quit", key: "q", action: onExit },
  ];

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onExit();
    if (key.ctrl && key.name === "c") onExit();
    if (key.name === "up" || key.name === "k") setMenuIdx((i) => Math.max(0, i - 1));
    if (key.name === "down" || key.name === "j") setMenuIdx((i) => Math.min(actions.length - 1, i + 1));
    if (key.name === "return" || key.name === "enter") actions[menuIdx]?.action();
    for (const a of actions) { if (key.name === a.key) { a.action(); return; } }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      <box paddingX={1}>
        <text>
          <span fg="#f97316"><strong>ember</strong></span>
          <span fg="#666"> — PRD-driven autonomous coding loop</span>
        </text>
      </box>

      <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={2} paddingY={1} width={55}>
          <text fg="#888" marginBottom={1}>Getting Started</text>
          <text fg="#555" marginBottom={1}>No PRDs found in this project.</text>

          {actions.map((action, i) => (
            <box key={action.key} flexDirection="row" backgroundColor={i === menuIdx ? "#1a1a2e" : undefined}>
              <text fg={i === menuIdx ? "#f97316" : "#555"} width={2}>{i === menuIdx ? "▸" : " "}</text>
              <text fg={i === menuIdx ? "#fff" : "#999"}>{action.label}</text>
              <text fg="#444"> [{action.key}]</text>
            </box>
          ))}

          <box marginTop={1}>
            <text fg="#555">Ember works from PRDs in docs/prd/*.md</text>
          </box>
        </box>
      </box>

      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">↑↓</span> navigate
          <span fg="#444"> │ </span>
          <span fg="#888">enter</span> select
          <span fg="#444"> │ </span>
          <span fg="#888">g</span> generate PRD
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> quit
        </text>
      </box>
    </box>
  );
}

// --- Main home: has PRDs ---

function MainHomeScreen({ state, pendingSlices, onStartRun, onExit, onSessions, onPlan }: {
  state: AppState;
  pendingSlices: number;
  onStartRun: (maxSlices?: number) => void;
  onExit: () => void;
  onSessions: () => void;
  onPlan: () => void;
}) {
  const [menuIdx, setMenuIdx] = useState(0);

  const actions: MenuAction[] = [
    { label: `Run all PRDs (${pendingSlices} slices)`, key: "a", action: () => onStartRun(pendingSlices || 20), disabled: pendingSlices === 0 },
    { label: "Run 5 slices", key: "5", action: () => onStartRun(5), disabled: pendingSlices === 0 },
    { label: "Run 20 slices", key: "2", action: () => onStartRun(20), disabled: pendingSlices === 0 },
    { label: "Generate new PRD", key: "g", action: onPlan },
    { label: "View past sessions", key: "v", action: onSessions },
    { label: "Quit", key: "q", action: onExit },
  ];

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onExit();
    if (key.ctrl && key.name === "c") onExit();
    if (key.name === "up" || key.name === "k") setMenuIdx((i) => Math.max(0, i - 1));
    if (key.name === "down" || key.name === "j") setMenuIdx((i) => Math.min(actions.length - 1, i + 1));
    if (key.name === "return" || key.name === "enter") {
      const a = actions[menuIdx];
      if (a && !a.disabled) a.action();
    }
    for (const a of actions) { if (key.name === a.key && !a.disabled) { a.action(); return; } }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      <box paddingX={1}>
        <text>
          <span fg="#f97316"><strong>ember</strong></span>
          <span fg="#666"> — PRD-driven autonomous coding loop</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {/* Left: Menu + PRDs */}
        <box width="50%" flexDirection="column">
          <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
            <text fg="#888" marginBottom={1}>Actions</text>
            {actions.map((action, i) => (
              <box key={action.key} flexDirection="row" backgroundColor={i === menuIdx ? "#1a1a2e" : undefined}>
                <text fg={action.disabled ? "#333" : i === menuIdx ? "#f97316" : "#555"} width={2}>
                  {i === menuIdx ? "▸" : " "}
                </text>
                <text fg={action.disabled ? "#333" : i === menuIdx ? "#fff" : "#999"}>{action.label}</text>
                <text fg="#444"> [{action.key}]</text>
              </box>
            ))}
          </box>

          <box flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1} flexGrow={1}>
            <text fg="#888" marginBottom={1}>PRDs</text>
            {state.prds.map((prd) => <PrdRow key={prd.id} prd={prd} />)}
          </box>
        </box>

        {/* Right: History */}
        <box width="50%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>Recent Runs</text>
          {state.history.length === 0 && <text fg="#555">No runs yet.</text>}
          {state.history.slice(-15).reverse().map((entry, i) => (
            <HistoryRow key={`${entry.runId}-${i}`} entry={entry} />
          ))}
        </box>
      </box>

      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">↑↓</span> navigate
          <span fg="#444"> │ </span>
          <span fg="#888">enter</span> select
          <span fg="#444"> │ </span>
          <span fg="#888">a</span> run all
          <span fg="#444"> │ </span>
          <span fg="#888">g</span> new PRD
          <span fg="#444"> │ </span>
          <span fg="#888">v</span> sessions
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> quit
        </text>
      </box>
    </box>
  );
}

// --- Shared components ---

function PrdRow({ prd }: { prd: PrdInfo }) {
  const pct = prd.totalCriteria > 0 ? Math.round((prd.doneCriteria / prd.totalCriteria) * 100) : 0;
  const barWidth = 15;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const barColor = pct === 100 ? "#22c55e" : pct > 50 ? "#eab308" : "#555";
  const titleColor = pct === 100 ? "#555" : "#fff";

  return (
    <box flexDirection="row">
      <text fg="#666" width={5}>{prd.id}</text>
      <text fg={titleColor} width={25}>{prd.title.slice(0, 24)}</text>
      <text fg={barColor}>{bar}</text>
      <text fg="#666"> {prd.doneCriteria}/{prd.totalCriteria}</text>
    </box>
  );
}

function HistoryRow({ entry }: { entry: RunHistoryEntry }) {
  return (
    <box flexDirection="row">
      <text fg="#555" width={12}>{entry.date}</text>
      <text fg="#22c55e" width={4}>{entry.slicesCompleted}✓</text>
      <text fg={entry.slicesFailed > 0 ? "#ef4444" : "#333"} width={4}>{entry.slicesFailed}✗</text>
      <text fg="#f97316">${entry.totalCost.toFixed(2)}</text>
    </box>
  );
}
