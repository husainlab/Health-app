import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForAppUpdate,
  checkForUpstreamUpdate,
  checkForUpdate,
  clearIgnoredUpstreamUpdate,
  dismissUpstreamUpdate,
  fetchUpstreamLatest,
  getIgnoredUpstreamSha,
  getUpdate,
  ignoreUpstreamUpdate,
  installUpdate,
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
}));

describe("update state (update.ts)", () => {
  beforeEach(async () => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("identifies upstream is up to date when latest commit matches baseline commit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          sha: UPSTREAM_BASE_COMMIT,
          commit: {
            message: "fix: include sleep and naps in expanded activities",
            author: { date: "2026-10-26T06:31:52Z" },
          },
          html_url: `https://github.com/adityaongit/pulse-mobile/commit/${UPSTREAM_BASE_COMMIT}`,
        },
      ],
    } as unknown as Response);

    const update = await fetchUpstreamLatest();
    expect(update).toBeNull();
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
