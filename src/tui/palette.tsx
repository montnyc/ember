import { useKeyboard } from "@opentui/react";
import { useState } from "react";

export interface PaletteAction {
  id: string;
  title: string;
  shortcut?: string;
  action: () => void;
}

/**
 * Command palette overlay — Ctrl+P to open, type to filter, Enter to execute.
 * Renders as a floating box on top of the current screen.
 */
export function CommandPalette({ actions, onClose }: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = query
    ? actions.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
    : actions;

  useKeyboard((key) => {
    if (key.name === "escape") { onClose(); return; }
    if (key.ctrl && key.name === "p") { onClose(); return; }

    if (key.name === "up" || (key.ctrl && key.name === "k")) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down" || (key.ctrl && key.name === "j")) {
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }

    if (key.name === "return" || key.name === "enter") {
      const action = filtered[selectedIdx];
      if (action) { onClose(); action.action(); }
      return;
    }

    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      setSelectedIdx(0);
      return;
    }

    // Regular character input
    if (key.name && key.name.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.name);
      setSelectedIdx(0);
    }
  });

  return (
    <box
      flexDirection="column"
      width={50}
      border
      borderStyle="double"
      borderColor="#f97316"
      backgroundColor="#111"
      padding={1}
      zIndex={100}
    >
      {/* Search input */}
      <box flexDirection="row" marginBottom={1}>
        <text fg="#f97316">❯ </text>
        <text fg="#fff">{query}</text>
        <text fg="#444">│</text>
      </box>

      {/* Results */}
      {filtered.length === 0 && <text fg="#555">No matching commands</text>}
      {filtered.slice(0, 10).map((action, i) => {
        const selected = i === selectedIdx;
        return (
          <box key={action.id} flexDirection="row" backgroundColor={selected ? "#1a1a2e" : undefined}>
            <text fg={selected ? "#f97316" : "#666"} width={2}>{selected ? "▸" : " "}</text>
            <text fg={selected ? "#fff" : "#999"}>{action.title}</text>
            {action.shortcut && <text fg="#444"> ({action.shortcut})</text>}
          </box>
        );
      })}

      <box marginTop={1}>
        <text fg="#555">↑↓ navigate · enter select · esc close</text>
      </box>
    </box>
  );
}
