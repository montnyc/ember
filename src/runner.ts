import type { EmberConfig, RunnerResult } from "./types";

export async function spawnClaude(
  prompt: string,
  config: EmberConfig,
  projectRoot: string
): Promise<RunnerResult> {
  // v1 runs fully unattended — permission prompts would block the loop.
  // A future v2 could add runner modes (e.g. acceptEdits) via config.
  //
  const args = [
    "claude",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.runner.model,
    "-p",
    prompt,
  ];

  const proc = Bun.spawn(args, {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "ember" },
  });

  const [collected, stderr] = await Promise.all([
    collectStreamEvents(proc.stdout),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

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

// --- Stream processing ---

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
      const result = parseStreamEvent(line);
      if (!result) continue;
      ({ output, costUsd, durationMs } = applyEvent(result, output, costUsd, durationMs));
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim()) {
    const result = parseStreamEvent(buffer);
    if (result) {
      ({ output, costUsd, durationMs } = applyEvent(result, output, costUsd, durationMs));
    }
  }

  return { output, costUsd, durationMs };
}

function parseStreamEvent(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    // Expected: Claude streams non-JSON progress lines (e.g. "Thinking...")
    // that we intentionally skip. Only structured events matter.
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
