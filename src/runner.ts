import type { EmberConfig, RunnerResult } from "./types";

export async function spawnClaude(
  prompt: string,
  config: EmberConfig,
  projectRoot: string,
  sessionId?: string
): Promise<RunnerResult> {
  // Session ID gives Claude persistent context across calls within a slice —
  // without it, Claude often just produces text instead of using tools.
  const args = [
    "claude",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.runner.model,
    ...(sessionId ? ["--session-id", sessionId] : []),
    "-p",
    prompt,
  ];

  const proc = Bun.spawn(args, {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "ember" },
  });

  // Timeout: kill the process if it runs too long
  const timeoutMs = config.runner.timeoutMs;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`  Timeout after ${(timeoutMs / 1000 / 60).toFixed(0)}min — killing Claude process`);
    proc.kill();
  }, timeoutMs);

  const [collected, stderr] = await Promise.all([
    collectStreamEvents(proc.stdout),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return { exitCode: 124, output: "timeout", costUsd: collected.costUsd, durationMs: collected.durationMs };
  }

  if (exitCode !== 0 && stderr.trim()) {
    console.error(`[runner] stderr: ${stderr.trim()}`);
  }

  return {
    exitCode,
    output: collected.output,
    costUsd: collected.costUsd,
    durationMs: collected.durationMs,
  };
}

// --- Stream processing with live terminal output ---

interface CollectedOutput {
  output: string;
  costUsd: number | null;
  durationMs: number | null;
}

async function collectStreamEvents(
  stdout: ReadableStream<Uint8Array>
): Promise<CollectedOutput> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let output = "";
  let costUsd: number | null = null;
  let durationMs: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseStreamEvent(line);
      if (!event) continue;

      // Show activity in terminal so the user knows what's happening
      printStreamEvent(event);

      ({ output, costUsd, durationMs } = applyEvent(event, output, costUsd, durationMs));
    }
  }

  if (buffer.trim()) {
    const event = parseStreamEvent(buffer);
    if (event) {
      printStreamEvent(event);
      ({ output, costUsd, durationMs } = applyEvent(event, output, costUsd, durationMs));
    }
  }

  return { output, costUsd, durationMs };
}

function parseStreamEvent(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function applyEvent(
  event: Record<string, unknown>,
  output: string,
  costUsd: number | null,
  durationMs: number | null
): CollectedOutput {
  if (event.type === "assistant") {
    const message = event.message as { content?: { type: string; text?: string }[] } | undefined;
    if (message?.content) {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          output += block.text;
        }
      }
    }
  } else if (event.type === "result") {
    output = (event.result as string) ?? output;
    costUsd = (event.cost_usd as number) ?? null;
    durationMs = (event.duration_ms as number) ?? null;
  }

  return { output, costUsd, durationMs };
}

// --- Live output ---
// If a TUI override is set, events go there. Otherwise, print to terminal.

function printStreamEvent(event: Record<string, unknown>): void {
  const override = (globalThis as any).__emberPrintEvent;
  if (override) { override(event); return; }

  if (event.type === "assistant") {
    const message = event.message as { content?: { type: string; name?: string; text?: string; input?: { description?: string; command?: string } }[] } | undefined;
    if (!message?.content) return;

    for (const block of message.content) {
      if (block.type === "tool_use") {
        const detail = block.input?.command
          ?? block.input?.description?.slice(0, 100)
          ?? "";
        console.log(`  ${dim("┃")} ${yellow(block.name ?? "tool")} ${detail}`);
      } else if (block.type === "text" && block.text) {
        // Show first line of assistant text, truncated
        const firstLine = block.text.split("\n")[0].slice(0, 120);
        if (firstLine.trim()) {
          console.log(`  ${dim("┃")} ${firstLine}`);
        }
      }
    }
  } else if (event.type === "user") {
    const message = event.message as { content?: { type: string; is_error?: boolean }[] } | undefined;
    if (!message?.content) return;

    for (const block of message.content) {
      if (block.type === "tool_result") {
        const status = block.is_error ? red("✗") : green("✓");
        console.log(`  ${dim("┃")} ${status}`);
      }
    }
  } else if (event.type === "result") {
    const cost = (event.cost_usd as number) ?? 0;
    const duration = (event.duration_ms as number) ?? 0;
    const costStr = cost > 0 ? ` $${cost.toFixed(4)}` : "";
    const durationStr = duration > 0 ? ` ${(duration / 1000).toFixed(1)}s` : "";
    console.log(`  ${dim("┃")} ${green("done")}${costStr}${durationStr}`);
  }
}

// ANSI helpers
function dim(s: string): string { return `\x1b[2m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string): string { return `\x1b[31m${s}\x1b[0m`; }
