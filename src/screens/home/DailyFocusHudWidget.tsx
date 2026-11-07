// The interactive Daily Focus & Energy HUD widget on the Home screen.
// Integrates live Energy Bank, Walking Steps toward the daily goal, Calorie Deficit,
// and 1-tap quick action buttons ([📸 Snap Meal], [💧 +250ml Water], [🚶 Start Walk], [💬 Coach]).
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Camera, Droplets, Footprints, MessageSquare, Sparkles, TrendingUp, Zap } from "lucide-react-native";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { toast } from "@/ui/Toast";
import { haptic } from "@/ui/haptics";
import { cn } from "@/ui/cn";
import { push } from "@/ui/navigate";
import { logEntry } from "@/actions/log";
import { actionCtx, dataChanged, useApp } from "@/state/app";
import { useGoals } from "@/state/goals";
import type { KeyStat, EnergyBankVM } from "@/queries/types";
import type { Metric } from "@/lib/reasons";

export function DailyFocusHudWidget({ vm }: { vm: { energyBank?: Metric<EnergyBankVM>; cardStats?: Record<string, KeyStat> } }) {
  const { t } = useTranslation("home");
  const profile = useApp((s) => s.profile);
  const lifestyle = profile?.lifestyle;
  const { goals } = useGoals();

  const [waterLogging, setWaterLogging] = useState(false);

  // 1. Energy & Focus Window calculation
  const energyVal = vm.energyBank?.value?.current ?? null;
  const currentHour = new Date().getHours();

  let focusTitle = t("hud.windowBalanced");
  let focusTone = "text-foreground-secondary";
  let focusEmoji = "⚡";

  if (currentHour >= 8 && currentHour < 13) {
    focusTitle = t("hud.windowPeak");
    focusTone = "text-emerald-400";
    focusEmoji = "🚀";
  } else if (currentHour >= 13 && currentHour < 16) {
    focusTitle = t("hud.windowDip");
    focusTone = "text-amber-400";
    focusEmoji = "☕";
  } else if (currentHour >= 17 && currentHour < 21) {
    focusTitle = t("hud.windowWalk");
    focusTone = "text-blue-400";
    focusEmoji = "🚶";
  } else if (currentHour >= 21) {
    focusTitle = t("hud.windowWinddown");
    focusTone = "text-purple-400";
    focusEmoji = "🌙";
  }

  // 2. Steps toward goal
  const stepsToday = vm.cardStats?.steps?.metric?.value ?? 0;
  const stepTarget = lifestyle?.dailyStepGoal ?? goals?.targets?.steps ?? 10000;
  const stepPct = Math.min(100, Math.round((stepsToday / stepTarget) * 100));

  // 3. Calories & Deficit
  const burnedKcal = vm.cardStats?.calories?.metric?.value ?? null;
  const targetKcalMin = lifestyle?.calorieTargetMin ?? 1800;
  const targetKcalMax = lifestyle?.calorieTargetMax ?? 2000;

  // 4. Quick Action: 1-Tap Water Log
  const handleQuickWater = async () => {
    if (waterLogging) return;
    setWaterLogging(true);
    haptic.tap();
    try {
      const actCtx = actionCtx();
      await logEntry(actCtx, { kind: "water", ml: 250 });
      dataChanged();
      toast.success("Logged 250 ml water! Stay hydrated for mental focus.");
    } catch {
      toast.error("Could not log water.");
    } finally {
      setWaterLogging(false);
    }
  };

  return (
    <View className="mb-4 gap-3">
      <Card className="overflow-hidden p-4">
        {/* Header: Title and Hometown/Lifestyle badge */}
        <View className="flex-row items-center justify-between pb-3 border-b border-border">
          <View className="flex-row items-center gap-2">
            <Icon icon={Zap} size={18} tone="warning" />
            <Text className="text-xs font-bold uppercase tracking-[0.12em] text-foreground-secondary">
              {t("hud.title")}
            </Text>
          </View>
          {lifestyle?.hometownMode ? (
            <View className="rounded-full bg-amber-500/15 px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-amber-400">{t("hud.hometown")}</Text>
            </View>
          ) : lifestyle?.targetWeightKg ? (
            <View className="rounded-full bg-brand/15 px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-brand">
                {t("hud.targetBadge", { target: lifestyle.targetWeightKg })}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Focus & Energy State */}
        <View className="py-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-sm">{focusEmoji}</Text>
              <Text className={cn("text-[14px] font-semibold leading-5", focusTone)}>{focusTitle}</Text>
            </View>
            {energyVal !== null && (
              <Text className="text-xs font-medium text-muted-foreground tabular-nums">
                {t("hud.battery", { val: Math.round(energyVal) })}
              </Text>
            )}
          </View>
        </View>

        {/* Stats Grid: Steps & Calories */}
        <View className="gap-2.5 rounded-xl bg-inset p-3">
          {/* Steps */}
          <View className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <Icon icon={Footprints} size={15} tone="foreground-secondary" />
                <Text className="text-xs font-medium text-foreground-secondary">{t("hud.walkingCardio")}</Text>
              </View>
              <Text className="text-xs font-semibold tabular-nums text-foreground">
                {t("hud.stepsProgress", { steps: stepsToday.toLocaleString(), target: stepTarget.toLocaleString(), pct: stepPct })}
              </Text>
            </View>
            {/* Progress Bar */}
            <View className="h-2 w-full overflow-hidden rounded-full bg-border">
              <View
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${stepPct}%` }}
              />
            </View>
          </View>

          {/* Calorie Target / Burn */}
          <View className="flex-row items-center justify-between pt-1">
            <View className="flex-row items-center gap-1.5">
              <Icon icon={TrendingUp} size={15} tone="foreground-secondary" />
              <Text className="text-xs font-medium text-foreground-secondary">{t("hud.deficitPlan")}</Text>
            </View>
            <Text className="text-xs font-semibold tabular-nums text-foreground">
              {t("hud.deficitText", {
                burned: burnedKcal ? t("hud.burnedKcal", { kcal: Math.round(burnedKcal) }) : t("hud.fitbitSyncing"),
                min: targetKcalMin,
                max: targetKcalMax,
              })}
            </Text>
          </View>
        </View>

        {/* 1-Tap Quick Action Row */}
        <View className="flex-row gap-2 pt-3">
          {/* Snap Meal */}
          <Press
            activeScale={0.95}
            onPress={() => push("/food")}
            className="flex-1 items-center justify-center gap-1 rounded-xl bg-fill-faint py-2.5"
          >
            <Icon icon={Camera} size={18} tone="foreground" />
            <Text className="text-[11px] font-semibold text-foreground">{t("hud.snapMeal")}</Text>
          </Press>

          {/* +250ml Water */}
          <Press
            activeScale={0.95}
            onPress={handleQuickWater}
            disabled={waterLogging}
            className="flex-1 items-center justify-center gap-1 rounded-xl bg-fill-faint py-2.5"
          >
            <Icon icon={Droplets} size={18} tone="coach" />
            <Text className="text-[11px] font-semibold text-foreground">{t("hud.water250")}</Text>
          </Press>

          {/* Walk / Pacing */}
          <Press
            activeScale={0.95}
            onPress={() => push("/workout-live")}
            className="flex-1 items-center justify-center gap-1 rounded-xl bg-fill-faint py-2.5"
          >
            <Icon icon={Footprints} size={18} tone="recovery-green" />
            <Text className="text-[11px] font-semibold text-foreground">{t("hud.startWalk")}</Text>
          </Press>

          {/* Ask Coach */}
          <Press
            activeScale={0.95}
            onPress={() => push("/coach")}
            className="flex-1 items-center justify-center gap-1 rounded-xl bg-fill-faint py-2.5"
          >
            <Icon icon={MessageSquare} size={18} tone="coach" />
            <Text className="text-[11px] font-semibold text-foreground">{t("hud.askCoach")}</Text>
          </Press>
        </View>

        {/* Anti-Doomscrolling Focus Nudge */}
        <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-fill-faint px-3 py-2">
          <Icon icon={Sparkles} size={14} tone="coach" />
          <Text className="flex-1 text-[12px] leading-4 text-muted-foreground">
            {currentHour >= 12 && currentHour <= 15 ? t("hud.focusAfternoon") : t("hud.focusGeneral")}
          </Text>
        </View>
      </Card>
    </View>
  );
}
