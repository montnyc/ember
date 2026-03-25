import type { ToolEvent } from "./types";

/**
 * Rich message rendering for the activity stream.
 * Replaces the flat emoji output with collapsible tool blocks,
 * thinking indicators, and nested formatting.
 */
export function MessageBlock({ event }: { event: ToolEvent }) {
  if (event.type === "tool_use") return <ToolCallBlock event={event} />;
  if (event.type === "tool_result") return <ToolResultBlock event={event} />;
  if (event.type === "text") return <ThinkingBlock event={event} />;
  if (event.type === "done") return <DoneBlock event={event} />;
  if (event.type === "commit") return <CommitBlock event={event} />;
  if (event.type === "slice_start") return <SliceStartBlock event={event} />;
  if (event.type === "slice_end") return <SliceEndBlock event={event} />;
  if (event.type === "error") return <ErrorBlock event={event} />;
  return null;
}

function ToolCallBlock({ event }: { event: ToolEvent }) {
  const name = event.name ?? "tool";
  const detail = event.detail ?? "";
  const icon = toolIcon(name);
  const nameColor = toolColor(name);

  return (
    <box flexDirection="column" marginBottom={0}>
      <box flexDirection="row">
        <text fg="#333" width={2}>│</text>
        <text fg={nameColor}>{icon} </text>
        <text fg={nameColor}><strong>{name}</strong></text>
        <text fg="#555"> {detail.slice(0, 70)}</text>
      </box>
    </box>
  );
}

function ToolResultBlock({ event }: { event: ToolEvent }) {
  if (event.isError) {
    return (
      <box flexDirection="row">
        <text fg="#333" width={2}>│</text>
        <text fg="#ef4444"> ✗ failed</text>
      </box>
    );
  }
  // Successful results are shown as a subtle tick
  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#2a5a2a"> ✓</text>
    </box>
  );
}

function ThinkingBlock({ event }: { event: ToolEvent }) {
  const text = event.detail ?? "";
  if (!text.trim()) return null;

  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#888"> {text.slice(0, 80)}</text>
    </box>
  );
}

function DoneBlock({ event }: { event: ToolEvent }) {
  const cost = event.cost ? `$${event.cost.toFixed(4)}` : "";
  const dur = event.durationSec ? `${event.durationSec.toFixed(1)}s` : "";
  const details = [cost, dur].filter(Boolean).join(" · ");

  return (
    <box flexDirection="row" marginTop={0}>
      <text fg="#333" width={2}>│</text>
      <text fg="#22c55e"> ✓ done</text>
      {details && <text fg="#555"> {details}</text>}
    </box>
  );
}

function CommitBlock({ event }: { event: ToolEvent }) {
  return (
    <box flexDirection="row" marginTop={0}>
      <text fg="#333" width={2}>│</text>
      <text fg="#22c55e"> ⬡ </text>
      <text fg="#22c55e"><strong>commit</strong></text>
      <text fg="#888"> {event.detail?.slice(0, 60)}</text>
    </box>
  );
}

function SliceStartBlock({ event }: { event: ToolEvent }) {
  return (
    <box marginTop={1} marginBottom={0}>
      <text fg="#f97316">┌─ {event.detail} ─</text>
    </box>
  );
}

function SliceEndBlock({ event }: { event: ToolEvent }) {
  const color = event.isError ? "#ef4444" : "#22c55e";
  return (
    <box marginBottom={1}>
      <text fg={color}>└─ {event.detail} ─</text>
    </box>
  );
}

function ErrorBlock({ event }: { event: ToolEvent }) {
  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#ef4444"> ✗ {event.detail}</text>
    </box>
  );
}

// --- Helpers ---

function toolIcon(name: string): string {
  switch (name) {
    case "Read": return "📄";
    case "Write": return "✏️";
    case "Edit": return "✏️";
    case "Bash": return "⚡";
    case "Glob": return "🔍";
    case "Grep": return "🔍";
    case "Agent": return "🤖";
    default: return "🔧";
  }
}

function toolColor(name: string): string {
  switch (name) {
    case "Write":
    case "Edit":
      return "#f97316"; // orange — mutations
    case "Bash":
      return "#a855f7"; // purple — commands
    case "Read":
    case "Glob":
    case "Grep":
      return "#3b82f6"; // blue — reads
    case "Agent":
      return "#ec4899"; // pink — sub-agents
    default:
      return "#eab308"; // yellow — other
  }
}
