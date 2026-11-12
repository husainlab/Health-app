import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { emptyMetrics, type Metrics } from "@/data/types";
import { addDays } from "@/lib/time";
import { emptyScoreRow } from "@/pipeline/stage1";
import type { Stage1Day } from "@/pipeline/types";
import type { QueryCtx } from "./ctx";
import { dehydrationFlagOf, getRecovery } from "./recovery";
import type { DayRow } from "./common";

const TZ = "UTC";
const TODAY = "2026-10-15";

function makeDayRow(day: string, opts: { rhr?: number; hrvMs?: number; strain?: number; sleepPerf?: number; illnessLevel?: "quiet" | "raised" } = {}): DayRow {
  return {
    day,
    s1: opts.strain != null ? ({ hrCount: 100, engine: { strain: { value: opts.strain, steps: 0, passiveUnits: 0, workoutUnits: 0 } } } as unknown as Stage1Day) : null,
    activities: [],
    detected: [],
    sessionRhr: null,
    rhr: opts.rhr ?? null,
    recovery: null,
    sleep: opts.sleepPerf != null
      ? {
          reason: null,
          main: null,
          naps: [],
          performance: opts.sleepPerf,
          needHours: 7.5,
          needNights: 30,
          creditedMin: null,
          debtMin: 0,
          sri: null,
          consistency: null,
        }
      : null,
    trainingLoad: null,
    strainTarget: null,
    sleepPlanner: null,
    energyBank: null,
    stress: null,
    healthMonitor: opts.illnessLevel
      ? {
          reason: null,
          stale: [],
          vitals: [],
          inRange: 5,
          flagged: 0,
          illness: { score: opts.illnessLevel === "raised" ? 60 : 0, level: opts.illnessLevel, firedSignals: [], suppressedBy: [], signalCount: 0, copy: "", baselineTrusted: true },
        }
      : null,
    healthspan: null,
    fitness: null,
    hrvStatus: null,
    training: null,
    metabolicRisk: null,
    circadian: null,
    metrics: opts.hrvMs != null ? { ...emptyMetrics(day), rhrBpm: opts.rhr ?? null, hrvMs: opts.hrvMs } : null,
    extra: {},
  };
}

function buildRows(todayPatch: Partial<Parameters<typeof makeDayRow>[1]> = {}, yesterdayStrain = 35): Map<string, DayRow> {
  const rows = new Map<string, DayRow>();
  for (let k = 1; k <= 30; k++) {
    const d = addDays(TODAY, -k);
    // Slight variance around RHR=55 and HRV=60 so SD is well-behaved
    rows.set(d, makeDayRow(d, {
      rhr: k % 2 === 0 ? 54 : 56,
      hrvMs: k % 2 === 0 ? 58 : 62,
      strain: k === 1 ? yesterdayStrain : 40,
    }));
  }
  rows.set(TODAY, makeDayRow(TODAY, {
    rhr: 63, // z_rhr > 1.5
    hrvMs: 36, // ln(36)=3.58 vs ~4.09 -> z_hrv < -1.5
    sleepPerf: 78,
    illnessLevel: "quiet",
    ...todayPatch,
  }));
  return rows;
}

describe("dehydrationFlagOf", () => {
  it("flags when RHR is elevated, HRV is suppressed, yesterday strain < 60, illness is not raised, and sleep > 60", () => {
    const flag = dehydrationFlagOf(buildRows(), TODAY);
    expect(flag).toEqual({
      flagged: true,
      reason: "RHR elevated and HRV suppressed without strain or sleep explanation",
    });
  });

  it("does not flag when yesterday strain >= 60, illness is raised, sleep <= 60, or RHR/HRV are normal", () => {
    expect(dehydrationFlagOf(buildRows({}, 65), TODAY)).toBeNull();
    expect(dehydrationFlagOf(buildRows({ illnessLevel: "raised" }), TODAY)).toBeNull();
    expect(dehydrationFlagOf(buildRows({ sleepPerf: 55 }), TODAY)).toBeNull();
    expect(dehydrationFlagOf(buildRows({ rhr: 55 }), TODAY)).toBeNull();
    expect(dehydrationFlagOf(buildRows({ hrvMs: 60 }), TODAY)).toBeNull();
  });

  it("wires dehydrationFlag into getRecovery()", async () => {
    const store = new MemoryStore();
    const scoreRows = [];
    const metrics: Metrics[] = [];
    for (let k = 1; k <= 30; k++) {
      const d = addDays(TODAY, -k);
      const r = emptyScoreRow(d);
      r.strain = { ...r.strain!, hrCount: 100, engine: { restingHRV: null, averageHRV: null, restingHR: null, inactiveHR: null, strain: { value: k === 1 ? 35 : 40, steps: 0, passiveUnits: 0, workoutUnits: 0 } } };
      scoreRows.push(r);
      metrics.push({ ...emptyMetrics(d), rhrBpm: k % 2 === 0 ? 54 : 56, hrvMs: k % 2 === 0 ? 58 : 62 });
    }
    const todayScore = emptyScoreRow(TODAY);
    todayScore.sleep = { reason: null, main: null, naps: [], performance: 80, needHours: 7.5, needNights: 30, creditedMin: null, debtMin: 0, sri: null, consistency: null };
    todayScore.health_monitor = { reason: null, stale: [], vitals: [], inRange: 5, flagged: 0, illness: { score: 0, level: "quiet", firedSignals: [], suppressedBy: [], signalCount: 0, copy: "", baselineTrusted: true } };
    scoreRows.push(todayScore);
    metrics.push({ ...emptyMetrics(TODAY), rhrBpm: 63, hrvMs: 36 });

    for (const r of scoreRows) await store.putScores(r);
    await store.upsertMetrics(metrics);

    const ctx: QueryCtx = {
      store,
      profile: { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: TZ },
      timeZone: TZ,
      today: TODAY,
      now: Date.parse(`${TODAY}T12:00:00Z`) / 1000,
      sync: { lastSyncTs: null, firstDay: addDays(TODAY, -30), lastError: null },
    };
    const vm = await getRecovery(TODAY, ctx);
    expect(vm.dehydrationFlag?.flagged).toBe(true);
  });
});
