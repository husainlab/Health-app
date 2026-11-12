// Metabolic Risk `/health/metabolic`: latest weekly composite score, Monday history, and 5 contributing signals.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import type { MetabolicBand } from "@/core/algorithms/metabolicRisk";
import type { ChipTone } from "@/lib/bands";
import { DAY, formatDay, formatValue } from "@/lib/format";
import { getMetabolicRisk } from "@/queries/health";
import type { MetabolicRiskVM } from "@/queries/types";
import { TrendChart, TrendChartSkeleton } from "@/ui/charts/TrendChart";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { InsightCard, InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { CAPTION, StatusChip } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { TickScale, TickScaleSkeleton } from "@/ui/metrics/TickScale";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { ErrorView } from "./ErrorView";
import { METABOLIC_INFO, metabolicContributorLabel } from "./info";

const BAND_TONE: Record<MetabolicBand, ChipTone> = {
  low: "optimal",
  moderate: "neutral",
  elevated: "warning",
  high: "alert",
};

function Hero({ result }: { result: MetabolicRiskVM["result"] }) {
  const { t } = useTranslation("health");
  const v = result.value;
  if (!v) {
    return (
      <View className="items-center gap-2 py-4">
        <ReasonPlaceholder
          reason={result.reason}
          nightsLeft={result.nightsLeft}
          size="md"
          copy={result.reason === "calibrating" ? t("metabolic.calibrating") : undefined}
        />
        <Text className={cn(CAPTION, "text-center")}>{t("metabolic.disclaimer")}</Text>
      </View>
    );
  }
  return (
    <View className="items-center gap-2 py-4">
      <Text className="text-center font-numeric text-[64px] font-bold leading-[64px] tracking-[-0.01em] tabular-nums">
        {formatValue("int", v.score)}
      </Text>
      <StatusChip tone={BAND_TONE[v.band]} className="self-center">
        {t(`metabolic.band.${v.band}`)}
      </StatusChip>
      <Text className={CAPTION}>{t("metabolic.updatedCaption", { day: formatDay(v.publishedDay, DAY.monthDay) })}</Text>
      <Text className={cn(CAPTION, "text-center")}>{t("metabolic.disclaimer")}</Text>
    </View>
  );
}

export function MetabolicScreen() {
  const { t } = useTranslation("health");
  const { data: vm, error, reload } = useScreen((ctx) => getMetabolicRisk(ctx), ["metabolic-risk"]);
  if (!vm) return error ? <ErrorView detail retry={reload} /> : <MetabolicLoading />;
  const v = vm.result.value;

  return (
    <DetailShell
      title={t("title.metabolicRisk")}
      bodySkeleton={bodySkeleton()}
      info={METABOLIC_INFO}
      hero={<Hero result={vm.result} />}
      summary={
        <SectionShell variant="card" title={t("metabolic.scaleTitle")} info={false}>
          <TickScale
            variant="meter"
            label={t("title.metabolicRisk")}
            metric={v ? { value: v.score, reason: null, provisional: false } : { value: null, reason: vm.result.reason, provisional: false }}
            min={0}
            max={100}
            format="int"
            describe={v ? t(`metabolic.band.${v.band}`) : undefined}
            ends={[t("metabolic.scaleLow"), t("metabolic.scaleMid"), t("metabolic.scaleHigh")]}
          />
        </SectionShell>
      }
      insight={
        v ? (
          <InsightCard
            title={t("metabolic.insightTitle")}
            body={
              v.topContributors.length > 0
                ? t("metabolic.insightTop", {
                    signals: v.topContributors.map((c) => metabolicContributorLabel(c)).join(", "),
                  })
                : t("metabolic.insightBalanced")
            }
          />
        ) : undefined
      }
      primary={
        <View className="gap-3">
          {vm.history.length >= 2 && (
            <SectionShell variant="card" title={t("metabolic.historyTitle")} info={false}>
              <TrendChart
                label={t("title.metabolicRisk")}
                data={{ value: vm.history.map((p) => ({ date: p.day, value: p.value })), reason: null, provisional: false }}
                format="int"
                colorBy="single"
                level
                fixedRange="6m"
                reference={{ y: 50, label: t("metabolic.baselineRef") }}
              />
            </SectionShell>
          )}
          <SectionShell variant="card" title={t("metabolic.signalsTitle")} info={false}>
            <Divided>
              {vm.contributors.map((c) => (
                <KeyStatRow
                  key={c.key}
                  variant="row"
                  label={c.label}
                  metric={c.metric}
                  unit={c.unit}
                  format={c.format}
                  average={c.average}
                  averageLabel={t("metabolic.priorAverage")}
                  sd={c.sd}
                  direction={c.direction}
                />
              ))}
            </Divided>
            <Text className={cn(CAPTION, "mt-2")}>{t("metabolic.signalsLegend")}</Text>
          </SectionShell>
        </View>
      }
    />
  );
}

const loadingPrimary = () => (
  <View className="gap-3">
    <SectionShell variant="card" title={i18n.t("health:metabolic.historyTitle")} info={false}>
      <TrendChartSkeleton />
    </SectionShell>
    <SectionShell variant="card" title={i18n.t("health:metabolic.signalsTitle")} info={false}>
      <Divided>
        {(["rhr", "hrv", "sleep", "steps", "resp"] as const).map((k) => (
          <KeyStatRowSkeleton key={k} variant="row" label={i18n.t(`health:metabolic.contributor.${k}`)} />
        ))}
      </Divided>
    </SectionShell>
  </View>
);

const bodySkeleton = () => loadingPrimary();

function MetabolicLoading() {
  const { t } = useTranslation("health");
  return (
    <DetailShell
      loading
      title={t("title.metabolicRisk")}
      hero={
        <View accessibilityElementsHidden className="items-center gap-2 py-4">
          <SkeletonText lh={64} fs={64} className="w-[88px]" />
          <Skeleton className="h-6 w-20 rounded-md" />
          <SkeletonText className="w-28" />
          <SkeletonText className="w-52" />
        </View>
      }
      summary={
        <SectionShell variant="card" title={t("metabolic.scaleTitle")} info={false}>
          <View accessibilityElementsHidden>
            <TickScaleSkeleton variant="meter" />
          </View>
        </SectionShell>
      }
      insight={<InsightCardSkeleton title />}
      primary={loadingPrimary()}
      bodySkeleton={bodySkeleton()}
    />
  );
}
