// The in-app update notice. Once a day Health asks GitHub for its latest release and checks upstream open-source code,
// the only network requests it makes on its own, carrying nothing about the person (docs/releases.md).
// When a newer version of Health is out, Home and More show it; Update downloads the APK for this phone's CPU into
// the app's cache and hands it to Android's installer, which asks the person to confirm. Installing over the old version
// keeps the data, as long as the APK is signed with the same key.
// In addition, it checks if any updates have landed in the original upstream Pulse open-source repository.
// Settings › App turns the check off.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useSyncExternalStore } from "react";
import { apkFor, isNewer, parseRelease, type Release } from "@/lib/release";
import { APP_VERSION } from "@/queries/settings";

/** GitHub's latest-release endpoint for Health's repository. */
export const RELEASES_URL = "https://api.github.com/repos/husainlab/Health-app/releases/latest";

/** GitHub's commit endpoint for the original upstream open-source Pulse repository. */
export const UPSTREAM_COMMITS_URL = "https://api.github.com/repos/adityaongit/pulse-mobile/commits?per_page=1";

/** Upstream commit base that our Health app was forked from (Pulse mobile release v0.4.1). */
export const UPSTREAM_BASE_COMMIT = "6fe93bf6d15fe021e6674abe59f7696ed5231d8f";

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
/** The last check: when, and the release it found ({ checkedAt, release }). */
const CACHE_KEY = "health.update";
/** The last check for upstream code: when, and the upstream update info ({ checkedAt, update }). */
const UPSTREAM_CACHE_KEY = "health.update.upstream";
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

export type UpdateState = {
  /** Whether Health checks for updates. */
  enabled: boolean;
  /** A newer release with an APK for this phone, unless put off with "Later" in this session; null when there is none. */
  available: (Release & { apk: string }) | null;
  /** The download, while it runs: 0 to 1. */
  progress: number | null;
  /** An upstream update from the original open-source Pulse repo, if newer than our baseline; null otherwise. */
  upstreamUpdate: UpstreamUpdate | null;
};

let state: UpdateState = { enabled: true, available: null, progress: null, upstreamUpdate: null };
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

/** The release's notice for this phone: a later version than this one, with an APK for its CPU, not put off. */
function noticeFor(release: Release | null) {
  if (later || !release || !isNewer(release.version, APP_VERSION)) return null;
  const apk = apkFor(release, Device.supportedCpuArchitectures ?? []);
  return apk ? { ...release, apk } : null;
}

/** GitHub's latest release, or null when it cannot be read (offline, rate-limited): the next check tries again. */
async function fetchLatest(): Promise<Release | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" }, signal: ctl.signal });
    return res.ok ? parseRelease(await res.json()) : null;
  } catch {
    return null;
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
  try {
    const res = await fetch(UPSTREAM_COMMITS_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) return null;
    const c = json[0] as GithubCommit;
    if (typeof c.sha !== "string") return null;
    const sha = c.sha;
    // If the latest commit is the baseline commit, upstream has no new updates.
    if (sha.toLowerCase() === UPSTREAM_BASE_COMMIT.toLowerCase() || sha.startsWith(UPSTREAM_BASE_COMMIT.slice(0, 7))) {
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

/** Checks for new builds of Health app. */
export async function checkForAppUpdate(force = false): Promise<(Release & { apk: string }) | null> {
  if (force) later = false;
  const enabled = (await AsyncStorage.getItem(CHECK_KEY).catch(() => null)) !== "off";
  patch({ enabled });
  if (!enabled) {
    patch({ available: null });
    return null;
  }
  const cached = JSON.parse((await AsyncStorage.getItem(CACHE_KEY).catch(() => null)) ?? "null") as { checkedAt: number; release: Release | null } | null;
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) {
    const notice = noticeFor(cached.release);
    patch({ available: notice });
    return notice;
  }
  const release = await fetchLatest();
  if (release) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), release })).catch(() => {});
  const notice = noticeFor(release ?? cached?.release ?? null);
  patch({ available: notice });
  return notice;
}

/** Checks for updates in the original open-source Pulse repository. */
export async function checkForUpstreamUpdate(force = false): Promise<UpstreamUpdate | null> {
  if (force) upstreamDismissed = false;
  const enabled = (await AsyncStorage.getItem(CHECK_KEY).catch(() => null)) !== "off";
  if (!enabled) {
    patch({ upstreamUpdate: null });
    return null;
  }
  const cached = JSON.parse((await AsyncStorage.getItem(UPSTREAM_CACHE_KEY).catch(() => null)) ?? "null") as { checkedAt: number; update: UpstreamUpdate | null } | null;
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) {
    const notice = upstreamDismissed ? null : cached.update;
    patch({ upstreamUpdate: notice });
    return notice;
  }
  const update = await fetchUpstreamLatest();
  await AsyncStorage.setItem(UPSTREAM_CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), update })).catch(() => {});
  const notice = upstreamDismissed ? null : update;
  patch({ upstreamUpdate: notice });
  return notice;
}

/** Checks both app updates and upstream open-source updates. */
export async function checkForUpdate(force = false): Promise<void> {
  await Promise.all([checkForAppUpdate(force), checkForUpstreamUpdate(force)]);
}

export async function setUpdateCheck(on: boolean): Promise<void> {
  await AsyncStorage.setItem(CHECK_KEY, on ? "on" : "off");
  await checkForUpdate(on);
}

/** "Later": hides the app update notice until the app is next started. */
export function putOffUpdate(): void {
  later = true;
  patch({ available: null });
}

/** Dismisses the upstream open-source update notice for this session. */
export function dismissUpstreamUpdate(): void {
  upstreamDismissed = true;
  patch({ upstreamUpdate: null });
}

/** Downloads the APK into the cache and opens Android's installer on it. Throws when the download or the hand-off fails. */
export async function installUpdate(): Promise<void> {
  const u = state.available;
  if (!u || state.progress !== null) return;
  const file = new File(Paths.cache, `health-${u.version}.apk`);
  if (file.exists) file.delete();
  patch({ progress: 0 });
  try {
    const task = File.createDownloadTask(u.apk, file, { onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && patch({ progress: bytesWritten / totalBytes }) });
    const done = await task.downloadAsync();
    if (!done) throw new Error("download_paused");
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: done.contentUri, type: "application/vnd.android.package-archive", flags: GRANT_READ_URI });
  } finally {
    patch({ progress: null });
  }
}
