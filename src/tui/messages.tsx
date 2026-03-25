import { useTimeline } from "@opentui/react";
import { useState, useEffect, useRef } from "react";
import type { ToolEvent } from "./types";

// --- Spinner frames for active operations ---
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/**
 * Rich message rendering with animations inspired by OpenCode's BasicTool.
 *
 * Active tool calls get:
 * - Spinning braille indicator
 * - Color shimmer cycling through bright→dim on the tool name
 * - Highlighted background
 *
 * Completed items are compact and dimmed.
 */
export function MessageBlock({ event, isLatest }: { event: ToolEvent; isLatest?: boolean }) {
  if (event.type === "tool_use") return <ToolCallBlock event={event} active={isLatest} />;
  if (event.type === "tool_result") return <ToolResultBlock event={event} />;
  if (event.type === "text") return <ThinkingBlock event={event} active={isLatest} />;
  if (event.type === "done") return <DoneBlock event={event} />;
  if (event.type === "commit") return <CommitBlock event={event} />;
  if (event.type === "slice_start") return <SliceStartBlock event={event} />;
  if (event.type === "slice_end") return <SliceEndBlock event={event} />;
  if (event.type === "error") return <ErrorBlock event={event} />;
  return null;
}

// --- Animated spinner hook ---

function useSpinner(active?: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active]);

  return active ? SPINNER[frame] : " ";
}

// --- Shimmer: cycles the tool name color bright→dim→bright ---

function useShimmerColor(baseColor: string, active?: boolean): string {
  const [blend, setBlend] = useState(1);

  const timeline = useTimeline({ loop: true, autoplay: !!active });
  useEffect(() => {
    if (!active) { setBlend(1); return; }
    timeline.add(
      [{ value: 0 }],
      {
        duration: 1200,
        ease: "inOutSine",
        alternate: true,
        loop: true,
        onUpdate: (anim) => { setBlend(anim.targets[0].value); },
      }
    );
    return () => { timeline.pause(); };
  }, [active]);

  if (!active) return baseColor;
  // Blend between baseColor and a dim version
  return blend > 0.5 ? baseColor : dimColor(baseColor);
}

function dimColor(hex: string): string {
  // Simple dim: mix toward #333
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = 0.4;
  const dr = Math.round(r * mix + 0x33 * (1 - mix));
  const dg = Math.round(g * mix + 0x33 * (1 - mix));
  const db = Math.round(b * mix + 0x33 * (1 - mix));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

// --- Tool call: the main visual element ---

function ToolCallBlock({ event, active }: { event: ToolEvent; active?: boolean }) {
  const name = event.name ?? "tool";
  const detail = event.detail ?? "";
  const baseColor = toolColor(name);
  const shimmerColor = useShimmerColor(baseColor, active);
  const spinner = useSpinner(active);

  return (
    <box
      flexDirection="row"
      backgroundColor={active ? "#111318" : undefined}
      paddingX={active ? 0 : 0}
    >
      <text fg={active ? baseColor : "#333"} width={2}>{active ? spinner : "│"}</text>
      <text fg={shimmerColor} width={2}>{toolIcon(name)}</text>
      <text fg={shimmerColor}><strong>{name.padEnd(7)}</strong></text>
      <text fg={active ? "#999" : "#555"}>{truncateDetail(detail, name)}</text>
    </box>
  );
}

// --- Tool result ---

function ToolResultBlock({ event }: { event: ToolEvent }) {
  if (event.isError) {
    return (
      <box flexDirection="row">
        <text fg="#333" width={2}>│</text>
        <text fg="#ef4444">  ✗ failed</text>
      </box>
    );
  }
  // Subtle — just a thin check, doesn't take visual space
  return (
    <box flexDirection="row">
      <text fg="#222" width={2}>│</text>
      <text fg="#1e3a1e">  ✓</text>
    </box>
  );
}

// --- Thinking: Claude's reasoning with subtle animation ---

function ThinkingBlock({ event, active }: { event: ToolEvent; active?: boolean }) {
  const text = event.detail ?? "";
  if (!text.trim()) return null;

  const spinner = useSpinner(active);

  return (
    <box flexDirection="row">
      <text fg={active ? "#555" : "#222"} width={2}>{active ? spinner : "│"}</text>
      <text fg={active ? "#aaa" : "#555"}>  {text.slice(0, 80)}</text>
    </box>
  );
}

// --- Done block with animated number ---

function DoneBlock({ event }: { event: ToolEvent }) {
  const cost = event.cost ? `$${event.cost.toFixed(4)}` : "";
  const dur = event.durationSec ? `${event.durationSec.toFixed(1)}s` : "";
  const details = [cost, dur].filter(Boolean).join("  ");

  return (
    <box flexDirection="row">
      <text fg="#1a3a1a" width={2}>│</text>
      <text fg="#22c55e">  ● complete</text>
      {details && <text fg="#444">  {details}</text>}
    </box>
  );
}

// --- Commit ---

function CommitBlock({ event }: { event: ToolEvent }) {
  return (
    <box flexDirection="row" backgroundColor="#0d1a0d">
      <text fg="#1a3a1a" width={2}>│</text>
      <text fg="#22c55e">  ◆ </text>
      <text fg="#4ade80"><strong>commit</strong></text>
      <text fg="#666">  {event.detail?.slice(0, 50)}</text>
    </box>
  );
}

// --- Slice boundaries with animated reveal ---

function SliceStartBlock({ event }: { event: ToolEvent }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(true); }, []);

  return (
    <box marginTop={1} opacity={visible ? 1 : 0}>
      <text fg="#f97316">
        ┌─── {event.detail} ───
      </text>
    </box>
  );
}

function SliceEndBlock({ event }: { event: ToolEvent }) {
  const color = event.isError ? "#ef4444" : "#22c55e";
  const icon = event.isError ? "✗" : "●";
  return (
    <box marginBottom={1}>
      <text fg={color}>
        └─── {icon} {event.detail} ───
      </text>
    </box>
  );
}

// --- Error ---

function ErrorBlock({ event }: { event: ToolEvent }) {
  return (
    <box flexDirection="row" backgroundColor="#1a0d0d">
      <text fg="#4a1a1a" width={2}>│</text>
      <text fg="#ef4444">  ✗ {event.detail}</text>
    </box>
  );
}

// --- Helpers ---

function toolIcon(name: string): string {
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
  const maxLen = 60;
  if (detail.length <= maxLen) return detail;

  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    const parts = detail.split("/");
    if (parts.length > 2) return "…/" + parts.slice(-2).join("/");
  }

  return detail.slice(0, maxLen - 1) + "…";
}
