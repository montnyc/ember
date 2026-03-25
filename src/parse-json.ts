/**
 * Extract a JSON object from LLM output that may contain markdown fences,
 * prose wrapping, or other non-JSON text. Used by both gate.ts and evaluator.ts.
 */
export function extractJsonFromOutput(output: string): string {
  let str = output.trim();

  // Strip markdown code fences if present
  const fenceMatch = str.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Models sometimes wrap JSON in prose. Use a greedy match to find the
  // outermost { ... } block. Safe because LLM output should contain
  // exactly one top-level JSON object; nested braces are part of it.
  if (!str.startsWith("{")) {
    const objMatch = str.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0];
  }

  return str;
}

/**
 * Parse a JSON string into an object, throwing a descriptive error on failure.
 */
export function parseJsonObject(jsonStr: string, context: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse ${context} JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${context} is not an object`);
  }

  return parsed as Record<string, unknown>;
}
