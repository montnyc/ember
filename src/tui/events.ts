import type { ToolEvent } from "./types";

/**
 * Convert a Claude stream-json event into a TUI-friendly ToolEvent.
 * Returns null for events we don't care about displaying.
 */
export function streamEventToToolEvent(event: Record<string, unknown>): ToolEvent | null {
  const now = Date.now();

  if (event.type === "assistant") {
    return parseAssistantEvent(event, now);
  }

  if (event.type === "user") {
    return parseUserEvent(event, now);
  }

  if (event.type === "result") {
    return {
      type: "done",
      cost: (event.cost_usd as number) ?? undefined,
      durationSec: ((event.duration_ms as number) ?? 0) / 1000,
      timestamp: now,
    };
  }

  return null;
}

function parseAssistantEvent(event: Record<string, unknown>, now: number): ToolEvent | null {
  const message = event.message as { content?: { type: string; name?: string; text?: string; input?: { description?: string; command?: string } }[] } | undefined;
  if (!message?.content) return null;

  for (const block of message.content) {
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        name: block.name,
        detail: block.input?.command ?? block.input?.description?.slice(0, 100) ?? "",
        timestamp: now,
      };
    }
    if (block.type === "text" && block.text) {
      const firstLine = block.text.split("\n")[0].slice(0, 120);
      if (firstLine.trim()) return { type: "text", detail: firstLine, timestamp: now };
    }
  }

  return null;
}

function parseUserEvent(event: Record<string, unknown>, now: number): ToolEvent | null {
  const message = event.message as { content?: { type: string; is_error?: boolean }[] } | undefined;
  if (!message?.content) return null;

  for (const block of message.content) {
    if (block.type === "tool_result") {
      return { type: "tool_result", isError: block.is_error ?? false, timestamp: now };
    }
  }

  return null;
}
