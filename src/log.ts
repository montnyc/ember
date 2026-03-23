import path from "node:path";
import { appendFile } from "node:fs/promises";

export interface LogEvent {
  timestamp: string;
  type: string;
  sliceId?: string;
  data: unknown;
}

export interface RunLogger {
  append(event: LogEvent): Promise<void>;
  close(): Promise<void>;
}

export function createRunLog(
  projectRoot: string,
  runId: string
): RunLogger {
  const logPath = path.join(projectRoot, ".ember", "runs", `${runId}.jsonl`);

  return {
    async append(event: LogEvent): Promise<void> {
      const line = JSON.stringify(event) + "\n";
      await appendFile(logPath, line);
    },
    async close(): Promise<void> {
      // No-op for now; could flush buffers if we add buffering later
    },
  };
}
