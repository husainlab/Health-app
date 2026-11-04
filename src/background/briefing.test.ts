import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNotificationInsight } from "./briefing";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void storage.set(k, v),
    removeItem: async (k: string) => void storage.delete(k),
    clear: async () => void storage.clear(),
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => "test-api-key"),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "Recovery is 60% with good sleep. Focus on steady pacing today." })),
}));

describe("generateNotificationInsight", () => {
  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("returns null if no AI consent is given", async () => {
    const insight = await generateNotificationInsight({
      type: "recovery",
      statsText: "60%: Yellow",
    });
    expect(insight).toBeNull();
  });

  it("generates an insight when setup and key exist", async () => {
    storage.set(
      "pulse.coach.setup",
      JSON.stringify({
        provider: "google",
        model: "gemini-3.5-flash",
        consent: true,
      })
    );

    const insight = await generateNotificationInsight({
      type: "recovery",
      statsText: "60%: Yellow · Sleep 7h 15m · HRV 48ms · Target 8-12%",
    });
    expect(insight).toBe("Recovery is 60% with good sleep. Focus on steady pacing today.");
  });
});
