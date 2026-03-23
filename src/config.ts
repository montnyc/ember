import path from "node:path";
import type { EmberConfig } from "./types";

export const DEFAULT_CONFIG: EmberConfig = {
  runner: {
    type: "claude",
    model: "sonnet",
  },
  loop: {
    maxReviewIterations: 3,
    maxAfkSlices: 10,
  },
  checks: {
    default: ["bun test", "bunx tsc --noEmit"],
  },
  // "ember": Ember owns all commits. The model is told not to commit, and
  //          Ember enforces this by resetting any model-created commits.
  //          Ember auto-commits after a successful gate.
  // "model": The model creates commits during the work phase. Ember skips
  //          auto-commit. Review diffs committed changes (HEAD..HEAD).
  commitPolicy: "ember",
};

export async function loadConfig(
  projectRoot: string
): Promise<EmberConfig> {
  const configPath = path.join(projectRoot, ".ember", "config.json");
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const userConfig = await file.json();
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch (error) {
    console.error(`Warning: corrupt .ember/config.json (${(error as Error).message}), using defaults`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

function mergeConfig(
  defaults: EmberConfig,
  overrides: Partial<EmberConfig>
): EmberConfig {
  return {
    runner: { ...defaults.runner, ...overrides.runner },
    loop: { ...defaults.loop, ...overrides.loop },
    checks: { ...defaults.checks, ...overrides.checks },
    commitPolicy: overrides.commitPolicy ?? defaults.commitPolicy,
  };
}

export async function writeDefaultConfig(
  projectRoot: string
): Promise<void> {
  const configPath = path.join(projectRoot, ".ember", "config.json");
  const file = Bun.file(configPath);

  if (await file.exists()) return;

  await Bun.write(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
}
