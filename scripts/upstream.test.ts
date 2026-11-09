import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cmdIgnore,
  cmdSync,
  loadConfig,
} from "./upstream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, "../src/upstream.json");

describe("upstream synchronization script (scripts/upstream.ts)", () => {
  let originalConfig: string;

  beforeEach(() => {
    originalConfig = fs.readFileSync(CONFIG_PATH, "utf8");
  });

  afterEach(() => {
    fs.writeFileSync(CONFIG_PATH, originalConfig, "utf8");
    vi.restoreAllMocks();
  });

  it("loads upstream config correctly", () => {
    const cfg = loadConfig();
    expect(cfg.repo).toBe("adityaongit/pulse-mobile");
    expect(typeof cfg.baseCommit).toBe("string");
    expect(Array.isArray(cfg.integratedCommits)).toBe(true);
  });

  it("cmdSync updates baseCommit and adds to integratedCommits", async () => {
    const testSha = "1111222233334444555566667777888899990000";
    await cmdSync(testSha);

    const updated = loadConfig();
    expect(updated.baseCommit).toBe(testSha);
    expect(updated.integratedCommits).toContain(testSha);
  });

  it("cmdIgnore adds SHA to ignoredCommits", () => {
    const ignoreSha = "aaaaabbbbbcccccdddddeeeeefffff0000011111";
    cmdIgnore(ignoreSha);

    const updated = loadConfig();
    expect(updated.ignoredCommits).toContain(ignoreSha);
  });

  it("cmdSync removes previously ignored commit from ignoredCommits", async () => {
    const testSha = "2222333344445555666677778888999900001111";
    cmdIgnore(testSha);
    let cfg = loadConfig();
    expect(cfg.ignoredCommits).toContain(testSha);

    await cmdSync(testSha);
    cfg = loadConfig();
    expect(cfg.baseCommit).toBe(testSha);
    expect(cfg.ignoredCommits).not.toContain(testSha);
  });
});
