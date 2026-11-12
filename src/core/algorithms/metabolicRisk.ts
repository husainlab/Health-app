// Metabolic Risk Score: a weekly composite of five physiological signals, z-scored against personal baselines,
// published each Monday and carried through the rest of the week.
// No I/O; pure TypeScript only.
import { foldHistory, hrvCfg, isUsable, respCfg, restingHRCfg, sigma } from "../scoring/baselines";
import type { MetricCfg } from "../scoring/types";
import type { Sex } from "./fitnessLevel";

export type MetabolicBand = "low" | "moderate" | "elevated" | "high";

export interface MetabolicRiskResult {
  score: number;
  band: MetabolicBand;
  topContributors: string[];
}

export interface MetabolicRiskDay {
  day: string;
  rhr?: number | null;
  hrv?: number | null;
  sleepPct?: number | null;
  steps?: number | null;
  resp?: number | null;
}

const stepsCfg: MetricCfg = { minVal: 0, maxVal: 30000, floorSpread: 500, halfLifeB: 14, halfLifeS: 21 };
const sleepPctCfg: MetricCfg = { minVal: 0, maxVal: 100, floorSpread: 5, halfLifeB: 14, halfLifeS: 21 };

/** Weights: RHR=0.30 (↑ bad), HRV=0.30 (↓ bad, negated), sleep=0.20 (↓ bad), steps=0.10 (↓ bad), resp=0.10 (↑ bad). */
const SIGNAL_SPECS = [
  { key: "rhr", weight: 0.3, cfg: restingHRCfg },
  { key: "hrv", weight: -0.3, cfg: hrvCfg },
  { key: "sleepPct", weight: -0.2, cfg: sleepPctCfg },
  { key: "steps", weight: -0.1, cfg: stepsCfg },
  { key: "resp", weight: 0.1, cfg: respCfg },
] as const;

export const METABOLIC_MIN_DAYS = 21;

function bandOf(score: number): MetabolicBand {
  if (score < 40) return "low";
  if (score < 60) return "moderate";
  if (score < 75) return "elevated";
  return "high";
}

/**
 * Computes a Metabolic Risk Score from up to 60 days of daily vitals (oldest first; last day is scored).
 * Returns null when fewer than 21 days have RHR or HRV data, or when today has no usable signals.
 */
export function metabolicRisk(days: MetabolicRiskDay[], _profile: { sex: Sex }): MetabolicRiskResult | null {
  if (days.length === 0) return null;

  const usableDays = days.filter((d) => d.rhr != null || d.hrv != null).length;
  if (usableDays < METABOLIC_MIN_DAYS) return null;

  const history = days.slice(0, -1);
  const today = days[days.length - 1];

  let weightedSum = 0;
  let totalWeight = 0;
  const contributors: { name: string; impact: number }[] = [];

  for (const spec of SIGNAL_SPECS) {
    const val = today[spec.key];
    if (val == null || !Number.isFinite(val)) continue;
    const baseline = foldHistory(
      history.map((d) => d[spec.key] ?? null),
      spec.cfg,
    );
    if (!isUsable(baseline)) continue;
    const z = (val - baseline.baseline) / sigma(baseline);
    const contrib = spec.weight * z;
    weightedSum += contrib;
    totalWeight += Math.abs(spec.weight);
    contributors.push({ name: spec.key === "sleepPct" ? "sleep" : spec.key, impact: Math.abs(contrib) });
  }

  if (totalWeight === 0) return null;

  const R = weightedSum / totalWeight;
  const score = Math.round(100 / (1 + Math.exp(-1.5 * R)));
  contributors.sort((a, b) => b.impact - a.impact || (a.name < b.name ? -1 : 1));

  return {
    score,
    band: bandOf(score),
    topContributors: contributors.slice(0, 3).map((c) => c.name),
  };
}
