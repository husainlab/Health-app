// Pulse Mobile's extras on halo's queries, over the 180-day demo seed.
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "./ctx";
import { getNap, getRecoveryExtras, getSleepExtras } from "./mobileExtras";
import { getSleep } from "./sleep";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
let store: MemoryStore;
let ctx: QueryCtx;

beforeAll(async () => {
  store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: { lastSyncTs: NOW, firstDay: addDays(TODAY, -179), lastError: null } };
}, 120_000);

describe("getRecoveryExtras", () => {
  it("gives the four rows against the prior 30 days, each opening its Trend View, and chips from the day before", async () => {
    const day = addDays(TODAY, -1);
    const { summary, behaviors } = await getRecoveryExtras(day, ctx);
    expect(summary.map((k) => k.key)).toEqual(["hrv", "rhr", "resp", "sleep"]);
    for (const k of summary) expect(k.href).toBe(`/trend/${k.key}`);
    expect(summary[0].average).toBeGreaterThan(0);
    for (const c of behaviors) expect(["up", "down", "neutral"]).toContain(c.effect);
  });
});

describe("getSleepExtras", () => {
  it("gives restorative minutes and the efficiency card, with wake spells inside the night", async () => {
    const day = addDays(TODAY, -1);
    const sleep = await getSleep(day, ctx);
    expect(sleep.summary.map((s) => s.key)).toContain("debt");
    const { restorative, efficiency } = await getSleepExtras(day, ctx, sleep.stages);
    expect(restorative.value!.minutes).toBeGreaterThan(0);
    const e = efficiency.value!;
    expect(e.pct).toBeGreaterThan(0);
    expect(e.pct).toBeLessThanOrEqual(100);
    for (const w of e.wakes) {
      expect(w.at).toBeGreaterThan(0);
      expect(w.at + w.width).toBeLessThanOrEqual(1);
    }
  });
});

describe("getNap", () => {
  it("opens a nap and refuses a main sleep or an unknown id", async () => {
    const sessions = await store.allSessions();
    const main = sessions.find((s) => s.isMain)!;
    expect(await getNap(main.id, ctx)).toBeNull();
    expect(await getNap("nope", ctx)).toBeNull();
    const nap = sessions.find((s) => !s.isMain);
    if (nap) expect((await getNap(nap.id, ctx))!.hours.value!.asleepMin).toBeGreaterThan(0);
  });
});

describe("getSleep circadian", () => {
  it("returns circadian score, phase, and timing on calibrated days of the 180-day seed", async () => {
    const vm = await getSleep(addDays(TODAY, -1), ctx);
    expect(vm.circadian.reason).toBeNull();
    expect(vm.circadian.value).not.toBeNull();
    const c = vm.circadian.value!;
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(100);
    expect(["aligned", "shifted_late", "shifted_early", "irregular"]).toContain(c.phase);
    expect(c.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(c.consistencyScore).toBeLessThanOrEqual(100);
    expect(c.sleepOnsetMin).not.toBeNull();
    expect(c.sleepOnsetMin!).toBeGreaterThanOrEqual(0);
    expect(c.sleepOnsetMin!).toBeLessThan(1440);
    expect(c.sleepMidMin).not.toBeNull();
    expect(c.sleepMidMin!).toBeGreaterThanOrEqual(0);
    expect(c.sleepMidMin!).toBeLessThan(1440);
    if (c.hrNadirOffsetH !== null) {
      expect(Number.isFinite(c.hrNadirOffsetH)).toBe(true);
    }
  });

  it("reports calibrating during the initial 7-night baseline window", async () => {
    const vm = await getSleep(addDays(TODAY, -179), ctx);
    expect(vm.circadian.value).toBeNull();
    expect(vm.circadian.reason).toBe("calibrating");
  });

  it("reports an honest reason when no sleep session exists", async () => {
    const emptyCtx: QueryCtx = { ...ctx, store: new MemoryStore() };
    const vm = await getSleep(TODAY, emptyCtx);
    expect(vm.circadian.value).toBeNull();
    expect(vm.circadian.reason).not.toBeNull();
  });
});
