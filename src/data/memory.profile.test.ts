// The profile's name and photo path, on the in-memory store (db.ts mirrors them in its name and photo columns).
import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./memory";
import type { Profile } from "./types";

const base: Profile = { birthDate: "1990-05-01", sex: "female", maxHr: null, heightCm: 170, timeZone: "Asia/Kolkata" };

describe("profile name and photo", () => {
  it("round-trips, clears and goes with clearAll", async () => {
    const store = await openMemoryStore();
    await store.setProfile({ ...base, name: "Asha Rao", photo: "file:///data/avatar/1.jpg" });
    expect(await store.getProfile()).toMatchObject({ name: "Asha Rao", photo: "file:///data/avatar/1.jpg" });
    await store.setProfile({ ...base, name: "Asha Rao", photo: null });
    expect((await store.getProfile())?.photo).toBeNull();
    await store.clearAll();
    expect(await store.getProfile()).toBeNull();
  });
});
