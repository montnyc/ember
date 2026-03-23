import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadConfig, DEFAULT_CONFIG } from "../config";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), "ember-config-"));
  await Bun.$`mkdir -p ${path.join(testDir, ".ember")}`.quiet();
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("returns defaults when no config file exists", async () => {
    const config = await loadConfig(testDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("merges partial config with defaults", async () => {
    const partial = {
      runner: { model: "opus" },
      loop: { maxAfkSlices: 20 },
    };
    await Bun.write(
      path.join(testDir, ".ember", "config.json"),
      JSON.stringify(partial)
    );

    const config = await loadConfig(testDir);
    expect(config.runner.model).toBe("opus");
    expect(config.runner.type).toBe("claude"); // from defaults
    expect(config.loop.maxAfkSlices).toBe(20);
    expect(config.loop.maxReviewIterations).toBe(3); // from defaults
    expect(config.checks).toEqual(DEFAULT_CONFIG.checks); // untouched
  });

  test("returns defaults for corrupt config", async () => {
    await Bun.write(
      path.join(testDir, ".ember", "config.json"),
      "not json"
    );
    const config = await loadConfig(testDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
