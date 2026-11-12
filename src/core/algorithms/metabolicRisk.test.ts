import { describe, expect, it } from "vitest";
import { metabolicRisk, type MetabolicRiskDay } from "./metabolicRisk";

const isoDay = (offset: number) => new Date(Date.UTC(2026, 8, 1) + offset * 86_400_000).toISOString().slice(0, 10);

const makeDays = (count: number, overrides: Partial<MetabolicRiskDay> = {}): MetabolicRiskDay[] =>
  Array.from({ length: count }, (_, i) => ({
    day: isoDay(i),
    rhr: 58,
    hrv: 65,
    sleepPct: 85,
    steps: 9000,
    resp: 14.5,
    ...overrides,
  }));

describe("metabolicRisk", () => {
  it("returns null (calibrating) when fewer than 21 days have RHR or HRV data", () => {
    const short = makeDays(20);
    expect(metabolicRisk(short, { sex: "male" })).toBeNull();

    const sparse = [...makeDays(15), ...makeDays(15, { rhr: null, hrv: null })];
    expect(metabolicRisk(sparse, { sex: "female" })).toBeNull();
  });

  it("scores around 50 (moderate) at personal baseline, and low when vitals are favorable", () => {
    const baseline = makeDays(30);
    const atAvg = metabolicRisk([...baseline, { day: isoDay(30), rhr: 58, hrv: 65, sleepPct: 85, steps: 9000, resp: 14.5 }], {
      sex: "male",
    });
    expect(atAvg).not.toBeNull();
    expect(atAvg!.score).toBe(50);
    expect(atAvg!.band).toBe("moderate");

    // Favorable shift: lower RHR, higher HRV, higher sleep efficiency, more steps, lower respiratory rate.
    const low = metabolicRisk([...baseline, { day: isoDay(30), rhr: 50, hrv: 90, sleepPct: 98, steps: 15000, resp: 13.0 }], {
      sex: "male",
    });
    expect(low).not.toBeNull();
    expect(low!.score).toBeLessThan(40);
    expect(low!.band).toBe("low");
  });

  it("returns elevated/high score and ranks topContributors when metabolic stress signals worsen", () => {
    const baseline = makeDays(30);
    // Unfavorable shift: elevated RHR, suppressed HRV, poor sleep, low steps, elevated respiratory rate.
    const high = metabolicRisk([...baseline, { day: isoDay(30), rhr: 72, hrv: 35, sleepPct: 55, steps: 2000, resp: 18.0 }], {
      sex: "female",
    });
    expect(high).not.toBeNull();
    expect(high!.score).toBeGreaterThanOrEqual(75);
    expect(high!.band).toBe("high");
    expect(high!.topContributors.length).toBe(3);
    expect(high!.topContributors).toContain("rhr");
    expect(high!.topContributors).toContain("hrv");
  });

  it("handles missing non-primary signals gracefully by renormalizing present weights", () => {
    const baseline = makeDays(30, { sleepPct: null, steps: null, resp: null });
    const partial = metabolicRisk([...baseline, { day: isoDay(30), rhr: 68, hrv: 40 }], { sex: "male" });
    expect(partial).not.toBeNull();
    expect(partial!.score).toBeGreaterThan(60);
    expect(partial!.topContributors).toEqual(["hrv", "rhr"]);
  });
});
