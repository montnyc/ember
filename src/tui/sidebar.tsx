import type { AppState, ToolEvent } from "./types";

/**
 * Persistent sidebar showing file changes, session info, and run stats.
 * Visible during both home and run screens.
 */
export function Sidebar({ state }: { state: AppState }) {
  const filesModified = extractFileChanges(state.events, "Write", "Edit");
  const filesRead = extractFileChanges(state.events, "Read");
  const commands = state.events.filter((e) => e.type === "tool_use" && e.name === "Bash");

  return (
    <box flexDirection="column" width={30} border borderStyle="single" borderColor="#333" paddingX={1}>
      {/* Session info */}
      <text fg="#888" marginBottom={1}>Session</text>
      <box flexDirection="row">
        <text fg="#555" width={8}>Mode:</text>
        <text fg={modeColor(state.mode)}>{state.mode}</text>
      </box>
      {state.currentSliceIndex >= 0 && state.slices[state.currentSliceIndex] && (
        <box flexDirection="row">
          <text fg="#555" width={8}>Slice:</text>
          <text fg="#fff">{state.slices[state.currentSliceIndex].criterionId}</text>
        </box>
      )}
      <box flexDirection="row">
        <text fg="#555" width={8}>Done:</text>
        <text fg="#22c55e">{state.completed}</text>
        <text fg="#444"> / </text>
        <text fg="#888">{state.slices.length}</text>
      </box>
      {state.totalCost > 0 && (
        <box flexDirection="row">
          <text fg="#555" width={8}>Cost:</text>
          <text fg="#f97316">${state.totalCost.toFixed(2)}</text>
        </box>
      )}

      {/* File changes */}
      {filesModified.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg="#f97316" marginBottom={1}>
            <strong>Modified ({filesModified.length})</strong>
          </text>
          {filesModified.slice(-8).map((f, i) => (
            <text key={i} fg="#999">{truncatePath(f)}</text>
          ))}
          {filesModified.length > 8 && <text fg="#555">+{filesModified.length - 8} more</text>}
        </box>
      )}

      {/* Commands run */}
      {commands.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg="#a855f7" marginBottom={1}>
            <strong>Commands ({commands.length})</strong>
          </text>
          {commands.slice(-5).map((e, i) => (
            <text key={i} fg="#666">{(e.detail ?? "").slice(0, 25)}</text>
          ))}
        </box>
      )}

      {/* Files read */}
      {filesRead.length > 0 && (
        <box flexDirection="column" marginTop={1}>
          <text fg="#3b82f6" marginBottom={1}>
            <strong>Read ({filesRead.length})</strong>
          </text>
          {filesRead.slice(-5).map((f, i) => (
            <text key={i} fg="#555">{truncatePath(f)}</text>
          ))}
        </box>
      )}
    </box>
  );
}

function extractFileChanges(events: ToolEvent[], ...toolNames: string[]): string[] {
  const files: string[] = [];
  for (const e of events) {
    if (e.type === "tool_use" && toolNames.includes(e.name ?? "")) {
      const path = e.detail?.split(" ")[0] ?? e.detail ?? "";
      if (path && !files.includes(path)) files.push(path);
    }
  }
  return files;
}

function truncatePath(p: string): string {
  // Show just filename or last 2 path segments
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}

function modeColor(mode: string): string {
  if (mode === "running") return "#22c55e";
  if (mode === "paused") return "#eab308";
  if (mode === "finished") return "#3b82f6";
  return "#666";
}
