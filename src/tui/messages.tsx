import { useTimeline } from "@opentui/react";
import { useState, useEffect } from "react";
import type { ToolEvent } from "./types";

/**
 * Rich message rendering with animations.
 * Uses OpenTUI's Timeline API for shimmer effects on active operations.
 */
export function MessageBlock({ event, isLatest }: { event: ToolEvent; isLatest?: boolean }) {
  if (event.type === "tool_use") return <ToolCallBlock event={event} active={isLatest} />;
  if (event.type === "tool_result") return <ToolResultBlock event={event} />;
  if (event.type === "text") return <ThinkingBlock event={event} />;
  if (event.type === "done") return <DoneBlock event={event} />;
  if (event.type === "commit") return <CommitBlock event={event} />;
  if (event.type === "slice_start") return <SliceStartBlock event={event} />;
  if (event.type === "slice_end") return <SliceEndBlock event={event} />;
  if (event.type === "error") return <ErrorBlock event={event} />;
  return null;
}

// --- Tool call with shimmer animation when active ---

function ToolCallBlock({ event, active }: { event: ToolEvent; active?: boolean }) {
  const name = event.name ?? "tool";
  const detail = event.detail ?? "";
  const icon = toolIcon(name);
  const color = toolColor(name);

  // Shimmer animation: cycles opacity on the active tool call
  const [shimmerOpacity, setShimmerOpacity] = useState(1);

  const timeline = useTimeline({ loop: true, autoplay: !!active });
  useEffect(() => {
    if (!active) return;
    timeline.add(
      [{ value: 1 }],
      { duration: 800, ease: "inOutSine", alternate: true, loop: true, onUpdate: (anim) => {
        const v = anim.targets[0].value;
        setShimmerOpacity(0.4 + v * 0.6);
      }}
    );
    return () => { timeline.pause(); };
  }, [active]);

  return (
    <box flexDirection="row" opacity={active ? shimmerOpacity : 1}>
      <text fg="#333" width={2}>│</text>
      <text fg={color} width={2}>{icon}</text>
      <text fg={color} width={8}><strong>{name}</strong></text>
      <text fg="#666">{truncateDetail(detail, name)}</text>
    </box>
  );
}

// --- Tool result: subtle or error ---

function ToolResultBlock({ event }: { event: ToolEvent }) {
  if (event.isError) {
    return (
      <box flexDirection="row">
        <text fg="#333" width={2}>│</text>
        <text fg="#ef4444"> ✗ error</text>
      </box>
    );
  }
  return (
    <box flexDirection="row">
      <text fg="#1a3a1a" width={2}>│</text>
      <text fg="#2a5a2a"> ✓</text>
    </box>
  );
}

// --- Thinking text: Claude's reasoning ---

function ThinkingBlock({ event }: { event: ToolEvent }) {
  const text = event.detail ?? "";
  if (!text.trim()) return null;

  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#777"> {text.slice(0, 85)}</text>
    </box>
  );
}

// --- Done: cost + duration ---

function DoneBlock({ event }: { event: ToolEvent }) {
  const cost = event.cost ? `$${event.cost.toFixed(4)}` : "";
  const dur = event.durationSec ? `${event.durationSec.toFixed(1)}s` : "";
  const details = [cost, dur].filter(Boolean).join(" · ");

  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#22c55e"> ● done</text>
      {details && <text fg="#555"> {details}</text>}
    </box>
  );
}

// --- Commit ---

function CommitBlock({ event }: { event: ToolEvent }) {
  return (
    <box flexDirection="row">
      <text fg="#333" width={2}>│</text>
      <text fg="#22c55e" width={2}>◆</text>
      <text fg="#22c55e"><strong>commit</strong></text>
      <text fg="#888"> {event.detail?.slice(0, 55)}</text>
    </box>
  );
}

// --- Slice boundaries ---

function SliceStartBlock({ event }: { event: ToolEvent }) {
  return (
    <box marginTop={1}>
      <text fg="#f97316">┌── {event.detail} ──</text>
    </box>
  );
}

function SliceEndBlock({ event }: { event: ToolEvent }) {
  const color = event.isError ? "#ef4444" : "#22c55e";
  const icon = event.isError ? "✗" : "●";
  return (
    <box marginBottom={1}>
      <text fg={color}>└── {icon} {event.detail} ──</text>
    </box>
  );
}

// --- Error ---

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
  // Simple ASCII icons — no emojis, clean in any terminal
  switch (name) {
    case "Read":  return "◇";
    case "Write": return "◈";
    case "Edit":  return "◈";
    case "Bash":  return "›";
    case "Glob":  return "○";
    case "Grep":  return "○";
    case "Agent": return "◉";
    default:      return "·";
  }
}

function toolColor(name: string): string {
  switch (name) {
    case "Write": case "Edit": return "#f97316";
    case "Bash":               return "#a855f7";
    case "Read": case "Glob": case "Grep": return "#3b82f6";
    case "Agent":              return "#ec4899";
    default:                   return "#eab308";
  }
}

function truncateDetail(detail: string, toolName: string): string {
  // For Bash, show the command. For files, show the path.
  const maxLen = 65;
  if (detail.length <= maxLen) return detail;

  // Try to show just the filename for paths
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    const parts = detail.split("/");
    if (parts.length > 2) {
      return "…/" + parts.slice(-2).join("/");
    }
  }

  return detail.slice(0, maxLen - 1) + "…";
}
