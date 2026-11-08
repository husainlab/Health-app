// The in-app update notice. Checks for newer Health builds and upstream Pulse open-source commits.
// Neither check is automatic: they run only on demand when the person taps "Check for updates" in Settings › App.
// Update downloads the APK for this phone's CPU into the app's cache and hands it to Android's installer.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useSyncExternalStore } from "react";
import { apkFor, isNewer, parseRelease, type Release } from "@/lib/release";
import { APP_VERSION } from "@/queries/settings";

/** GitHub's latest-release endpoint for Health's repository. Uses releases list to reliably detect empty releases. */
export const RELEASES_URL = "https://api.github.com/repos/husainlab/Health-app/releases?per_page=1";

/** GitHub's tags endpoint for Health's repository (used as fallback if releases are not published). */
export const TAGS_URL = "https://api.github.com/repos/husainlab/Health-app/tags?per_page=1";

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
/** "off" when the person turned the check off. */
const CHECK_KEY = "health.update.check";
/** Android's FLAG_GRANT_READ_URI_PERMISSION (1) | FLAG_ACTIVITY_NEW_TASK (0x10000000 = 268435456). */
const GRANT_READ_URI = 1;
const FLAG_ACTIVITY_NEW_TASK = 268435456;
const INSTALL_FLAGS = GRANT_READ_URI | FLAG_ACTIVITY_NEW_TASK;

export type UpstreamUpdate = {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
  url: string;
};

export type UpdateCheckError = "network" | null;

export type AppNotice = Release & { apk: string };

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
  /** Error from the last manual check. */
  checkError: UpdateCheckError;
};

let state: UpdateState = {
  enabled: true,
  available: null,
  progress: null,
  upstreamUpdate: null,
  ignoredUpstreamSha: null,
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
  return apk ? { ...release, apk } : null;
}

/** GitHub's latest release from Health's public repository. */
async function fetchLatest(): Promise<{ release: Release | null; error: UpdateCheckError }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Health-App",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const res = await fetch(RELEASES_URL, { headers, signal: ctl.signal });
    if (!res.ok) {
      return { release: null, error: "network" };
    }
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) {
      if (json.length > 0) {
        const release = parseRelease(json[0]);
        if (release) return { release, error: null };
      }
    } else {
      const release = parseRelease(json);
      if (release) return { release, error: null };
    }

    // Fallback: if no release is found in releases endpoint, check tags and point to repo release APK
    try {
      const tagsRes = await fetch(TAGS_URL, { headers, signal: ctl.signal });
      if (tagsRes.ok) {
        const tagsJson = (await tagsRes.json()) as unknown;
        if (Array.isArray(tagsJson) && tagsJson.length > 0 && typeof tagsJson[0]?.name === "string") {
          const tagName = tagsJson[0].name;
          const version = tagName.startsWith("v") ? tagName.slice(1) : tagName;
          const fallbackRelease: Release = {
            version,
            page: `https://github.com/husainlab/Health-app/releases/tag/${tagName}`,
            apks: {
              default: "https://raw.githubusercontent.com/husainlab/Health-app/main/Health-release.apk",
              arm64: "https://raw.githubusercontent.com/husainlab/Health-app/main/Health-release.apk",
            },
          };
          return { release: fallbackRelease, error: null };
        }
      }
    } catch {
      // ignore fallback error
    }

    return { release: null, error: null };
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
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Health-App",
    "X-GitHub-Api-Version": "2022-11-28",
  };
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

/** Downloads the APK into the cache and opens Android's installer on it. */
export async function installUpdate(): Promise<void> {
  const u = state.available;
  if (!u || state.progress !== null) return;
  const file = new File(Paths.cache, `health-${u.version}.apk`);
  try {
    if (file.exists) file.delete();
  } catch {
    // Ignore error if file does not exist or cannot be deleted yet
  }
  patch({ progress: 0 });

  try {
    const task = File.createDownloadTask(u.apk, file, {
      onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && patch({ progress: bytesWritten / totalBytes }),
    });
    const done = await task.downloadAsync();
    if (!done) throw new Error("download_paused");
    const contentUri = done.contentUri ?? (done as { uri?: string }).uri;
    if (!contentUri) throw new Error("apk_uri_missing");

    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: "application/vnd.android.package-archive",
        flags: INSTALL_FLAGS,
      });
    } catch (launchErr) {
      // If direct package installer intent fails (e.g. unknown sources not allowed), guide user
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
          data: "package:in.portlabs.health",
        });
      } catch {
        // Ignore fallback error
      }
      throw launchErr;
    }
  } finally {
    patch({ progress: null });
  }
}
