// The in-app update notice. Checks for newer Health builds and upstream Pulse open-source commits.
// Neither check is automatic: they run only on demand when the person taps "Check for updates" in Settings › App.
// For private repositories, authenticated release checks and APK downloads are supported via a GitHub Personal Access Token (PAT).
// Update downloads the APK for this phone's CPU into the app's cache and hands it to Android's installer.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { apkFor, assetUrlFor, isNewer, parseRelease, type Release } from "@/lib/release";
import { APP_VERSION } from "@/queries/settings";

/** GitHub's latest-release endpoint for Health's repository. */
export const RELEASES_URL = "https://api.github.com/repos/husainlab/Health-app/releases/latest";

/** GitHub's commit endpoint for the original upstream open-source Pulse repository. */
export const UPSTREAM_COMMITS_URL = "https://api.github.com/repos/adityaongit/pulse-mobile/commits?per_page=1";

/** Upstream commit base that our Health app was forked from (Pulse mobile release v0.4.1). */
export const UPSTREAM_BASE_COMMIT = "6fe93bf6d15fe021e6674abe59f7696ed5231d8f";

const TIMEOUT_MS = 15_000;
/** The last check: when, and the release it found ({ checkedAt, release }). */
const CACHE_KEY = "health.update";
/** The last check for upstream code: when, and the upstream update info ({ checkedAt, update }). */
const UPSTREAM_CACHE_KEY = "health.update.upstream";
/** Key for the upstream commit SHA the person chose to skip/ignore. */
export const IGNORED_UPSTREAM_KEY = "health.update.upstream_ignored";
/** SecureStore key for the GitHub Personal Access Token (for private repository updates). */
export const GITHUB_TOKEN_KEY = "pulse.github.token";
/** "off" when the person turned the check off. */
const CHECK_KEY = "health.update.check";
/** Android's FLAG_GRANT_READ_URI_PERMISSION: the installer may read the APK through Health's file provider. */
const GRANT_READ_URI = 1;

export type UpstreamUpdate = {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
  url: string;
};

export type UpdateCheckError = "unauthorized" | "network" | null;

export type AppNotice = Release & { apk: string; assetUrl?: string | null };

export type UpdateState = {
  /** Whether Health checks for updates. */
  enabled: boolean;
  /** A newer release with an APK for this phone, unless put off with "Later" in this session; null when there is none. */
  available: AppNotice | null;
  /** The download, while it runs: 0 to 1. */
  progress: number | null;
  /** An upstream update from the original open-source Pulse repo, if newer than our baseline; null otherwise. */
  upstreamUpdate: UpstreamUpdate | null;
  /** Upstream commit SHA that the user chose to skip/ignore. */
  ignoredUpstreamSha: string | null;
  /** Whether a GitHub token is configured. */
  hasGithubToken: boolean;
  /** Error from the last manual check. */
  checkError: UpdateCheckError;
};

let state: UpdateState = {
  enabled: true,
  available: null,
  progress: null,
  upstreamUpdate: null,
  ignoredUpstreamSha: null,
  hasGithubToken: false,
  checkError: null,
};

/** "Later" lasts until the app is next started: there is no skipping a version. */
let later = false;
let upstreamDismissed = false;
const listeners = new Set<() => void>();
const patch = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const getUpdate = () => state;

/** Retrieves the GitHub Personal Access Token from hardware-backed SecureStore or build environment. */
export async function getGithubToken(): Promise<string | null> {
  try {
    const saved = await SecureStore.getItemAsync(GITHUB_TOKEN_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // fallback
  }
  const envToken = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
  return envToken && envToken.trim() ? envToken.trim() : null;
}

/** Last 4 characters of the GitHub token for safe display in settings. */
export async function getGithubTokenLast4(): Promise<string | null> {
  const token = await getGithubToken();
  if (!token) return null;
  return token.length > 4 ? token.slice(-4) : token;
}

/** Sets or clears the GitHub token in hardware-backed SecureStore. */
export async function setGithubToken(token: string | null): Promise<void> {
  const clean = token?.trim();
  if (clean) {
    await SecureStore.setItemAsync(GITHUB_TOKEN_KEY, clean);
  } else {
    await SecureStore.deleteItemAsync(GITHUB_TOKEN_KEY);
  }
  const effective = await getGithubToken();
  patch({ hasGithubToken: !!effective });
}

/** Retrieves the upstream commit SHA that the user chose to skip/ignore on this device. */
export async function getIgnoredUpstreamSha(): Promise<string | null> {
  const sha = await AsyncStorage.getItem(IGNORED_UPSTREAM_KEY).catch(() => null);
  if (state.ignoredUpstreamSha !== sha) {
    patch({ ignoredUpstreamSha: sha });
  }
  return sha;
}

/** Marks an upstream commit as skipped/ignored on this device. */
export async function ignoreUpstreamUpdate(sha: string): Promise<void> {
  patch({ upstreamUpdate: null, ignoredUpstreamSha: sha });
  await AsyncStorage.setItem(IGNORED_UPSTREAM_KEY, sha).catch(() => {});
}

/** Clears the ignored upstream commit so it can be re-evaluated against the baseline. */
export async function clearIgnoredUpstreamUpdate(): Promise<void> {
  patch({ ignoredUpstreamSha: null });
  await AsyncStorage.removeItem(IGNORED_UPSTREAM_KEY).catch(() => {});
}

/** The release's notice for this phone: a later version than this one, with an APK for its CPU, not put off. */
function noticeFor(release: Release | null): AppNotice | null {
  if (later || !release || !isNewer(release.version, APP_VERSION)) return null;
  const abis = Device.supportedCpuArchitectures ?? [];
  const apk = apkFor(release, abis);
  const assetUrl = assetUrlFor(release, abis);
  return apk ? { ...release, apk, assetUrl } : null;
}

/** GitHub's latest release, with optional Bearer token authentication for private repositories. */
async function fetchLatest(): Promise<{ release: Release | null; error: UpdateCheckError }> {
  const token = await getGithubToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(RELEASES_URL, { headers, signal: ctl.signal });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return { release: null, error: "unauthorized" };
    }
    if (!res.ok) {
      return { release: null, error: "network" };
    }
    const json = (await res.json()) as unknown;
    const release = parseRelease(Array.isArray(json) ? json[0] : json);
    return { release, error: null };
  } catch {
    return { release: null, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

type GithubCommit = {
  sha?: unknown;
  html_url?: unknown;
  commit?: {
    message?: unknown;
    author?: { date?: unknown };
  };
};

/** Checks GitHub for upstream Pulse commits to see if new open-source code has landed. */
export async function fetchUpstreamLatest(): Promise<UpstreamUpdate | null> {
  const token = await getGithubToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(UPSTREAM_COMMITS_URL, {
      headers,
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) return null;
    const c = json[0] as GithubCommit;
    if (typeof c.sha !== "string") return null;
    const sha = c.sha;
    const ignoredSha = await getIgnoredUpstreamSha();
    // If the latest commit is the baseline commit or has been skipped/ignored, upstream has no new updates.
    if (
      sha.toLowerCase() === UPSTREAM_BASE_COMMIT.toLowerCase() ||
      sha.startsWith(UPSTREAM_BASE_COMMIT.slice(0, 7)) ||
      (ignoredSha && (sha.toLowerCase() === ignoredSha.toLowerCase() || sha.startsWith(ignoredSha.slice(0, 7))))
    ) {
      return null;
    }
    const shortSha = sha.slice(0, 7);
    const message = typeof c.commit?.message === "string" ? c.commit.message.split("\n")[0] : "";
    const date = typeof c.commit?.author?.date === "string" ? c.commit.author.date : "";
    const url = typeof c.html_url === "string" ? c.html_url : `https://github.com/adityaongit/pulse-mobile/commit/${sha}`;
    return { sha, shortSha, date, message, url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Checks for new builds of Health app on demand (never automatic). */
export async function checkForAppUpdate(force = false): Promise<AppNotice | null> {
  if (force) later = false;
  patch({ checkError: null });
  const { release, error } = await fetchLatest();
  if (error) {
    patch({ checkError: error });
    return null;
  }
  if (release) {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), release })).catch(() => {});
  }
  const notice = noticeFor(release);
  patch({ available: notice, checkError: null });
  return notice;
}

/** Checks for updates in the original open-source Pulse repository on demand (never automatic). */
export async function checkForUpstreamUpdate(force = false): Promise<UpstreamUpdate | null> {
  if (force) upstreamDismissed = false;
  const update = await fetchUpstreamLatest();
  if (update) {
    await AsyncStorage.setItem(UPSTREAM_CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), update })).catch(() => {});
  }
  const notice = upstreamDismissed ? null : update;
  patch({ upstreamUpdate: notice });
  return notice;
}

/** Checks both app updates and upstream open-source updates on demand. */
export async function checkForUpdate(force = false): Promise<void> {
  await Promise.all([checkForAppUpdate(force), checkForUpstreamUpdate(force)]);
}

export async function setUpdateCheck(on: boolean): Promise<void> {
  await AsyncStorage.setItem(CHECK_KEY, on ? "on" : "off");
  patch({ enabled: on });
}

/** "Later": hides the app update notice until the app is next started. */
export function putOffUpdate(): void {
  later = true;
  patch({ available: null });
}

/** Dismisses the upstream open-source update notice and permanently ignores this commit on this device. */
export function dismissUpstreamUpdate(): void {
  upstreamDismissed = true;
  const current = state.upstreamUpdate;
  patch({ upstreamUpdate: null });
  if (current) {
    void ignoreUpstreamUpdate(current.sha);
  }
}

/** Downloads the APK into the cache and opens Android's installer on it. Supports private repo asset authorization. */
export async function installUpdate(): Promise<void> {
  const u = state.available;
  if (!u || state.progress !== null) return;
  const token = await getGithubToken();
  const file = new File(Paths.cache, `health-${u.version}.apk`);
  if (file.exists) file.delete();
  patch({ progress: 0 });

  // For private repositories, download via GitHub API asset endpoint with Authorization header.
  // For public repositories, use browser_download_url.
  const downloadUrl = token && u.assetUrl ? u.assetUrl : u.apk;
  const headers: Record<string, string> = {};
  if (token && u.assetUrl) {
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = "application/octet-stream";
  }

  try {
    const task = File.createDownloadTask(downloadUrl, file, {
      headers: Object.keys(headers).length ? headers : undefined,
      onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && patch({ progress: bytesWritten / totalBytes }),
    });
    const done = await task.downloadAsync();
    if (!done) throw new Error("download_paused");
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: done.contentUri,
      type: "application/vnd.android.package-archive",
      flags: GRANT_READ_URI,
    });
  } finally {
    patch({ progress: null });
  }
}
