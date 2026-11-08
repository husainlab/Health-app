// The coach's tools, ported from Pulse's src/server/coach/tools.ts: read-only, bound to this person's QueryCtx by
// closure (the model never names a person or a store), each a compact digest of an existing screen query. A metric
// without a value carries its reason code instead, so the model can say "calibrating" rather than guess. No chart
// series, ids or raw payloads.
import { tool, type InferToolOutput } from "ai";
import { z } from "zod";
import { i18n } from "@/i18n/config";
import { trainingGuidance } from "@/core/algorithms/coaching";
import type { Metric } from "@/lib/reasons";
import { addDays, daysBetween } from "@/lib/time";
import { getActivities } from "@/queries/activities";
import { costDigest } from "@/queries/activityCost";
import { getActivity } from "@/queries/activity";
import { dayStartOf, firstDay, loadDays, maybe, meanSd, todayOf, type QueryCtx } from "@/queries/common";
import { acwrStatus, getFitness, getHealthHub, getMonitor, getStress } from "@/queries/health";
import { energyBankVM, latestReport } from "@/queries/home";
import { getJournalInsights, tagRows, addTag } from "@/queries/journal";
import { behavior } from "@/lib/behaviors";
import { getRecovery } from "@/queries/recovery";
import { getReport } from "@/queries/reports";
import { getSleep } from "@/queries/sleep";
import { getStrain } from "@/queries/strain";
import { TREND_METRICS, trendMetric, type TrendMetricKey } from "@/queries/trends";
import { SCORE_DOCS } from "@/screens/more/howItWorksContent";
import { logEntry } from "@/actions/log";
import { saveJournalEntry } from "@/actions/journal";
import { dataChanged } from "@/state/dataVersion";
import type { Flow, Meal, Mood, OvulationResult, Symptom, Valence } from "@/queries/log";
import { defaultTexts, type Texts } from "./texts";

const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

/** A number metric as `{ value }` or `{ value: null, reason }`; provisional only when it is. */
export function num(m: Metric<number>, dp = 0) {
  return { value: m.value === null ? null : round(m.value, dp), reason: m.value === null ? (m.reason ?? "no_data") : null, provisional: m.provisional, ...(m.nightsLeft !== undefined && { nightsLeft: m.nightsLeft }) };
}

const Day = (description: string) => z.iso.date().optional().describe(description);

async function dayOf(ctx: QueryCtx, day: string | undefined) {
  const today = todayOf(ctx);
  if (!day || day > today) return today;
  const first = await firstDay(ctx);
  return first && day < first ? first : day;
}

export async function sleepDigest(ctx: QueryCtx, day: string) {
  const s = await getSleep(day, ctx);
  return {
    day,
    timeZone: ctx.timeZone,
    performance: { ...num(s.performance), unit: "%" },
    asleepMinutes: num(s.hours.value ? { ...s.hours, value: s.hours.value.asleepMin } : { ...s.hours, value: null }),
    need: s.hoursVsNeed,
    summary: s.summary.map((v) => ({ key: v.key, label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average, status: v.status ?? null })),
    details: s.details.map((v) => ({ key: v.key, label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average })),
    stages: s.stages?.value
      ? { value: { bedAt: s.stages.value.bed, wakeAt: s.stages.value.wake, rows: s.stages.value.rows.map((r) => ({ stage: r.label, minutes: round(r.minutes), pct: round(r.pct) })) }, reason: null, provisional: s.stages.provisional }
      : { value: null, reason: s.stages?.reason ?? "no_data", provisional: false },
    planner: s.planner,
    insight: s.insight,
  };
}

export async function trendDigest(ctx: QueryCtx, metric: TrendMetricKey, start?: string, end?: string) {
  const to = end && end < todayOf(ctx) ? end : todayOf(ctx);
  const requested = start ?? addDays(to, -13);
  const from = requested > to ? to : requested < addDays(to, -89) ? addDays(to, -89) : requested;
  const count = daysBetween(from, to) + 1;
  const priorEnd = addDays(from, -1);
  const priorStart = addDays(from, -count);
  const rows = await loadDays(ctx, priorStart, to);
  // In the person's units, as the screens show it.
  const m = trendMetric(metric);
  const points = (a: string, b: string) => {
    const out = [];
    for (let day = a; day <= b; day = addDays(day, 1)) {
      const row = rows.get(day)!;
      const partial = !!m.partialToday && day === todayOf(ctx);
      const v = partial ? null : m.pick(row);
      const rec = row.recovery;
      const reason = metric === "recovery" && rec?.reason ? rec.reason : "no_data";
      out.push({ day, ...num(maybe(v, reason, !!m.provisional?.(row)), 1), ...(partial && { excludedPartialDay: true }) });
    }
    return out;
  };
  const current = points(from, to);
  const previous = points(priorStart, priorEnd);
  const stats = (p: typeof current) => ({ average: num(maybe(meanSd(p.map((d) => d.value)).mean, "no_data", p.some((d) => d.provisional)), 1), observedDays: p.filter((d) => d.value !== null).length });
  return { metric: m.label, key: metric, unit: m.unit ?? (m.format === "duration" ? "min" : null), start: from, end: to, requestedStart: start ?? null, requestedEnd: end ?? null, calendarDays: count, ...stats(current), previous: { start: priorStart, end: priorEnd, ...stats(previous) }, points: current };
}

export async function dayDigest(ctx: QueryCtx, day: string) {
  const [rec, sleep, strain, stress, rows] = await Promise.all([getRecovery(day, ctx), getSleep(day, ctx), getStrain(day, ctx), getStress(day, ctx), loadDays(ctx, day, day)]);
  const bank = energyBankVM(ctx, rows.get(day), day, rec.isToday, null);
  return {
    day,
    isToday: rec.isToday,
    guidance: trainingGuidance({
      recovery: rec.recovery.value,
      provisional: rec.recovery.provisional,
      sleepPerformance: sleep.performance.value,
      strain: strain.strain.value,
      targetHigh: strain.target.value?.high ?? null,
      loadStatus: rows.get(day)?.trainingLoad?.acwr == null ? null : acwrStatus(rows.get(day)!.trainingLoad!.acwr!).status,
    }),
    recovery: {
      ...num(rec.recovery),
      unit: "%",
      band: rec.band,
      contributors: rec.contributors.map((c) => ({
        label: c.label,
        unit: c.unit,
        ...num(c.metric, 1),
        baseline: c.baseline && round(c.baseline.mean, 1),
        points: c.points === null ? null : round(c.points, 1),
      })),
    },
    sleep: {
      performance: { ...num(sleep.performance), unit: "%" },
      hoursAsleep: sleep.hours.value ? round(sleep.hours.value.asleepMin / 60, 1) : null,
      hoursNeeded: sleep.hoursVsNeed.value ? round(sleep.hoursVsNeed.value.needMin / 60, 1) : null,
      stages: sleep.stages?.value?.rows.map((r) => ({ stage: r.label, minutes: Math.round(r.minutes), pct: Math.round(r.pct) })) ?? null,
    },
    strain: {
      ...num(strain.strain),
      scale: i18n.t("coachTools:strainScale"),
      soFar: strain.soFar,
      target: strain.target.value ? [round(strain.target.value.low), round(strain.target.value.high)] : null,
      coachLine: strain.coach,
    },
    energyBank: { value: bank.value ? { current: round(bank.value.current), charged: round(bank.value.charged), drained: round(bank.value.drained), asOf: bank.value.until } : null, reason: bank.reason, provisional: bank.provisional },
    stress: stress.gauge.value ? { ...num({ ...stress.gauge, value: stress.gauge.value.value }), level: stress.gauge.value.level } : num({ ...stress.gauge, value: null }),
  };
}

export function howItWorksDigest(topic?: string) {
  const availableTopics = SCORE_DOCS.map((d) => ({
    slug: d.slug === "pulse-age" ? "health-age" : d.slug,
    name: d.slug === "pulse-age" ? "Health Age" : d.name,
    summary: d.summary,
  }));

  if (!topic || !topic.trim()) {
    return {
      topic: null,
      availableTopics,
    };
  }

  const clean = topic.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const targetSlug = clean === "health-age" ? "pulse-age" : clean;

  const doc = SCORE_DOCS.find(
    (d) =>
      d.slug === targetSlug ||
      d.slug.toLowerCase().replace(/-/g, "") === clean.replace(/-/g, "") ||
      d.name.toLowerCase().includes(clean.replace(/-/g, " ")) ||
      d.name.toLowerCase() === topic.trim().toLowerCase(),
  );

  if (!doc) {
    return {
      topic: null,
      notFound: topic,
      message: `No exact guide found for "${topic}". Please pick one of the available topics.`,
      availableTopics,
    };
  }

  return {
    topic: doc.slug === "pulse-age" ? "Health Age" : doc.name,
    slug: doc.slug === "pulse-age" ? "health-age" : doc.slug,
    summary: doc.summary,
    sections: doc.sections.map((s) => ({
      title: s.title,
      paragraphs: s.paragraphs ?? [],
      rows: s.rows ?? [],
    })),
    availableTopics,
  };
}

export async function appStatsDigest(ctx: QueryCtx) {
  const today = todayOf(ctx);
  const first = await firstDay(ctx);
  const totalDays = first ? Math.max(1, daysBetween(first, today) + 1) : 0;
  const start60 = addDays(today, -59);
  const from = first && first > start60 ? first : start60;
  const [rows, rec, allExercises] = await Promise.all([
    loadDays(ctx, from, today),
    getRecovery(today, ctx),
    ctx.store.allExercises(),
  ]);

  const recVals: number[] = [];
  const strainVals: number[] = [];
  const sleepHrs: number[] = [];
  const sleepPerf: number[] = [];

  for (const [, row] of rows) {
    if (row.recovery?.value != null) recVals.push(row.recovery.value);
    const st = row.s1?.engine?.strain?.value ?? null;
    if (st != null) strainVals.push(st);
    if (row.sleep?.main?.asleepMin != null) sleepHrs.push(row.sleep.main.asleepMin / 60);
    if (row.sleep?.performance != null) sleepPerf.push(row.sleep.performance);
  }

  const hrvContrib = rec.contributors.find((c) => c.key === "hrv");
  const rhrContrib = rec.contributors.find((c) => c.key === "rhr");

  return {
    today,
    firstDayWithData: first,
    totalDaysTracked: totalDays,
    windowDays: rows.size,
    calibration: {
      isCalibrating: rec.recovery.reason === "calibrating" || (rec.recovery.nightsLeft != null && rec.recovery.nightsLeft > 0),
      nightsLeft: rec.recovery.nightsLeft ?? null,
    },
    baselines: {
      hrvMs: hrvContrib?.baseline ? round(hrvContrib.baseline.mean, 1) : null,
      rhrBpm: rhrContrib?.baseline ? round(rhrContrib.baseline.mean, 1) : null,
    },
    averagesLast60Days: {
      recoveryPct: recVals.length ? round(meanSd(recVals).mean ?? 0, 1) : null,
      strain: strainVals.length ? round(meanSd(strainVals).mean ?? 0, 1) : null,
      sleepHours: sleepHrs.length ? round(meanSd(sleepHrs).mean ?? 0, 1) : null,
      sleepPerformancePct: sleepPerf.length ? round(meanSd(sleepPerf).mean ?? 0, 1) : null,
      observedDays: recVals.length,
    },
    totalWorkouts: allExercises.length,
  };
}

/**
 * The tool set for this person. `t` gives each description (texts.ts). Parameter types and what each tool reads are
 * fixed here.
 */
export function coachTools(ctx: QueryCtx, t: Texts = defaultTexts) {
  return {
    get_day: tool({
      description: t("tool.get_day"),
      inputSchema: z.object({ day: Day(t("tool.get_day.day")) }),
      execute: async ({ day }) => dayDigest(ctx, await dayOf(ctx, day)),
    }),
    get_sleep: tool({
      description: t("tool.get_sleep"),
      inputSchema: z.object({ day: Day(t("tool.get_sleep.day")) }),
      execute: async ({ day }) => sleepDigest(ctx, await dayOf(ctx, day)),
    }),
    get_trend: tool({
      description: t("tool.get_trend"),
      inputSchema: z.object({ metric: z.enum(TREND_METRICS.map((m) => m.key) as [TrendMetricKey, ...TrendMetricKey[]]).describe(t("tool.get_trend.metric")), start: Day(t("tool.get_trend.start")), end: Day(t("tool.get_trend.end")) }),
      execute: async ({ metric, start, end }) => trendDigest(ctx, metric, start, end),
    }),
    get_activities: tool({
      description: t("tool.get_activities"),
      inputSchema: z.object({ days: z.number().int().min(1).max(90).default(14).describe(t("tool.get_activities.days")) }),
      execute: async ({ days }) => {
        const a = await getActivities(days, ctx);
        const all = a.groups.flatMap((g) =>
          g.items.filter((i) => i.kind === "activity").map((i) => ({
            id: i.id,
            day: g.day,
            name: i.name,
            minutes: Math.round((i.end - i.start) / 60_000),
            strain: num(i.strain, 1),
            distanceKm: i.distanceKm === null ? null : round(i.distanceKm, 1),
          })),
        );
        // Mobile: stretches of raised HR with no workout recorded (estimates, never scored), and each kind's recovery cost.
        const detected = a.groups.flatMap((g) =>
          g.detected.map((d) => ({ day: g.day, likely: d.label, minutes: Math.round((d.end - d.start) / 60_000), avgHr: d.avgHr, strain: d.strain === null ? null : round(d.strain, 1) })),
        );
        return {
          start: addDays(a.today, -(days - 1)),
          end: a.today,
          total: all.length,
          truncated: all.length > 30,
          workouts: all.slice(0, 30),
          detected: detected.slice(0, 30),
          recoveryCost: a.cost && costDigest(a.cost),
        };
      },
    }),
    get_activity: tool({
      description: t("tool.get_activity"),
      inputSchema: z.object({ id: z.string().min(1).max(100).describe(t("tool.get_activity.id")) }),
      execute: async ({ id }) => {
        const a = await getActivity(id, ctx);
        if (!a || a.day > todayOf(ctx)) return { workout: null, reason: "no_data" as const };
        return {
          workout: {
            id: a.id,
            day: a.day,
            name: a.name,
            minutes: Math.round((a.end - a.start) / 60_000),
            strain: num(a.strain, 1),
            stats: a.stats.map((v) => ({ label: v.label, unit: v.unit ?? null, ...num(v.metric, 1), baseline: v.average })),
            zones: a.zones,
            zoneNote: a.zoneNote,
            hrRecovery: a.hrr,
            insight: a.insight,
          },
          reason: null,
        };
      },
    }),
    get_journal_impacts: tool({
      description: t("tool.get_journal_impacts"),
      inputSchema: z.object({ outcome: z.enum(["recovery", "hrv", "sleep"]).default("recovery").describe(t("tool.get_journal_impacts.outcome")) }),
      execute: async ({ outcome }) => {
        const j = await getJournalInsights(outcome, ctx);
        return {
          outcome,
          unit: j.unit,
          effects: j.items.map((i) => ({ key: i.key, behaviour: i.label, effect: i.effect, confidenceInterval: i.ci ?? null, delta: round(i.delta, 1), withAvg: i.avgWith, withoutAvg: i.avgWithout, yesDays: i.yes, noDays: i.no })),
          needsMoreData: j.needsMore.map((n) => ({ behaviour: n.label, yesDays: n.yes, noDays: n.no })),
        };
      },
    }),
    get_health: tool({
      description: t("tool.get_health"),
      inputSchema: z.object({ day: Day(t("tool.get_health.day")) }),
      execute: async ({ day }) => {
        const d = await dayOf(ctx, day);
        // The web's todayOf reads ctx.now; the phone's reads ctx.today, so the dated context moves both.
        const dated = { ...ctx, today: d, now: Math.min(ctx.now, dayStartOf(ctx, addDays(d, 1)) - 1) };
        const [mon, hub, fit] = await Promise.all([getMonitor(d, dated), getHealthHub(dated), getFitness(dated)]);
        return {
          day: d,
          asOf: hub.day,
          trainingLoad: fit.trainingLoad,
          vitals: mon.vitals.map((v) => ({ vital: v.label, unit: v.unit, ...num(v.metric, 1), status: v.status, range: v.range })),
          illness: mon.illness,
          pulseAge: { value: hub.healthspan.value ? { years: round(hub.healthspan.value.pulseAge, 1), vsActualAge: round(hub.healthspan.value.deltaYears, 1) } : null, reason: hub.healthspan.reason, provisional: hub.healthspan.provisional },
          vo2max: { value: hub.fitness.value ? { vo2max: round(hub.fitness.value.vo2max, 1), category: hub.fitness.value.category } : null, reason: hub.fitness.reason, provisional: hub.fitness.provisional },
          trainingLoadRatio: hub.fitness.value?.acwr ?? null,
        };
      },
    }),
    get_report: tool({
      description: t("tool.get_report"),
      inputSchema: z.object({ kind: z.enum(["week", "month"]).default("week").describe(t("tool.get_report.kind")) }),
      execute: async ({ kind }) => {
        // The web reads More's latestWeek / latestMonth, which are this same latestReport.
        const latest = await latestReport(ctx, kind);
        const r = latest && (await getReport(latest.period, ctx));
        if (!r) return { report: null, reason: "no_data" };
        return {
          period: r.period,
          start: r.start,
          end: r.end,
          partial: r.partial,
          scores: r.dials.map((d) => ({ score: d.label, ...num(d.metric, 1), changeVsPrevious: d.delta })),
          averages: r.averages.map((a) => ({ label: a.label, unit: a.unit ?? null, ...num(a.metric, 1) })),
          trainingBalance: r.trainingBalance.value?.line ?? null,
          bestWorst: r.bestWorst,
          summary: r.insight,
        };
      },
    }),
    get_profile: tool({
      description: t("tool.get_profile"),
      inputSchema: z.object({}),
      execute: async () => {
        const p = ctx.profile;
        const age = Math.floor((Date.parse(todayOf(ctx)) - Date.parse(p.birthDate)) / (365.2425 * 86_400_000));
        return { age, sex: p.sex, maxHr: p.maxHr, timeZone: ctx.timeZone, firstDayWithData: await firstDay(ctx), today: todayOf(ctx), weekAgo: addDays(todayOf(ctx), -7) };
      },
    }),
    get_how_it_works: tool({
      description: t("tool.get_how_it_works"),
      inputSchema: z.object({
        topic: z.string().optional().describe(t("tool.get_how_it_works.topic")),
      }),
      execute: async ({ topic }) => howItWorksDigest(topic),
    }),
    get_app_stats: tool({
      description: t("tool.get_app_stats"),
      inputSchema: z.object({}),
      execute: async () => appStatsDigest(ctx),
    }),
    log_nutrition: tool({
      description: t("tool.log_nutrition"),
      inputSchema: z.object({
        name: z.string().describe(t("tool.log_nutrition.name")),
        meal: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]).describe(t("tool.log_nutrition.meal")),
        kcal: z.number().int().min(1).max(10000).describe(t("tool.log_nutrition.kcal")),
        protein: z.number().min(0).max(1000).optional().describe(t("tool.log_nutrition.protein")),
        carbs: z.number().min(0).max(1000).optional().describe(t("tool.log_nutrition.carbs")),
        fat: z.number().min(0).max(1000).optional().describe(t("tool.log_nutrition.fat")),
        fiber: z.number().min(0).max(1000).optional().describe(t("tool.log_nutrition.fiber")),
        portion: z.string().optional().describe(t("tool.log_nutrition.portion")),
        at: z.string().optional().describe(t("tool.log_nutrition.at")),
      }),
      execute: async ({ name, meal, kcal, protein, carbs, fat, fiber, portion, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const r = await logEntry(actCtx, {
          kind: "food",
          meal: meal as Meal,
          name: name.trim(),
          kcal,
          protein: protein != null ? Math.round(protein * 10) / 10 : null,
          carbs: carbs != null ? Math.round(carbs * 10) / 10 : null,
          fat: fat != null ? Math.round(fat * 10) / 10 : null,
          fiber: fiber != null ? Math.round(fiber * 10) / 10 : null,
          portion: portion?.trim(),
          via: "text",
          at,
        });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log meal: ${r.error}` };
        dataChanged();
        const syncNote = r.warning ? `Saved locally, but Health Connect sync failed (${r.warning}).` : "Saved and synced to Health Connect.";
        return {
          ok: true,
          entry: { kind: "food", name: name.trim(), meal, kcal, protein: protein ?? null, carbs: carbs ?? null, fat: fat ?? null, fiber: fiber ?? null, portion: portion ?? null },
          message: `Logged ${name.trim()} (${kcal} kcal) for ${meal.toLowerCase()}. ${syncNote}`,
        };
      },
    }),
    log_water: tool({
      description: t("tool.log_water"),
      inputSchema: z.object({
        ml: z.number().int().min(10).max(5000).describe(t("tool.log_water.ml")),
        at: z.string().optional().describe(t("tool.log_water.at")),
      }),
      execute: async ({ ml, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const r = await logEntry(actCtx, { kind: "water", ml, at });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log water: ${r.error}` };
        dataChanged();
        const syncNote = r.warning ? `Saved locally, but Health Connect sync failed (${r.warning}).` : "Saved and synced to Health Connect.";
        return {
          ok: true,
          entry: { kind: "water", ml },
          message: `Logged ${ml} ml of water. ${syncNote}`,
        };
      },
    }),
    log_weight: tool({
      description: t("tool.log_weight"),
      inputSchema: z.object({
        kg: z.number().min(20).max(300).describe(t("tool.log_weight.kg")),
        fatPct: z.number().min(2).max(75).optional().describe(t("tool.log_weight.fatPct")),
        at: z.string().optional().describe(t("tool.log_weight.at")),
      }),
      execute: async ({ kg, fatPct, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const roundedKg = Math.round(kg * 10) / 10;
        const roundedFat = fatPct != null ? Math.round(fatPct * 10) / 10 : null;
        const r = await logEntry(actCtx, { kind: "weight", kg: roundedKg, fatPct: roundedFat, at });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log weight: ${r.error}` };
        dataChanged();
        const syncNote = r.warning ? `Saved locally, but Health Connect sync failed (${r.warning}).` : "Saved, updated Health Age, and synced to Health Connect.";
        return {
          ok: true,
          entry: { kind: "weight", kg: roundedKg, fatPct: roundedFat },
          message: `Logged weight ${roundedKg} kg${roundedFat != null ? ` (${roundedFat}% body fat)` : ""}. ${syncNote}`,
        };
      },
    }),
    log_spo2: tool({
      description: t("tool.log_spo2"),
      inputSchema: z.object({
        pct: z.number().min(70).max(100).describe(t("tool.log_spo2.pct")),
        at: z.string().optional().describe(t("tool.log_spo2.at")),
      }),
      execute: async ({ pct, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const roundedPct = Math.round(pct * 10) / 10;
        const r = await logEntry(actCtx, { kind: "spo2", pct: roundedPct, at });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log SpO2: ${r.error}` };
        dataChanged();
        return {
          ok: true,
          entry: { kind: "spo2", pct: roundedPct },
          message: `Logged blood oxygen (SpO2) at ${roundedPct}%.`,
        };
      },
    }),
    log_mood: tool({
      description: t("tool.log_mood"),
      inputSchema: z.object({
        moods: z.array(z.enum(["HAPPY", "CALM", "ENERGIZED", "CONTENT", "GRATEFUL", "EXCITED", "FATIGUED", "STRESSED", "ANXIOUS", "IRRITATED", "SAD", "OVERWHELMED", "LONELY"])).min(1).max(5).describe(t("tool.log_mood.moods")),
        valence: z.enum(["UNPLEASANT", "BASELINE", "PLEASANT"]).optional().describe(t("tool.log_mood.valence")),
        at: z.string().optional().describe(t("tool.log_mood.at")),
      }),
      execute: async ({ moods, valence, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const r = await logEntry(actCtx, { kind: "mood", moods: moods as Mood[], valence: (valence as Valence) ?? null, at });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log mood: ${r.error}` };
        dataChanged();
        return {
          ok: true,
          entry: { kind: "mood", moods, valence: valence ?? null },
          message: `Logged mood: ${moods.join(", ").toLowerCase()}${valence ? ` (${valence.toLowerCase()})` : ""}.`,
        };
      },
    }),
    log_symptoms: tool({
      description: t("tool.log_symptoms"),
      inputSchema: z.object({
        symptoms: z.array(z.enum(["HEADACHE", "FATIGUE", "SICK", "FEVER", "COUGH", "NAUSEA", "DIZZINESS", "BRAIN_FOG", "BACK_PAIN", "JOINT_PAIN", "INSOMNIA", "HEARTBURN", "BLOATED", "DIARRHEA", "CONSTIPATION", "CRAMPS", "TENDER_BREASTS", "PMS", "ACNE", "HOT_FLASHES"])).min(1).describe(t("tool.log_symptoms.symptoms")),
        at: z.string().optional().describe(t("tool.log_symptoms.at")),
      }),
      execute: async ({ symptoms, at }) => {
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const r = await logEntry(actCtx, { kind: "symptoms", symptoms: symptoms as Symptom[], at });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log symptoms: ${r.error}` };
        dataChanged();
        return {
          ok: true,
          entry: { kind: "symptoms", symptoms },
          message: `Logged symptoms: ${symptoms.map((s) => s.toLowerCase().replaceAll("_", " ")).join(", ")}.`,
        };
      },
    }),
    log_journal_behavior: tool({
      description: t("tool.log_journal_behavior"),
      inputSchema: z.object({
        tag: z.string().describe(t("tool.log_journal_behavior.tag")),
        value: z.union([z.boolean(), z.number().int().min(0).max(1000)]).describe(t("tool.log_journal_behavior.value")),
        day: z.string().optional().describe(t("tool.log_journal_behavior.day")),
      }),
      execute: async ({ tag, value, day }) => {
        const d = day && day <= ctx.today ? day : ctx.today;
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        const rows = await tagRows(ctx.store);
        const known = rows.some((t) => t.tag === tag);
        if (!known) {
          const cat = behavior(tag);
          if (cat) {
            await ctx.store.insertJournalTags([{ tag, label: cat.label, isDefault: false, hidden: false, position: 0 }]);
          } else {
            await addTag(ctx.store, tag, tag.replaceAll("_", " "));
          }
        }
        const r = await saveJournalEntry(actCtx, { day: d, tag, value });
        if (!r.ok) return { ok: false, error: r.error, message: `Failed to log journal habit: ${r.error}` };
        dataChanged();
        return {
          ok: true,
          entry: { kind: "journal", tag, value, day: d },
          message: `Logged habit '${tag}' (${value}) for ${d}. Health will calculate its impact on Recovery.`,
        };
      },
    }),
    log_cycle: tool({
      description: t("tool.log_cycle"),
      inputSchema: z.object({
        kind: z.enum(["period", "ovulation"]).describe(t("tool.log_cycle.kind")),
        start: z.string().optional().describe(t("tool.log_cycle.start")),
        end: z.string().optional().describe(t("tool.log_cycle.end")),
        flow: z.enum(["SPOTTING", "LIGHT", "MEDIUM", "HEAVY"]).optional().describe(t("tool.log_cycle.flow")),
        ovulationResult: z.enum(["NEGATIVE", "POSITIVE", "LUTEINIZING_HORMONE_SURGE", "ESTROGEN_SURGE", "INDETERMINATE"]).optional().describe(t("tool.log_cycle.ovulationResult")),
        at: z.string().optional().describe(t("tool.log_cycle.at")),
      }),
      execute: async ({ kind, start, end, flow, ovulationResult, at }) => {
        if (ctx.profile.sex !== "female") {
          return { ok: false, error: "Cycle tracking is only available for female profiles.", message: "Cycle tracking is only available for female profiles." };
        }
        const actCtx = { store: ctx.store, profile: ctx.profile, timeZone: ctx.timeZone, nowS: () => ctx.now };
        if (kind === "period") {
          if (!start || !end) return { ok: false, error: "Start and end dates are required for period tracking.", message: "Start and end dates are required." };
          const r = await logEntry(actCtx, { kind: "period", start, end, flow: (flow as Flow) ?? null });
          if (!r.ok) return { ok: false, error: r.error, message: `Failed to log period: ${r.error}` };
          dataChanged();
          return { ok: true, entry: { kind: "period", start, end, flow: flow ?? null }, message: `Logged period from ${start} to ${end}${flow ? ` (${flow.toLowerCase()})` : ""}.` };
        } else {
          if (!ovulationResult) return { ok: false, error: "Ovulation result is required.", message: "Ovulation result is required." };
          const r = await logEntry(actCtx, { kind: "ovulation", result: ovulationResult as OvulationResult, at });
          if (!r.ok) return { ok: false, error: r.error, message: `Failed to log ovulation: ${r.error}` };
          dataChanged();
          return { ok: true, entry: { kind: "ovulation", result: ovulationResult }, message: `Logged ovulation test result: ${ovulationResult.toLowerCase()}.` };
        }
      },
    }),
  };
}

export type CoachTools = ReturnType<typeof coachTools>;

export type CoachOutputs = { [K in keyof CoachTools]: InferToolOutput<CoachTools[K]> };
