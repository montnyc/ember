import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useState } from "react";

const MODELS = ["opus", "sonnet", "haiku"] as const;

interface InitResult {
  model: string;
}

interface InitScreenProps {
  prdCount: number;
  criteriaCount: number;
  sliceCount: number;
  pendingSlices: number;
  skillInstalled: boolean;
  onConfirm: (result: InitResult) => void;
  onExit: () => void;
}

function InitScreen({ prdCount, criteriaCount, sliceCount, pendingSlices, skillInstalled, onConfirm, onExit }: InitScreenProps) {
  const [modelIdx, setModelIdx] = useState(0); // default: opus
  const [confirmed, setConfirmed] = useState(false);

  useKeyboard((key) => {
    if (confirmed) return;

    if (key.name === "q" || key.name === "escape") onExit();
    if (key.ctrl && key.name === "c") onExit();

    if (key.name === "left" || key.name === "h") {
      setModelIdx((i) => Math.max(0, i - 1));
    }
    if (key.name === "right" || key.name === "l") {
      setModelIdx((i) => Math.min(MODELS.length - 1, i + 1));
    }

    if (key.name === "return" || key.name === "enter") {
      setConfirmed(true);
      onConfirm({ model: MODELS[modelIdx] });
    }
  });

  return (
    <box flexDirection="column" padding={2} backgroundColor="#0a0a0a" width="100%" height="100%">
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <span fg="#f97316"><strong>  ember init</strong></span>
        </text>
      </box>

      {/* Model selector */}
      <box marginBottom={1} flexDirection="row">
        <text fg="#888" width={12}>  Model:</text>
        {MODELS.map((m, i) => (
          <text key={m} fg={i === modelIdx ? "#fff" : "#555"}>
            {i === modelIdx ? " ● " : " ○ "}
            <span fg={i === modelIdx ? "#f97316" : "#555"}>{m}</span>
          </text>
        ))}
      </box>

      {/* Stats */}
      <box flexDirection="column" marginBottom={1} border borderStyle="single" borderColor="#333" paddingX={2} paddingY={1}>
        <box flexDirection="row">
          <text fg="#888" width={14}>  PRDs:</text>
          <text fg={prdCount > 0 ? "#22c55e" : "#ef4444"}>{prdCount}</text>
        </box>
        <box flexDirection="row">
          <text fg="#888" width={14}>  Criteria:</text>
          <text fg="#fff">{criteriaCount}</text>
        </box>
        <box flexDirection="row">
          <text fg="#888" width={14}>  Slices:</text>
          <text fg="#fff">{sliceCount}</text>
          <text fg="#666"> ({pendingSlices} pending)</text>
        </box>
        <box flexDirection="row">
          <text fg="#888" width={14}>  Skill:</text>
          <text fg={skillInstalled ? "#22c55e" : "#eab308"}>{skillInstalled ? "installed" : "installing..."}</text>
        </box>
      </box>

      {/* Instructions */}
      {!confirmed && (
        <box>
          <text fg="#555">  ←→ select model · enter confirm · q quit</text>
        </box>
      )}

      {confirmed && (
        <box marginTop={1}>
          <text fg="#22c55e">  ✓ Initialized with {MODELS[modelIdx]} model.</text>
        </box>
      )}

      {prdCount === 0 && !confirmed && (
        <box marginTop={1}>
          <text fg="#eab308">  No PRDs found. After init, run: ember plan "describe what to build"</text>
        </box>
      )}

      {prdCount > 0 && !confirmed && (
        <box marginTop={1}>
          <text fg="#888">  After init, run: ember afk --max-slices {pendingSlices}</text>
        </box>
      )}
    </box>
  );
}

/**
 * Run interactive init TUI. Returns the selected model, or null if user quit.
 */
export async function runInitTui(opts: {
  prdCount: number;
  criteriaCount: number;
  sliceCount: number;
  pendingSlices: number;
  skillInstalled: boolean;
}): Promise<InitResult | null> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  return new Promise<InitResult | null>((resolve) => {
    const cleanup = () => {
      renderer.destroy();
      process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[?1000l\x1b[?1003l\x1b[?2004l\x1b[0m");
    };

    createRoot(renderer).render(
      <InitScreen
        {...opts}
        onConfirm={(result) => {
          // Small delay so user sees the confirmation
          setTimeout(() => { cleanup(); resolve(result); }, 500);
        }}
        onExit={() => { cleanup(); resolve(null); }}
      />
    );
  });
}
