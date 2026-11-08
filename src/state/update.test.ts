import { beforeEach, describe, expect, it, vi } from "vitest";
import * as IntentLauncher from "expo-intent-launcher";
import {
  checkForAppUpdate,
  checkForUpstreamUpdate,
  checkForUpdate,
  clearIgnoredUpstreamUpdate,
  dismissUpstreamUpdate,
  fetchUpstreamLatest,
  getIgnoredUpstreamSha,
  getUpdate,
  IGNORED_UPSTREAM_KEY,
  ignoreUpstreamUpdate,
  installUpdate,
  isUpstreamCommitIntegrated,
  putOffUpdate,
  UPSTREAM_BASE_COMMIT,
} from "./update";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void storage.set(k, v),
    removeItem: async (k: string) => void storage.delete(k),
    clear: async () => void storage.clear(),
  },
}));

vi.mock("expo-device", () => ({
  supportedCpuArchitectures: ["arm64-v8a"],
}));

const { createDownloadTaskMock } = vi.hoisted(() => ({
  createDownloadTaskMock: vi.fn(() => ({
    downloadAsync: async () => ({ contentUri: "content://apk" }),
  })),
}));

vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "/cache" } },
  File: class {
    exists = false;
    delete() {}
    static createDownloadTask = createDownloadTaskMock;
  },
}));

vi.mock("expo-intent-launcher", () => ({
  startActivityAsync: vi.fn(),
  ActivityAction: {
    MANAGE_UNKNOWN_APP_SOURCES: "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
  },
}));

describe("update state (update.ts)", () => {
  beforeEach(async () => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("correctly identifies integrated upstream commits", () => {
    expect(isUpstreamCommitIntegrated("b369ad46ba2a0259582d408c1f3d909afb3a4b88")).toBe(true);
    expect(isUpstreamCommitIntegrated("b369ad4")).toBe(true);
    expect(isUpstreamCommitIntegrated("6fe93bf6d15fe021e6674abe59f7696ed5231d8f")).toBe(true);
    expect(isUpstreamCommitIntegrated("6fe93bf")).toBe(true);
    expect(isUpstreamCommitIntegrated("0000000000000000000000000000000000000000")).toBe(false);
  });

  it("identifies upstream is up to date when latest commit matches baseline commit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: UPSTREAM_BASE_COMMIT,
          commit: {
            message: "chore(scripts): export parity fixtures for the native port",
            author: { date: "2026-10-24T14:54:20Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${UPSTREAM_BASE_COMMIT}`,
        },
      ],
    } as unknown as Response);

    const update = await fetchUpstreamLatest();
    expect(update).toBeNull();
  });

  it("identifies upstream is up to date when latest commit is short SHA matching baseline", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: UPSTREAM_BASE_COMMIT.slice(0, 7),
          commit: {
            message: "chore(scripts): export parity fixtures for the native port",
            author: { date: "2026-10-24T14:54:20Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${UPSTREAM_BASE_COMMIT.slice(0, 7)}`,
        },
      ],
    } as unknown as Response);

    const update = await fetchUpstreamLatest();
    expect(update).toBeNull();
  });

  it("automatically clears ignoredUpstreamSha when it matches integrated baseline commit", async () => {
    storage.set(IGNORED_UPSTREAM_KEY, UPSTREAM_BASE_COMMIT);
    const sha = await getIgnoredUpstreamSha();
    expect(sha).toBeNull();
    expect(getUpdate().ignoredUpstreamSha).toBeNull();
    expect(storage.get(IGNORED_UPSTREAM_KEY)).toBeUndefined();
  });

  it("identifies new upstream updates when latest commit differs from baseline", async () => {
    const newSha = "abcdef1234567890abcdef1234567890abcdef12";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: newSha,
          commit: {
            message: "feat: exciting new upstream feature\n\nDetailed description",
            author: { date: "2026-11-04T12:00:00Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${newSha}`,
        },
      ],
    } as unknown as Response);

    const update = await fetchUpstreamLatest();
    expect(update).not.toBeNull();
    expect(update?.sha).toBe(newSha);
    expect(update?.shortSha).toBe("abcdef1");
    expect(update?.message).toBe("feat: exciting new upstream feature");
  });

  it("checkForUpstreamUpdate updates state and supports dismissal", async () => {
    const newSha = "1234567890abcdef1234567890abcdef12345678";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: newSha,
          commit: {
            message: "fix: resolve upstream sync issue",
            author: { date: "2026-11-04T12:00:00Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${newSha}`,
        },
      ],
    } as unknown as Response);

    const update = await checkForUpstreamUpdate(true);
    expect(update).not.toBeNull();
    expect(getUpdate().upstreamUpdate).toEqual(update);

    dismissUpstreamUpdate();
    expect(getUpdate().upstreamUpdate).toBeNull();
    expect(await getIgnoredUpstreamSha()).toBe(newSha);
  });

  it("supports ignoring upstream commit and resetting it", async () => {
    const newSha = "fedcba9876543210fedcba9876543210fedcba98";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: newSha,
          commit: {
            message: "feat: experimental upstream change",
            author: { date: "2026-11-04T12:00:00Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${newSha}`,
        },
      ],
    } as unknown as Response);

    // Initial check finds the update
    let update = await fetchUpstreamLatest();
    expect(update).not.toBeNull();
    expect(update?.sha).toBe(newSha);

    // Ignore the commit
    await ignoreUpstreamUpdate(newSha);
    expect(await getIgnoredUpstreamSha()).toBe(newSha);
    expect(getUpdate().ignoredUpstreamSha).toBe(newSha);

    // Subsequent check ignores this commit
    update = await fetchUpstreamLatest();
    expect(update).toBeNull();

    // Resetting ignored commit allows it to be discovered again
    await clearIgnoredUpstreamUpdate();
    expect(await getIgnoredUpstreamSha()).toBeNull();
    expect(getUpdate().ignoredUpstreamSha).toBeNull();

    update = await fetchUpstreamLatest();
    expect(update).not.toBeNull();
    expect(update?.sha).toBe(newSha);
  });

  it("checkForAppUpdate checks latest GitHub release and puts off with Later", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v9.9.9",
        html_url: "https://github.com/husainlab/Health-app/releases/tag/v9.9.9",
        assets: [
          {
            name: "Health-9.9.9.apk",
            browser_download_url: "https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk",
          },
        ],
      }),
    } as unknown as Response);

    const notice = await checkForAppUpdate(true);
    expect(notice).not.toBeNull();
    expect(notice?.version).toBe("9.9.9");
    expect(getUpdate().available?.version).toBe("9.9.9");

    putOffUpdate();
    expect(getUpdate().available).toBeNull();
  });

  it("checkForUpdate runs both checks in parallel", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    await expect(checkForUpdate(true)).resolves.not.toThrow();
  });

  it("handles network failure with network checkError", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
    } as unknown as Response);

    const notice = await checkForAppUpdate(true);
    expect(notice).toBeNull();
    expect(getUpdate().checkError).toBe("network");
  });

  it("downloads the update APK into cache without authorization headers", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: "v9.9.9",
          html_url: "https://github.com/husainlab/Health-app/releases/tag/v9.9.9",
          assets: [
            {
              name: "Health-9.9.9.apk",
              browser_download_url: "https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk",
            },
          ],
        },
      ],
    } as unknown as Response);

    const notice = await checkForAppUpdate(true);
    expect(notice?.apk).toBe("https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk");

    createDownloadTaskMock.mockClear();
    vi.mocked(IntentLauncher.startActivityAsync).mockClear();
    await installUpdate();
    expect(createDownloadTaskMock).toHaveBeenCalledWith(
      "https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk",
      expect.anything(),
      expect.objectContaining({
        onProgress: expect.any(Function),
      })
    );
    const lastCall = (createDownloadTaskMock.mock.calls as any[])[0];
    const callOptions = lastCall?.[2] as { headers?: Record<string, string> } | undefined;
    expect(callOptions?.headers).toBeUndefined();
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
      "android.intent.action.VIEW",
      expect.objectContaining({
        data: "content://apk",
        type: "application/vnd.android.package-archive",
        flags: 1 | 268435456,
      })
    );
  });

  it("attempts to open manage unknown app sources when installer intent fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v9.9.9",
        html_url: "https://github.com/husainlab/Health-app/releases/tag/v9.9.9",
        assets: [
          {
            name: "Health-9.9.9.apk",
            browser_download_url: "https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk",
          },
        ],
      }),
    } as unknown as Response);

    await checkForAppUpdate(true);
    vi.mocked(IntentLauncher.startActivityAsync).mockRejectedValueOnce(new Error("permission_denied"));

    await expect(installUpdate()).rejects.toThrow("permission_denied");
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
      "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
      expect.objectContaining({
        data: "package:in.portlabs.health",
      })
    );
    expect(getUpdate().progress).toBeNull();
  });

  it("falls back to repository tags when releases endpoint returns empty array", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/releases")) {
        return {
          status: 200,
          ok: true,
          json: async () => [],
        } as unknown as Response;
      }
      if (url.includes("/tags")) {
        return {
          status: 200,
          ok: true,
          json: async () => [{ name: "v9.9.9" }],
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    });

    const notice = await checkForAppUpdate(true);
    expect(notice).not.toBeNull();
    expect(notice?.version).toBe("9.9.9");
    expect(notice?.apk).toBe("https://raw.githubusercontent.com/husainlab/Health-app/main/Health-release.apk");
  });

  it("identifies no update when repository returns empty releases and tags arrays", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const notice = await checkForAppUpdate(true);
    expect(notice).toBeNull();
    expect(getUpdate().checkError).toBeNull();
    expect(getUpdate().available).toBeNull();
  });
});
