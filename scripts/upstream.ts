#!/usr/bin/env tsx
/**
 * Upstream synchronization and baseline management script for Health app.
 *
 * Commands:
 *   pnpm upstream sync [sha]          - Sync baseline to latest upstream commit (or specific SHA)
 *   pnpm upstream ignore <sha>        - Mark an upstream commit as ignored
 *   pnpm upstream check               - Check upstream status against current baseline
 *   pnpm upstream detect-and-sync     - Auto-detect upstream updates in recent git commit messages
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.resolve(__dirname, "../src/upstream.json");
const DEFAULT_REPO = "adityaongit/pulse-mobile";

export type UpstreamConfig = {
  repo: string;
  baseCommit: string;
  integratedCommits: string[];
  ignoredCommits: string[];
};

export type UpstreamCommitInfo = {
  sha: string;
  shortSha: string;
  message: string;
  date: string;
};

export function loadConfig(): UpstreamConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as UpstreamConfig;
  } catch {
    return {
      repo: DEFAULT_REPO,
      baseCommit: "",
      integratedCommits: [],
      ignoredCommits: [],
    };
  }
}

export function saveConfig(cfg: UpstreamConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export async function fetchLatestUpstreamCommit(repo = DEFAULT_REPO): Promise<UpstreamCommitInfo> {
  const url = `https://api.github.com/repos/${repo}/commits?per_page=1`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Health-App-Automation",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch upstream commits from GitHub (${res.status} ${res.statusText})`);
  }
  const json = (await res.json()) as { sha?: string; commit?: { message?: string; author?: { date?: string } } }[];
  if (!Array.isArray(json) || json.length === 0 || !json[0]?.sha) {
    throw new Error("Invalid GitHub commit response");
  }
  const first = json[0];
  const sha = first.sha!;
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: (first.commit?.message || "").split("\n")[0],
    date: first.commit?.author?.date || "",
  };
}

export async function fetchCommitBySha(repo: string, sha: string): Promise<UpstreamCommitInfo> {
  const url = `https://api.github.com/repos/${repo}/commits/${sha}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Health-App-Automation",
    },
  });
  if (!res.ok) {
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: `Upstream commit ${sha.slice(0, 7)}`,
      date: new Date().toISOString(),
    };
  }
  const json = (await res.json()) as { sha: string; commit?: { message?: string; author?: { date?: string } } };
  return {
    sha: json.sha,
    shortSha: json.sha.slice(0, 7),
    message: (json.commit?.message || "").split("\n")[0],
    date: json.commit?.author?.date || "",
  };
}

export async function cmdSync(targetSha?: string): Promise<{ updated: boolean; commit: UpstreamCommitInfo }> {
  const cfg = loadConfig();
  const repo = cfg.repo || DEFAULT_REPO;
  let commitInfo: UpstreamCommitInfo;

  if (targetSha && targetSha.trim()) {
    const cleanSha = targetSha.trim();
    try {
      commitInfo = await fetchCommitBySha(repo, cleanSha);
    } catch {
      commitInfo = {
        sha: cleanSha,
        shortSha: cleanSha.slice(0, 7),
        message: `Upstream commit ${cleanSha.slice(0, 7)}`,
        date: new Date().toISOString(),
      };
    }
  } else {
    console.log(`[upstream] Fetching latest commit from ${repo}...`);
    commitInfo = await fetchLatestUpstreamCommit(repo);
  }

  const sha = commitInfo.sha.toLowerCase();
  cfg.baseCommit = sha;

  if (!Array.isArray(cfg.integratedCommits)) cfg.integratedCommits = [];
  if (!cfg.integratedCommits.some((c) => c.toLowerCase() === sha || sha.startsWith(c.slice(0, 7).toLowerCase()))) {
    cfg.integratedCommits.push(sha);
  }

  if (Array.isArray(cfg.ignoredCommits)) {
    cfg.ignoredCommits = cfg.ignoredCommits.filter(
      (c) => c.toLowerCase() !== sha && !sha.startsWith(c.slice(0, 7).toLowerCase())
    );
  }

  saveConfig(cfg);
  console.log(`[upstream] Baseline updated to ${commitInfo.shortSha} ("${commitInfo.message}")`);
  return { updated: true, commit: commitInfo };
}

export function cmdIgnore(sha: string): { ignored: boolean; sha: string } {
  if (!sha || !sha.trim()) {
    console.error("[upstream] Error: Commit SHA required to ignore");
    process.exit(1);
  }
  const cleanSha = sha.trim().toLowerCase();
  const cfg = loadConfig();
  if (!Array.isArray(cfg.ignoredCommits)) cfg.ignoredCommits = [];

  if (!cfg.ignoredCommits.some((c) => c.toLowerCase() === cleanSha || cleanSha.startsWith(c.slice(0, 7).toLowerCase()))) {
    cfg.ignoredCommits.push(cleanSha);
  }

  saveConfig(cfg);
  console.log(`[upstream] Marked commit ${cleanSha.slice(0, 7)} as ignored in ${CONFIG_PATH}`);
  return { ignored: true, sha: cleanSha };
}

export async function cmdCheck(): Promise<{ status: string; latest?: UpstreamCommitInfo; error?: string }> {
  const cfg = loadConfig();
  const repo = cfg.repo || DEFAULT_REPO;
  console.log(`[upstream] Checking upstream status for repository ${repo}...`);
  console.log(`[upstream] Current baseline commit: ${cfg.baseCommit || "none"}`);

  try {
    const latest = await fetchLatestUpstreamCommit(repo);
    console.log(`[upstream] Latest upstream commit: ${latest.shortSha} ("${latest.message}")`);

    const latestLower = latest.sha.toLowerCase();
    const isBase = cfg.baseCommit && (cfg.baseCommit.toLowerCase() === latestLower || latestLower.startsWith(cfg.baseCommit.slice(0, 7).toLowerCase()));
    const isIntegrated = (cfg.integratedCommits || []).some(
      (c) => c.toLowerCase() === latestLower || latestLower.startsWith(c.slice(0, 7).toLowerCase())
    );
    const isIgnored = (cfg.ignoredCommits || []).some(
      (c) => c.toLowerCase() === latestLower || latestLower.startsWith(c.slice(0, 7).toLowerCase())
    );

    if (isBase || isIntegrated) {
      console.log(`[upstream] Result: UP TO DATE (commit is integrated into baseline).`);
      return { status: "up_to_date", latest };
    } else if (isIgnored) {
      console.log(`[upstream] Result: IGNORED (commit is in ignored list).`);
      return { status: "ignored", latest };
    } else {
      console.log(`[upstream] Result: NEW COMMIT AVAILABLE (${latest.shortSha}).`);
      return { status: "update_available", latest };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[upstream] Check failed: ${message}`);
    return { status: "error", error: message };
  }
}

export async function cmdDetectAndSync(customRange?: string): Promise<{ updated: boolean; action?: string; sha?: string }> {
  let gitMessages = "";
  try {
    if (customRange && customRange.trim()) {
      gitMessages = execSync(`git log ${customRange} --pretty=format:"%B" -n 20`, { encoding: "utf8" });
    } else {
      gitMessages = execSync('git log -n 5 --pretty=format:"%B"', { encoding: "utf8" });
    }
  } catch {
    gitMessages = "";
  }

  if (!gitMessages.trim()) {
    console.log("[upstream] No git commit messages found to analyze.");
    return { updated: false };
  }

  console.log("[upstream] Analyzing commit messages for upstream actions...");

  const ignoreMatch = gitMessages.match(/(?:ignore|skip)[\s_-]+(?:upstream[\s_-]+)?(?:commit[\s_-]+)?([0-9a-f]{7,40})/i);
  if (ignoreMatch) {
    const shaToIgnore = ignoreMatch[1];
    console.log(`[upstream] Detected upstream ignore request for commit ${shaToIgnore} in commit messages.`);
    cmdIgnore(shaToIgnore);
    return { updated: true, action: "ignore", sha: shaToIgnore };
  }

  const updatePatterns = [
    /(?:upstream|pulse-mobile|open[- ]?source|pulse)[\s\S]{0,40}(?:sync|update|integrate|bump|merge|pull)/i,
    /(?:sync|update|integrate|bump|merge|pull)[\s\S]{0,40}(?:upstream|pulse-mobile|open[- ]?source|pulse)/i,
  ];

  const hasUpdateKeyword = updatePatterns.some((pattern) => pattern.test(gitMessages));

  if (hasUpdateKeyword) {
    console.log("[upstream] Detected upstream update/sync intent in recent commit messages.");
    const shaMatch = gitMessages.match(/(?:commit\s*[:=]?\s*|[#@\s])([0-9a-f]{7,40})/i);
    const targetSha = shaMatch ? shaMatch[1] : undefined;

    if (targetSha && targetSha.length >= 7) {
      console.log(`[upstream] Found specific upstream SHA in commit log: ${targetSha}`);
      await cmdSync(targetSha);
      return { updated: true, action: "sync", sha: targetSha };
    } else {
      console.log("[upstream] No specific SHA specified in commit message; syncing to latest upstream HEAD...");
      await cmdSync();
      return { updated: true, action: "sync" };
    }
  }

  console.log("[upstream] No upstream update or ignore actions detected in recent commits.");
  return { updated: false };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const action = process.argv[2] || "check";
  const param = process.argv[3];

  void (async () => {
    try {
      switch (action) {
        case "sync":
          await cmdSync(param);
          break;
        case "ignore":
          cmdIgnore(param);
          break;
        case "check":
          await cmdCheck();
          break;
        case "detect-and-sync":
          await cmdDetectAndSync(param);
          break;
        default:
          console.error(`[upstream] Unknown command: ${action}`);
          console.error("Usage: tsx scripts/upstream.ts [sync|ignore|check|detect-and-sync] [param]");
          process.exit(1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[upstream] Error: ${message}`);
      process.exit(1);
    }
  })();
}
