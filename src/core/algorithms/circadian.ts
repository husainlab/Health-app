// Circadian Rhythm Score: circular phase consistency of sleep onset over 7 nights, plus optional
// skin-temperature nadir alignment and HR-vs-temperature nadir coupling.
// No I/O; pure TypeScript only.

export type CircadianPhase = "aligned" | "shifted_late" | "shifted_early" | "irregular";

export interface CircadianResult {
  score: number;
  phase: CircadianPhase;
  consistencyScore: number;
  alignmentScore: number;
  nadirScore: number;
}

export interface CircadianNight {
  sleepOnsetTs: number | null;
  sleepMidTs: number | null;
  tempNadirOffsetH: number | null;
  hrNadirOffsetH: number | null;
}

const DAY_S = 86_400;
const TWO_PI = 2 * Math.PI;
const MIN_NIGHTS = 7;
const IDEAL_TEMP_NADIR_H = 2.5;
const SHIFT_THRESHOLD_MIN = 30;
const IRREGULAR_R_THRESHOLD = 0.7;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function circularStats(timestamps: number[]) {
  let sumCos = 0;
  let sumSin = 0;
  for (const ts of timestamps) {
    const mod = ((ts % DAY_S) + DAY_S) % DAY_S;
    const phi = (mod / DAY_S) * TWO_PI;
    sumCos += Math.cos(phi);
    sumSin += Math.sin(phi);
  }
  const n = timestamps.length;
  const R = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / n;
  const meanPhi = Math.atan2(sumSin, sumCos);
  return { R, meanPhi };
}

/**
 * Computes the Circadian Rhythm Score from nightly sleep onset and optional temperature/HR nadir offsets.
 * Expects nights ordered oldest first (up to 14 nights: prior 7 nights for shift detection + current 7 nights).
 * Returns null if fewer than 7 nights in the current 7-night window have a sleep onset timestamp.
 */
export function circadianScore(nights: CircadianNight[]): CircadianResult | null {
  const current = nights.slice(-MIN_NIGHTS);
  const currentOnsets = current.map((n) => n.sleepOnsetTs).filter((v): v is number => v != null && Number.isFinite(v));
  if (currentOnsets.length < MIN_NIGHTS) return null;

  const { R, meanPhi } = circularStats(currentOnsets);
  const S1 = Math.max(0, Math.min(100, R * 100));

  // Phase classification: check irregular first, then compare mean onset vs prior 7-day mean.
  let phase: CircadianPhase = "aligned";
  if (R < IRREGULAR_R_THRESHOLD) {
    phase = "irregular";
  } else {
    const prior = nights.slice(-(MIN_NIGHTS * 2), -MIN_NIGHTS);
    const priorOnsets = prior.map((n) => n.sleepOnsetTs).filter((v): v is number => v != null && Number.isFinite(v));
    if (priorOnsets.length > 0) {
      const { meanPhi: priorPhi } = circularStats(priorOnsets);
      const deltaPhi = Math.atan2(Math.sin(meanPhi - priorPhi), Math.cos(meanPhi - priorPhi));
      const deltaMin = (deltaPhi / TWO_PI) * 1440;
      if (deltaMin > SHIFT_THRESHOLD_MIN) phase = "shifted_late";
      else if (deltaMin < -SHIFT_THRESHOLD_MIN) phase = "shifted_early";
    }
  }

  // Step 2 — skin temp nadir relative to sleep start (ideal 2.5h after sleep start).
  const s2Vals = current
    .map((n) => n.tempNadirOffsetH)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .map((offset) => Math.max(0, 1 - Math.abs(offset - IDEAL_TEMP_NADIR_H) / 3) * 100);

  // Step 3 — HR nadir vs temp nadir alignment.
  const s3Vals = current
    .filter((n): n is CircadianNight & { tempNadirOffsetH: number; hrNadirOffsetH: number } =>
      n.tempNadirOffsetH != null &&
      Number.isFinite(n.tempNadirOffsetH) &&
      n.hrNadirOffsetH != null &&
      Number.isFinite(n.hrNadirOffsetH),
    )
    .map((n) => Math.max(0, 1 - Math.abs(n.hrNadirOffsetH - n.tempNadirOffsetH) / 1.5) * 100);

  const hasTemp = s2Vals.length > 0;
  const hasNadirPair = s3Vals.length > 0;

  const S2 = hasTemp ? mean(s2Vals) : 0;
  const S3 = hasNadirPair ? mean(s3Vals) : 0;

  let combined: number;
  if (!hasTemp) {
    combined = S1;
  } else if (!hasNadirPair) {
    combined = (0.5 * S1 + 0.3 * S2) / 0.8;
  } else {
    combined = 0.5 * S1 + 0.3 * S2 + 0.2 * S3;
  }

  return {
    score: Math.round(combined),
    phase,
    consistencyScore: Math.round(S1),
    alignmentScore: Math.round(S2),
    nadirScore: Math.round(S3),
  };
}
