import { describe, expect, it } from "vitest";
import { circadianScore, type CircadianNight } from "./circadian";

const BASE_TS = Date.UTC(2026, 8, 1, 23, 0, 0) / 1000; // 23:00 UTC

const nightAt = (
  dayIndex: number,
  onsetOffsetHours = 0,
  tempNadirOffsetH: number | null = 2.5,
  hrNadirOffsetH: number | null = 2.5,
): CircadianNight => {
  const sleepOnsetTs = BASE_TS + dayIndex * 86_400 + onsetOffsetHours * 3600;
  return {
    sleepOnsetTs,
    sleepMidTs: sleepOnsetTs + 4 * 3600,
    tempNadirOffsetH,
    hrNadirOffsetH,
  };
};

describe("circadianScore", () => {
  it("returns null when fewer than 7 nights have sleep onset", () => {
    const short = Array.from({ length: 6 }, (_, i) => nightAt(i));
    expect(circadianScore(short)).toBeNull();

    const withGap = Array.from({ length: 7 }, (_, i) => (i === 3 ? { sleepOnsetTs: null, sleepMidTs: null, tempNadirOffsetH: null, hrNadirOffsetH: null } : nightAt(i)));
    expect(circadianScore(withGap)).toBeNull();
  });

  it("scores high and aligned for consistent sleep and ideal temp/HR nadirs", () => {
    const nights = Array.from({ length: 14 }, (_, i) => nightAt(i, 0, 2.5, 2.5));
    const res = circadianScore(nights);
    expect(res).not.toBeNull();
    expect(res!.phase).toBe("aligned");
    expect(res!.consistencyScore).toBe(100);
    expect(res!.alignmentScore).toBe(100);
    expect(res!.nadirScore).toBe(100);
    expect(res!.score).toBe(100);
  });

  it("detects shifted_late and shifted_early across midnight wraparound", () => {
    // Prior 7 nights at 23:00, current 7 nights at 00:30 (+90 min late, crossing midnight).
    const lateNights = [
      ...Array.from({ length: 7 }, (_, i) => nightAt(i, 0)),
      ...Array.from({ length: 7 }, (_, i) => nightAt(7 + i, 1.5)),
    ];
    const lateRes = circadianScore(lateNights);
    expect(lateRes).not.toBeNull();
    expect(lateRes!.phase).toBe("shifted_late");

    // Prior 7 nights at 00:00, current 7 nights at 22:30 (-90 min early).
    const earlyNights = [
      ...Array.from({ length: 7 }, (_, i) => nightAt(i, 1.0)),
      ...Array.from({ length: 7 }, (_, i) => nightAt(7 + i, -0.5)),
    ];
    const earlyRes = circadianScore(earlyNights);
    expect(earlyRes).not.toBeNull();
    expect(earlyRes!.phase).toBe("shifted_early");
  });

  it("detects irregular phase and falls back to S1 when temp is unavailable", () => {
    // Highly scattered sleep onset times across the 24h clock: R << 0.7.
    const offsets = [0, 8, -6, 11, -3, 6, -9];
    const irregular = offsets.map((off, i) => nightAt(i, off, null, 2.5));
    const res = circadianScore(irregular);
    expect(res).not.toBeNull();
    expect(res!.phase).toBe("irregular");
    expect(res!.consistencyScore).toBeLessThan(70);
    expect(res!.alignmentScore).toBe(0);
    expect(res!.nadirScore).toBe(0);
    expect(res!.score).toBe(res!.consistencyScore);
  });
});
