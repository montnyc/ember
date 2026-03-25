import path from "node:path";
import { appendFile } from "node:fs/promises";

/**
 * Append a progress entry after each slice. This gives the next Claude session
 * a narrative of what happened — not just "AC-003: done" but "I migrated
 * Overview.tsx, had to update import paths, build passes."
 *
 * Inspired by Anthropic's "claude-progress.txt" pattern from their harness
 * design blog.
 */
export async function appendProgress(
  projectRoot: string,
  sliceId: string,
  summary: string
): Promise<void> {
  const progressPath = path.join(projectRoot, ".ember", "progress.txt");
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const entry = `[${timestamp}] ${sliceId}: ${summary}\n`;

  await appendFile(progressPath, entry);
}

/**
 * Read the progress file content, or return empty string if it doesn't exist.
 */
export async function readProgress(projectRoot: string): Promise<string> {
  const progressPath = path.join(projectRoot, ".ember", "progress.txt");
  const file = Bun.file(progressPath);
  if (!(await file.exists())) return "";
  const content = await file.text();
  // Only return last 50 lines to keep context manageable
  const lines = content.trim().split("\n");
  return lines.slice(-50).join("\n");
}
