// Health's releases on GitHub (docs/releases.md), read for the in-app update notice (src/state/update.ts): the latest
// release's version and its APKs, one per CPU architecture, and which one a phone takes. Pure, so it is tested in Node.

/** Each CPU architecture Android reports (Build.SUPPORTED_ABIS) and the suffix of its APK in a release. */
export const ABI_ASSET: Record<string, string> = {
  "arm64-v8a": "arm64",
  "armeabi-v7a": "armv7",
  x86_64: "x86_64",
};

export type Release = { version: string; page: string; apks: Record<string, string>; assetUrls?: Record<string, string> };

type GithubRelease = { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
type GithubAsset = { name?: unknown; browser_download_url?: unknown; url?: unknown };

/** GitHub's "latest release" answer → the version and its APKs by suffix, or null for anything else. */
export function parseRelease(json: unknown): Release | null {
  const r = json as GithubRelease | null;
  if (!r || typeof r.tag_name !== "string" || typeof r.html_url !== "string" || r.draft === true || r.prerelease === true) return null;
  const version = r.tag_name.startsWith("v") ? r.tag_name.slice(1) : r.tag_name;
  if (!parseVersion(version)) return null;
  const apks: Record<string, string> = {};
  const assetUrls: Record<string, string> = {};
  for (const a of Array.isArray(r.assets) ? (r.assets as GithubAsset[]) : []) {
    if (typeof a.name !== "string" || typeof a.browser_download_url !== "string") continue;
    const apiUrl = typeof a.url === "string" ? a.url : undefined;
    // Direct matches: Health-<version>.apk takes precedence over Health-release.apk
    if (a.name === `Health-${version}.apk` || a.name === "Health.apk") {
      apks.default = a.browser_download_url;
      apks.arm64 = a.browser_download_url;
      if (apiUrl) {
        assetUrls.default = apiUrl;
        assetUrls.arm64 = apiUrl;
      }
      continue;
    }
    if (a.name === "Health-release.apk") {
      if (!apks.default) apks.default = a.browser_download_url;
      if (!apks.arm64) apks.arm64 = a.browser_download_url;
      if (apiUrl) {
        if (!assetUrls.default) assetUrls.default = apiUrl;
        if (!assetUrls.arm64) assetUrls.arm64 = apiUrl;
      }
      continue;
    }
    // Architecture-specific suffixes: Health-<version>-<suffix>.apk or pulse-mobile-<version>-<suffix>.apk
    const pulsePrefix = `pulse-mobile-${version}-`;
    const healthPrefix = `Health-${version}-`;
    if (a.name.startsWith(pulsePrefix) && a.name.endsWith(".apk")) {
      const suffix = a.name.slice(pulsePrefix.length, -".apk".length);
      apks[suffix] = a.browser_download_url;
      if (apiUrl) assetUrls[suffix] = apiUrl;
    } else if (a.name.startsWith(healthPrefix) && a.name.endsWith(".apk")) {
      const suffix = a.name.slice(healthPrefix.length, -".apk".length);
      apks[suffix] = a.browser_download_url;
      if (apiUrl) assetUrls[suffix] = apiUrl;
    }
  }
  return { version, page: r.html_url, apks, assetUrls };
}

/** "0.4.1" → [0, 4, 1]; null for anything that is not three whole numbers. */
function parseVersion(v: string): [number, number, number] | null {
  const parts = v.split(".");
  if (parts.length !== 3) return null;
  const digits = (p: string) => p.length > 0 && [...p].every((ch) => ch >= "0" && ch <= "9");
  return parts.every(digits) ? (parts.map(Number) as [number, number, number]) : null;
}

/** Whether `latest` is a later version than `current` (both "major.minor.patch"). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The APK for a phone: its first supported architecture (Android lists the preferred one first) that the release has. */
export function apkFor(release: Release, abis: readonly string[]): string | null {
  for (const abi of abis) {
    const suffix = ABI_ASSET[abi];
    const url = suffix && release.apks[suffix];
    if (url) return url;
  }
  return release.apks.default ?? null;
}

/** The GitHub API asset URL for private repository downloads (Accept: application/octet-stream). */
export function assetUrlFor(release: Release, abis: readonly string[]): string | null {
  if (!release.assetUrls) return null;
  for (const abi of abis) {
    const suffix = ABI_ASSET[abi];
    const url = suffix && release.assetUrls[suffix];
    if (url) return url;
  }
  return release.assetUrls.default ?? null;
}
