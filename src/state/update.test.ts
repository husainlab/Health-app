import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForAppUpdate,
  checkForUpstreamUpdate,
  checkForUpdate,
  clearIgnoredUpstreamUpdate,
  dismissUpstreamUpdate,
  fetchUpstreamLatest,
  getGithubTokenLast4,
  getIgnoredUpstreamSha,
  getUpdate,
  ignoreUpstreamUpdate,
  installUpdate,
  putOffUpdate,
  setGithubToken,
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

const secureStorage = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secureStorage.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secureStorage.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secureStorage.delete(k)),
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

  it("handles private repository 404 with unauthorized checkError", async () => {
    await setGithubToken(null);
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    } as unknown as Response);

    const notice = await checkForAppUpdate(true);
    expect(notice).toBeNull();
    expect(getUpdate().checkError).toBe("unauthorized");
  });

  it("manages GitHub token and includes Authorization header for private repos", async () => {
    await setGithubToken("github_pat_1234567890abcdef");
    expect(await getGithubTokenLast4()).toBe("cdef");
    expect(getUpdate().hasGithubToken).toBe(true);

    let sentHeaders: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      sentHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "v9.9.9",
          html_url: "https://github.com/husainlab/Health-app/releases/tag/v9.9.9",
          assets: [
            {
              name: "Health-9.9.9.apk",
              url: "https://api.github.com/repos/husainlab/Health-app/releases/assets/999",
              browser_download_url: "https://github.com/husainlab/Health-app/releases/download/v9.9.9/Health-9.9.9.apk",
            },
          ],
        }),
      } as unknown as Response;
    });

    const notice = await checkForAppUpdate(true);
    expect(sentHeaders?.Authorization).toBe("Bearer github_pat_1234567890abcdef");
    expect(notice?.assetUrl).toBe("https://api.github.com/repos/husainlab/Health-app/releases/assets/999");

    // Test installUpdate with private asset URL & headers
    createDownloadTaskMock.mockClear();
    await installUpdate();
    expect(createDownloadTaskMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/husainlab/Health-app/releases/assets/999",
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github_pat_1234567890abcdef",
          Accept: "application/octet-stream",
          "User-Agent": "Health-App",
        }),
      })
    );
  });

  it("identifies no update when repository returns empty releases array", async () => {
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
