import { Glob } from "bun";
import path from "node:path";
import type { ParsedCriterion, ParsedPrd, Priority } from "./types";

const DEFAULT_PRD_DIR = "docs/prd";

export function parsePrdFile(content: string, filename: string): ParsedPrd {
  const basename = path.basename(filename);
  const id = basename.match(/^(\d+)/)?.[1] ?? "";

  const titleMatch = content.match(/^#\s+(?:PRD\s+\d+:\s*)?(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? basename;

  const criteria = parseAcceptanceCriteria(content);
  const dependsOn = parseDependsOn(content);
  const priority = parsePriority(content);

  return { id, filename: basename, title, dependsOn, priority, criteria };
}

export function parseAcceptanceCriteria(content: string): ParsedCriterion[] {
  const section = extractSection(content, "Acceptance Criteria");
  if (!section) return [];

  const criteria: ParsedCriterion[] = [];
  for (const line of section.split("\n")) {
    const match = line.match(/^\s*-\s+\[([ x])\]\s+(AC-\d+)\s+(.+)$/);
    if (match) {
      criteria.push({
        id: match[2],
        text: match[3].trim(),
        checked: match[1] === "x",
      });
    }
  }
  return criteria;
}

export function parseDependsOn(content: string): string[] {
  const match = content.match(/^Depends-On:\s*(.+)$/m);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+/.test(s))
    .map((s) => s.match(/^(\d+)/)?.[1] ?? "")
    .filter(Boolean);
}

export function parsePriority(content: string): Priority {
  const match = content.match(/^Priority:\s*(.+)$/m);
  if (!match) return "normal";

  const value = match[1].trim().toLowerCase();
  if (value === "high" || value === "low") return value;
  return "normal";
}

function extractSection(content: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "mi");
  const match = pattern.exec(content);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextSection = content.indexOf("\n## ", start);
  return nextSection === -1
    ? content.slice(start)
    : content.slice(start, nextSection);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function parseAllPrds(prdDir = DEFAULT_PRD_DIR): Promise<ParsedPrd[]> {
  const glob = new Glob("*.md");
  const fullDir = path.resolve(prdDir);
  const files: string[] = [];

  for await (const file of glob.scan(fullDir)) {
    if (/^\d+/.test(file)) {
      files.push(file);
    }
  }

  files.sort();

  const prds: ParsedPrd[] = [];
  for (const file of files) {
    const content = await Bun.file(path.join(fullDir, file)).text();
    prds.push(parsePrdFile(content, file));
  }

  return prds;
}
