import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForAppUpdate,
  checkForUpstreamUpdate,
  checkForUpdate,
  dismissUpstreamUpdate,
  fetchUpstreamLatest,
  getUpdate,
  putOffUpdate,
  UPSTREAM_BASE_COMMIT,
} from "./update";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

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

vi.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "/cache" } },
  File: class {
    exists = false;
    delete() {}
    static createDownloadTask() {
      return { downloadAsync: async () => ({ contentUri: "content://apk" }) };
    }
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
});
