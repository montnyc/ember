import { useKeyboard } from "@opentui/react";
import type { AppState, PrdInfo, RunHistoryEntry } from "./types";

export function HomeScreen({ state, onStartRun, onExit }: {
  state: AppState;
  onStartRun: (prdId?: string) => void;
  onExit: () => void;
}) {
  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onExit();
    if (key.name === "return" || key.name === "enter") onStartRun();
    if (key.ctrl && key.name === "c") onExit();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      {/* Header */}
      <box paddingX={1} marginBottom={1}>
        <text>
          <span fg="#f97316"><strong>ember</strong></span>
          <span fg="#666"> — PRD-driven autonomous coding loop</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {/* PRD List */}
        <box width="55%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>PRDs</text>
          {state.prds.length === 0 && (
            <text fg="#555">No PRDs found. Create docs/prd/001-xxx.md to get started.</text>
          )}
          {state.prds.map((prd) => (
            <PrdRow key={prd.id} prd={prd} />
          ))}
        </box>

        {/* Run History */}
        <box width="45%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>Recent Runs</text>
          {state.history.length === 0 && (
            <text fg="#555">No runs yet.</text>
          )}
          {state.history.slice(-10).reverse().map((entry) => (
            <HistoryRow key={entry.runId} entry={entry} />
          ))}
        </box>
      </box>

      {/* Footer */}
      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">enter</span> start run
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> quit
        </text>
      </box>
    </box>
  );
}

function PrdRow({ prd }: { prd: PrdInfo }) {
  const pct = prd.totalCriteria > 0
    ? Math.round((prd.doneCriteria / prd.totalCriteria) * 100)
    : 0;

  const barWidth = 20;
  const filled = Math.round((pct / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const barColor = pct === 100 ? "#22c55e" : pct > 50 ? "#eab308" : "#555";
  const titleColor = pct === 100 ? "#555" : "#fff";

  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg="#666" width={5}>{prd.id}</text>
        <text fg={titleColor}>{prd.title}</text>
        <text fg="#666"> ({prd.priority})</text>
      </box>
      <box flexDirection="row">
        <text fg="#333" width={5}></text>
        <text fg={barColor}>{bar}</text>
        <text fg="#666"> {prd.doneCriteria}/{prd.totalCriteria} criteria · {prd.doneSlices}/{prd.totalSlices} slices</text>
      </box>
    </box>
  );
}

function HistoryRow({ entry }: { entry: RunHistoryEntry }) {
  const hasFailures = entry.slicesFailed > 0;
  return (
    <box flexDirection="row" marginBottom={0}>
      <text fg="#555" width={8}>{entry.date}</text>
      <text fg="#22c55e" width={4}>{entry.slicesCompleted}✓</text>
      <text fg={hasFailures ? "#ef4444" : "#333"} width={4}>{entry.slicesFailed}✗</text>
      <text fg="#888" width={8}>{entry.durationMin.toFixed(1)}m</text>
      <text fg="#f97316">${entry.totalCost.toFixed(2)}</text>
    </box>
  );
}
