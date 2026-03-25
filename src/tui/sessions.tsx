import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { AppState, RunHistoryEntry } from "./types";

/**
 * Session list screen — browse past runs and see what each did.
 * Accessible from the command palette or home screen.
 */
export function SessionList({ state, onBack }: {
  state: AppState;
  onBack: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const sessions = state.history.slice().reverse();

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q") onBack();
    if (key.ctrl && key.name === "c") onBack();
    if (key.name === "up") setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.name === "down") setSelectedIdx((i) => Math.min(sessions.length - 1, i + 1));
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#0a0a0a">
      <box paddingX={1}>
        <text>
          <span fg="#f97316"><strong>ember</strong></span>
          <span fg="#888"> › Sessions</span>
        </text>
      </box>

      <box flexDirection="row" flexGrow={1} gap={1}>
        {/* Session list */}
        <box width="40%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>Past Runs ({sessions.length})</text>

          {sessions.length === 0 && <text fg="#555">No runs yet.</text>}

          {sessions.map((session, i) => {
            const selected = i === selectedIdx;
            return (
              <box
                key={`${session.runId}-${i}`}
                flexDirection="row"
                backgroundColor={selected ? "#1a1a2e" : undefined}
              >
                <text fg={selected ? "#f97316" : "#555"} width={2}>{selected ? "▸" : " "}</text>
                <text fg={session.verdict === "done" ? "#22c55e" : "#ef4444"} width={2}>
                  {session.verdict === "done" ? "✓" : "✗"}
                </text>
                <text fg="#666" width={12}>{session.date}</text>
                <text fg={selected ? "#fff" : "#999"}>{session.sliceId}</text>
              </box>
            );
          })}
        </box>

        {/* Session detail */}
        <box width="60%" flexDirection="column" border borderStyle="single" borderColor="#333" paddingX={1}>
          <text fg="#888" marginBottom={1}>Details</text>

          {sessions.length > 0 && selectedIdx < sessions.length ? (
            <SessionDetail session={sessions[selectedIdx]} />
          ) : (
            <text fg="#555">Select a session to view details.</text>
          )}
        </box>
      </box>

      <box paddingX={1}>
        <text fg="#555">
          <span fg="#888">↑↓</span> navigate
          <span fg="#444"> │ </span>
          <span fg="#888">q</span> back
        </text>
      </box>
    </box>
  );
}

function SessionDetail({ session }: { session: RunHistoryEntry }) {
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row">
        <text fg="#555" width={12}>Run ID:</text>
        <text fg="#fff">{session.runId}</text>
      </box>
      <box flexDirection="row">
        <text fg="#555" width={12}>Date:</text>
        <text fg="#fff">{session.date}</text>
      </box>
      <box flexDirection="row">
        <text fg="#555" width={12}>Slice:</text>
        <text fg="#fff">{session.sliceId}</text>
      </box>
      <box flexDirection="row">
        <text fg="#555" width={12}>Result:</text>
        <text fg={session.slicesCompleted > 0 ? "#22c55e" : "#ef4444"}>
          {session.slicesCompleted > 0 ? "✓ done" : "✗ failed"}
        </text>
      </box>
      <box flexDirection="row">
        <text fg="#555" width={12}>Cost:</text>
        <text fg="#f97316">${session.totalCost.toFixed(4)}</text>
      </box>
    </box>
  );
}
