// Health Monitor's view over the 180-day demo seed: each vital's number, status and the count agree.
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { BloodPressureReading, Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { emptyMetrics } from "@/data/types";
import { runPipeline } from "@/pipeline";
import { emptyScoreRow } from "@/pipeline/stage1";
import type { ScoreRow } from "@/data/store";
import type { QueryCtx } from "./ctx";
import { getFitness, getHealthHub, getMetabolicRisk, getMonitor, getStress } from "./health";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
let ctx: QueryCtx;

beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  // The day's own readings drift from the night values Recovery read (as Health Connect's daily records do): the screen
  // must still show the value the monitor judged.
  const metrics = await store.allMetrics();
  await store.upsertMetrics(metrics.map((m) => ({ ...m, respBpm: m.respBpm == null ? null : m.respBpm + 4, hrvMs: m.hrvMs == null ? null : m.hrvMs * 2 })));
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: { lastSyncTs: NOW, firstDay: addDays(TODAY, -179), lastError: null } };
}, 120_000);

describe("getMonitor", () => {
  it("judges the number it shows: a vital's status matches its value against its range, and the count matches the statuses", async () => {
    for (let k = 0; k < 90; k++) {
      const vm = await getMonitor(addDays(TODAY, -k), ctx);
      for (const v of vm.vitals) {
        if (v.status === "no_data" || !v.range || v.metric.value === null) continue;
        const within = v.metric.value >= v.range.low && v.metric.value <= v.range.high;
        expect(within, `${vm.day} ${v.key}: ${v.metric.value} against [${v.range.low}, ${v.range.high}] is ${v.status}`).toBe(v.status === "in_range");
      }
      if (vm.count.value) {
        expect(vm.count.value.inRange).toBe(vm.vitals.filter((v) => v.status === "in_range").length);
        expect(vm.count.value.outOfRange).toBe(vm.vitals.filter((v) => v.status === "high" || v.status === "low").length);
      }
    }
  });
});

async function makeCtx(store: MemoryStore, today = "2026-05-15"): Promise<QueryCtx> {
  return {
    store,
    timeZone: "UTC",
    profile: { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: "UTC" },
    today,
    now: Date.parse(`${today}T12:00:00Z`) / 1000,
    sync: await store.getSyncState(),
  };
}

function makeReading(
  id: string,
  day: string,
  timeStr: string,
  sys: number,
  dia: number,
): BloodPressureReading {
  return {
    id,
    day,
    ts: Date.parse(`${day}T${timeStr}Z`) / 1000,
    systolicMmhg: sys,
    diastolicMmhg: dia,
    bodyPosition: "sitting",
    measurementLocation: "left_upper_arm",
    quality: "direct",
    importedAt: Date.now() / 1000,
  };
}

describe("getMonitor with blood pressure", () => {
  it("includes blood pressure as 6th vital and attaches bloodPressure summary", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-1", "2026-05-15", "08:15:00", 118, 76);
    await store.upsertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    // 5 vitals: resp, restingHr, hrv, skinTempDev, bp
    expect(vm.vitals).toHaveLength(5);
    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital).toBeDefined();
    expect(bpVital?.label).toBe("Blood pressure");
    expect(bpVital?.short).toBe("BP");
    expect(bpVital?.unit).toBe("mmHg");
    expect(bpVital?.customValue).toBe("118/76");
    expect(bpVital?.status).toBe("in_range");
    expect(bpVital?.chip).toEqual({ tone: "optimal", text: "Normal" });
    expect(bpVital?.caption).toBe("Based on one reading");
    expect(bpVital?.bp).toEqual({
      systolic: 118,
      diastolic: 76,
      category: "normal",
    });

    // Summary attached to monitor
    expect(vm.bloodPressure).toBeDefined();
    expect(vm.bloodPressure.latest.value).toMatchObject({
      id: "bp-1",
      systolic: 118,
      diastolic: 76,
      category: "normal",
      time: "08:15",
    });
  });

  it("handles elevated or hypertension stages with appropriate chips and status", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-stage2", "2026-05-15", "14:00:00", 145, 92);
    await store.upsertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("high");
    expect(bpVital?.chip).toEqual({ tone: "alert", text: "Stage 2" });
    expect(bpVital?.bp?.category).toBe("stage2");
  });

  it("drops the one-reading note when the day has more than one reading", async () => {
    const store = new MemoryStore();
    await store.upsertBloodPressure([makeReading("bp-a", "2026-05-15", "08:00:00", 118, 76), makeReading("bp-b", "2026-05-15", "20:00:00", 122, 79)]);

    const vm = await getMonitor("2026-05-15", await makeCtx(store, "2026-05-15"));

    expect(vm.vitals.find((v) => v.key === "bp")?.caption).toBeUndefined();
  });

  it("shows prior reading chip when current day has no reading but prior exists", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-prior", "2026-05-10", "11:00:00", 124, 78);
    await store.upsertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("no_data");
    expect(bpVital?.customValue).toBeUndefined();
    expect(bpVital?.chip).toEqual({ tone: "neutral", text: "Prior: 124/78" });
    expect(bpVital?.bp).toBeNull();
  });
});

describe("getHealthHub monitor illness", () => {
  it("exposes raised illness level and shortened message on monitor", async () => {
    const store = new MemoryStore();
    const row = emptyScoreRow("2026-05-15");
    row.health_monitor = {
      reason: null,
      stale: [],
      vitals: [],
      inRange: 3,
      flagged: 2,
      illness: { score: 65, level: "raised", firedSignals: ["RHR up", "HRV down"], suppressedBy: [], signalCount: 2, copy: "Heads-up", baselineTrusted: true },
    };
    await store.putScores(row);
    const hub = await getHealthHub(await makeCtx(store, "2026-05-15"));
    expect(hub.monitor.value?.illness).toEqual({
      level: "raised",
      score: 65,
      message: "Body signals strained (RHR up, HRV down) — consider taking it easy.",
    });
  });
});

function makeScoreRow(day: string, overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    day,
    scoringVersion: 33,
    strain: null,
    activities: [],
    detected: [],
    sessionRhrBpm: null,
    recovery: null,
    sleep: null,
    training_load: null,
    strain_target: null,
    sleep_planner: null,
    energy_bank: null,
    stress: null,
    health_monitor: null,
    healthspan: null,
    fitness: null,
    journal_impact: null,
    hrv_status: null,
    training: null,
    ...overrides,
  };
}

describe("getStress ansBalance", () => {
  it("computes ansBalance on the 180-day demo seed", async () => {
    const vm = await getStress(TODAY, ctx);
    expect(vm.ansBalance).not.toBeNull();
    expect(vm.ansBalance!.score).toBeGreaterThanOrEqual(0);
    expect(vm.ansBalance!.score).toBeLessThanOrEqual(100);
    expect(["parasympathetic", "balanced", "sympathetic"]).toContain(vm.ansBalance!.band);
    expect(vm.ansBalance!.sympatheticFraction).toBeGreaterThanOrEqual(0);
    expect(vm.ansBalance!.sympatheticFraction).toBeLessThanOrEqual(1);
  });

  it("returns null when there is no stress data for the day", async () => {
    const store = new MemoryStore();
    const c = await makeCtx(store, "2026-05-15");
    const vm = await getStress("2026-05-15", c);
    expect(vm.ansBalance).toBeNull();
  });

  it("computes exact A, B, C weights and parasympathetic/sympathetic bands while excluding sleep spans", async () => {
    const store = new MemoryStore();
    const day = "2026-05-15";
    // Prior 30 nights all at 50 ms -> mean=50, sd=0 -> uses 3.1325 floor.
    const metrics = Array.from({ length: 30 }, (_, k) => ({
      ...emptyMetrics(addDays(day, -(k + 1))),
      hrvMs: 50,
    }));
    // Today: HRV = 50 + 2 * 3.1325 (z = +2 -> B = 50 + 30 = 80)
    const todayHrv = 50 + 2 * (0.5 * 1.253 * 5);
    metrics.push({ ...emptyMetrics(day), hrvMs: todayHrv });
    await store.upsertMetrics(metrics);

    const startTs = Date.parse(`${day}T00:00:00Z`) / 1000;
    // Sleep 00:00 - 08:00 (minutes 0..479): high stress 80 during sleep must be excluded from waking slots
    // Awake 08:00 - 18:00 (600 minutes): 150 min at 55 (>40), 450 min at 20 (<=40) -> f_sym = 0.25 -> A = 75
    const series: (number | null)[] = new Array(1440).fill(null);
    for (let m = 0; m < 480; m++) series[m] = 80;
    for (let m = 480; m < 630; m++) series[m] = 55;
    for (let m = 630; m < 1080; m++) series[m] = 20;
    await store.putSeries(day, "stress", series);

    await store.putScores(
      makeScoreRow(day, {
        stress: {
          provisional: false,
          average: 30,
          lowMin: 450,
          mediumMin: 150,
          highMin: 0,
          latest: { ts: startTs + 1079 * 60, value: 20 },
          longestHigh: null,
          referenceHr: 60,
        },
        sleep: {
          reason: null,
          main: {
            id: "s1",
            start: startTs,
            end: startTs + 480 * 60,
            processed: true,
            staged: true,
            inBedMin: 480,
            asleepMin: 460,
            awakeMin: 20,
            deepMin: 90,
            remMin: 100,
            lightMin: 270,
            efficiency: 95,
            wakeEvents: 1,
          },
          naps: [],
          performance: 85,
          needHours: 8,
          needNights: 10,
          creditedMin: 460,
          debtMin: 0,
          sri: 80,
          consistency: 85,
        },
        hrv_status: {
          status: "unbalanced",
          direction: "high",
          lastNight: todayHrv,
          weekAverage: 55,
          band: { low: 45, high: 53 },
          lowLine: 40,
          baselineNights: 30,
        },
      }),
    );

    const c = await makeCtx(store, day);
    const vm = await getStress(day, c);
    // A = 75, B = 80, C = 70 -> 0.4*75 + 0.4*80 + 0.2*70 = 30 + 32 + 14 = 76
    expect(vm.ansBalance).toMatchObject({
      score: 76,
      band: "parasympathetic",
      sympatheticFraction: 0.25,
      hrvStatus: "unbalanced_high",
    });
    expect(vm.ansBalance!.overnightHrvZ).toBeCloseTo(2, 5);
  });

  it("maps sympathetic band when stress is elevated, HRV is low, and hrvStatus is low", async () => {
    const store = new MemoryStore();
    const day = "2026-05-15";
    const metrics = Array.from({ length: 20 }, (_, k) => ({
      ...emptyMetrics(addDays(day, -(k + 1))),
      hrvMs: 60,
    }));
    metrics.push({ ...emptyMetrics(day), hrvMs: 50 }); // z ≈ -3.19 -> B = clamp(50 - 47.9, 0, 100) ≈ 2.1
    await store.upsertMetrics(metrics);

    const series = new Array<number>(600).fill(55); // all waking slots > 40 -> f_sym = 1 -> A = 0
    await store.putSeries(day, "stress", series);
    await store.putScores(
      makeScoreRow(day, {
        stress: {
          provisional: false,
          average: 55,
          lowMin: 0,
          mediumMin: 600,
          highMin: 0,
          latest: null,
          longestHigh: null,
          referenceHr: 65,
        },
        hrv_status: {
          status: "low",
          direction: null,
          lastNight: 50,
          weekAverage: 48,
          band: { low: 55, high: 65 },
          lowLine: 52,
          baselineNights: 30,
        },
      }),
    );

    const c = await makeCtx(store, day);
    const vm = await getStress(day, c);
    expect(vm.ansBalance!.band).toBe("sympathetic");
    expect(vm.ansBalance!.score).toBeLessThan(40);
    expect(vm.ansBalance!.hrvStatus).toBe("low");
  });
});

describe("getFitness vo2maxTrend", () => {
  it("returns null when fewer than 7 data points exist in the last 28 days", async () => {
    const store = new MemoryStore();
    const today = "2026-05-28";
    for (let k = 0; k < 6; k++) {
      const d = addDays(today, -k);
      await store.putScores(
        makeScoreRow(d, {
          fitness: { reason: null, vo2max: 45, source: "daily", sourceDay: d, percentile: 60, category: "good", age: 30 },
        }),
      );
    }
    const c = await makeCtx(store, today);
    const vm = await getFitness(c);
    expect(vm.vo2maxTrend).toBeNull();
  });

  it("computes weighted OLS slope, improving/detraining/stable directions, and displayDelta", async () => {
    const makeSeriesRun = async (slopePerDay: number, useEstimate = false) => {
      const store = new MemoryStore();
      const today = "2026-05-28";
      for (let i = 0; i < 28; i++) {
        const d = addDays(today, i - 27);
        const val = 42 + slopePerDay * i;
        await store.putScores(
          makeScoreRow(d, useEstimate
            ? {
                healthspan: {
                  reason: "calibrating",
                  dataDays: i + 1,
                  fitnessEstimate: { fitnessAge: 28, vo2max: val, method: "uth", activityIndex: 3, restingHr: 55 },
                },
              }
            : {
                fitness: { reason: null, vo2max: val, source: "daily", sourceDay: d, percentile: 60, category: "good", age: 30 },
              }),
        );
      }
      return getFitness(await makeCtx(store, today));
    };

    const up = await makeSeriesRun(0.1); // +2.8 over 28 days -> improving
    expect(up.vo2maxTrend).not.toBeNull();
    expect(up.vo2maxTrend!.direction).toBe("improving");
    expect(up.vo2maxTrend!.dataPoints).toBe(28);
    expect(up.vo2maxTrend!.slopePer28Days).toBeCloseTo(2.8, 5);
    expect(up.vo2maxTrend!.displayDelta).toBe("+2.8 mL/kg/min over 4 weeks");

    const flat = await makeSeriesRun(0.05, true); // +1.4 over 28 days -> stable, using fitnessEstimate fallback
    expect(flat.vo2maxTrend!.direction).toBe("stable");
    expect(flat.vo2maxTrend!.slopePer28Days).toBeCloseTo(1.4, 5);
    expect(flat.vo2maxTrend!.displayDelta).toBe("+1.4 mL/kg/min over 4 weeks");

    const down = await makeSeriesRun(-0.08); // -2.24 over 28 days -> detraining
    expect(down.vo2maxTrend!.direction).toBe("detraining");
    expect(down.vo2maxTrend!.slopePer28Days).toBeCloseTo(-2.24, 5);
    expect(down.vo2maxTrend!.displayDelta).toBe("−2.2 mL/kg/min over 4 weeks");
  });
});

describe("getMetabolicRisk and getHealthHub.metabolicRisk", () => {
  it("returns calibrated metabolic risk from Health Hub and detailed contributors on the 180-day seed", async () => {
    const hub = await getHealthHub(ctx);
    expect(hub.metabolicRisk).toBeDefined();
    expect(hub.metabolicRisk!.reason).toBeNull();
    expect(hub.metabolicRisk!.value).not.toBeNull();
    const mr = hub.metabolicRisk!.value!;
    expect(mr.score).toBeGreaterThanOrEqual(0);
    expect(mr.score).toBeLessThanOrEqual(100);
    expect(["low", "moderate", "elevated", "high"]).toContain(mr.band);
    expect(Array.isArray(mr.topContributors)).toBe(true);
    expect(mr.publishedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const detail = await getMetabolicRisk(ctx);
    expect(detail.result.reason).toBeNull();
    expect(detail.result.value).toEqual(mr);
    expect(detail.history.length).toBeGreaterThanOrEqual(2);
    for (const point of detail.history) {
      expect(point.value).not.toBeNull();
      expect(point.value!).toBeGreaterThanOrEqual(0);
      expect(point.value!).toBeLessThanOrEqual(100);
    }
    expect(detail.contributors.map((c) => c.key)).toEqual(["rhr", "hrv", "sleep", "steps", "resp"]);
    for (const c of detail.contributors) {
      expect(c.average).not.toBeNull();
    }
  });

  it("reports calibrating when fewer than 21 days exist", async () => {
    const s = new MemoryStore();
    const emptyCtx: QueryCtx = { ...ctx, store: s };
    const hub = await getHealthHub(emptyCtx);
    expect(hub.metabolicRisk!.value).toBeNull();
    expect(hub.metabolicRisk!.reason).toBe("calibrating");

    const detail = await getMetabolicRisk(emptyCtx);
    expect(detail.result.value).toBeNull();
    expect(detail.result.reason).toBe("calibrating");
    expect(detail.history).toEqual([]);
  });
});
