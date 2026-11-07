// Settings › Lifestyle, Goals & Containers: user-editable profile context for AI coaching,
// Gemini vision calorie tracking, and the daily focus HUD widget.
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react-native";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { cn } from "@/ui/cn";
import { setLifestyle, useApp } from "@/state/app";
import { useGoals } from "@/state/goals";
import { saveNutritionTargets, useNutritionTargets } from "@/state/nutrition";
import type { ContainerSpec, LifestyleProfile } from "@/data/types";
import { DetailShell } from "@/ui/shells/DetailShell";
import { GROUP_LABEL } from "@/ui/shells/LinkList";
import { Field, ROW_RULE, SmallButton, SwitchRow, TextField } from "@/screens/settings/controls";
import { goBack } from "@/ui/navigate";

const DEFAULT_CONTAINERS: ContainerSpec[] = [
  { id: "c1", name: "Hexagon Plate", shape: "hexagon", dimensionText: "32 cm diameter" },
  { id: "c2", name: "Oval Container", shape: "oval", dimensionText: "450 ml volume", capacityMl: 450 },
  { id: "c3", name: "Round Katori", shape: "round", dimensionText: "280 ml volume", capacityMl: 280 },
  { id: "c4", name: "Tea/Coffee Cup", shape: "cup", dimensionText: "120 ml cup", capacityMl: 120 },
];

export function LifestyleSettings() {
  const { t } = useTranslation("settings");
  const currentProfile = useApp((s) => s.profile);
  const currentLifestyle = currentProfile?.lifestyle;

  const [targetWeight, setTargetWeight] = useState(
    currentLifestyle?.targetWeightKg ? String(currentLifestyle.targetWeightKg) : ""
  );
  const [calMin, setCalMin] = useState(
    currentLifestyle?.calorieTargetMin ? String(currentLifestyle.calorieTargetMin) : ""
  );
  const [calMax, setCalMax] = useState(
    currentLifestyle?.calorieTargetMax ? String(currentLifestyle.calorieTargetMax) : ""
  );
  const [stepGoal, setStepGoal] = useState(
    currentLifestyle?.dailyStepGoal ? String(currentLifestyle.dailyStepGoal) : ""
  );
  const [walkRoutines, setWalkRoutines] = useState(currentLifestyle?.walkRoutines ?? "");
  const [eatingSchedule, setEatingSchedule] = useState(currentLifestyle?.eatingSchedule ?? "");
  const [zeroSugar, setZeroSugar] = useState(currentLifestyle?.zeroRefinedSugar ?? false);
  const [indianCooking, setIndianCooking] = useState(currentLifestyle?.indianCookingFactor ?? false);
  const [hometownMode, setHometownMode] = useState(currentLifestyle?.hometownMode ?? false);
  const [customNotes, setCustomNotes] = useState(currentLifestyle?.customNotes ?? "");
  const [containers, setContainers] = useState<ContainerSpec[]>(
    currentLifestyle?.containers && currentLifestyle.containers.length > 0
      ? currentLifestyle.containers
      : DEFAULT_CONTAINERS
  );

  const [newContainerName, setNewContainerName] = useState("");
  const [newContainerDim, setNewContainerDim] = useState("");
  const [addingContainer, setAddingContainer] = useState(false);
  const [saving, setSaving] = useState(false);

  const { update: updateGoals } = useGoals();
  const { custom: customNutrition } = useNutritionTargets();

  const handleAddContainer = () => {
    if (!newContainerName.trim() || !newContainerDim.trim()) {
      toast.error("Please enter a name and dimensions.");
      return;
    }
    const next: ContainerSpec = {
      id: `c_${Date.now()}`,
      name: newContainerName.trim(),
      shape: "bowl",
      dimensionText: newContainerDim.trim(),
    };
    setContainers([...containers, next]);
    setNewContainerName("");
    setNewContainerDim("");
    setAddingContainer(false);
  };

  const handleRemoveContainer = (id: string) => {
    setContainers(containers.filter((c) => c.id !== id));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const parsedWeight = targetWeight.trim() ? Number(targetWeight.trim()) : null;
      const parsedCalMin = calMin.trim() ? Number(calMin.trim()) : null;
      const parsedCalMax = calMax.trim() ? Number(calMax.trim()) : null;
      const parsedSteps = stepGoal.trim() ? Number(stepGoal.trim()) : null;

      const payload: LifestyleProfile = {
        targetWeightKg: parsedWeight && Number.isFinite(parsedWeight) ? parsedWeight : null,
        calorieTargetMin: parsedCalMin && Number.isFinite(parsedCalMin) ? parsedCalMin : null,
        calorieTargetMax: parsedCalMax && Number.isFinite(parsedCalMax) ? parsedCalMax : null,
        dailyStepGoal: parsedSteps && Number.isFinite(parsedSteps) ? parsedSteps : null,
        walkRoutines: walkRoutines.trim() || null,
        eatingSchedule: eatingSchedule.trim() || null,
        zeroRefinedSugar: zeroSugar,
        indianCookingFactor: indianCooking,
        hometownMode: hometownMode,
        containers,
        customNotes: customNotes.trim() || null,
      };

      await setLifestyle(payload);

      // Also sync step goal to active app goals if set
      if (parsedSteps && parsedSteps >= 1000 && parsedSteps <= 50000) {
        await updateGoals((g) => ({
          ...g,
          targets: { ...g.targets, steps: parsedSteps },
          enabled: { ...g.enabled, steps: true },
        }));
      }

      // Also sync calories to nutrition targets if max is set
      if (parsedCalMax && parsedCalMax >= 800 && parsedCalMax <= 8000) {
        await saveNutritionTargets({
          ...customNutrition,
          kcal: parsedCalMax,
        });
      }

      toast.success(t("lifestyle.saved"));
      goBack();
    } catch {
      toast.error(t("lifestyle.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailShell
      title={t("lifestyle.title")}
      backHref="/more"
      primary={
        <View className="gap-6 pb-12">
          {/* Intro */}
          <Text className="text-sm leading-5 text-muted-foreground">
            {t("lifestyle.intro")}
          </Text>

          {/* 1. Targets & Calorie Range */}
          <View className="gap-2">
            <Text className={GROUP_LABEL}>{t("lifestyle.groupTargets")}</Text>
            <Card className="gap-4 p-4">
              <Field label={t("lifestyle.targetWeight")} hint={t("lifestyle.targetWeightHint")}>
                <TextField
                  variant="input"
                  inputMode="decimal"
                  placeholder="e.g. 75"
                  value={targetWeight}
                  onChangeText={setTargetWeight}
                />
              </Field>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Field label={t("lifestyle.calMin")} hint={t("lifestyle.calMinHint")}>
                    <TextField
                      variant="input"
                      inputMode="numeric"
                      placeholder="e.g. 1800"
                      value={calMin}
                      onChangeText={setCalMin}
                    />
                  </Field>
                </View>
                <View className="flex-1">
                  <Field label={t("lifestyle.calMax")} hint={t("lifestyle.calMaxHint")}>
                    <TextField
                      variant="input"
                      inputMode="numeric"
                      placeholder="e.g. 2000"
                      value={calMax}
                      onChangeText={setCalMax}
                    />
                  </Field>
                </View>
              </View>
            </Card>
          </View>

          {/* 2. Walking & Daily Steps */}
          <View className="gap-2">
            <Text className={GROUP_LABEL}>{t("lifestyle.groupCardio")}</Text>
            <Card className="gap-4 p-4">
              <Field label={t("lifestyle.stepGoal")} hint={t("lifestyle.stepGoalHint")}>
                <TextField
                  variant="input"
                  inputMode="numeric"
                  placeholder="e.g. 20000"
                  value={stepGoal}
                  onChangeText={setStepGoal}
                />
              </Field>

              <Field
                label={t("lifestyle.walkRoutines")}
                hint={t("lifestyle.walkRoutinesHint")}
              >
                <TextField
                  variant="input"
                  multiline
                  placeholder="e.g. Office commute Mon-Fri (7k steps), 15-min post-lunch walk (2.5k steps), evening terrace walk (10k steps)"
                  value={walkRoutines}
                  onChangeText={setWalkRoutines}
                />
              </Field>
            </Card>
          </View>

          {/* 3. Nutrition & Cooking Habits */}
          <View className="gap-2">
            <Text className={GROUP_LABEL}>{t("lifestyle.groupNutrition")}</Text>
            <Card>
              <SwitchRow
                label={t("lifestyle.indianCooking")}
                hint={t("lifestyle.indianCookingHint")}
                value={indianCooking}
                onChange={setIndianCooking}
              />
              <View className="px-4">
                <View className="border-t border-border" />
              </View>
              <SwitchRow
                label={t("lifestyle.zeroSugar")}
                hint={t("lifestyle.zeroSugarHint")}
                value={zeroSugar}
                onChange={setZeroSugar}
              />
              <View className="px-4">
                <View className="border-t border-border" />
              </View>
              <View className="p-4">
                <Field label={t("lifestyle.eatingSchedule")} hint={t("lifestyle.eatingScheduleHint")}>
                  <TextField
                    variant="input"
                    placeholder="e.g. Skip weekday breakfast, lunch at 1:30 PM, dinner at 8:30 PM"
                    value={eatingSchedule}
                    onChangeText={setEatingSchedule}
                  />
                </Field>
              </View>
            </Card>
          </View>

          {/* 4. Container & Dish Reference Anchors */}
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className={GROUP_LABEL}>{t("lifestyle.groupContainers")}</Text>
              <SmallButton
                icon={Plus}
                label={t("lifestyle.addContainer")}
                onPress={() => setAddingContainer(!addingContainer)}
              />
            </View>
            <Text className="text-xs text-muted-foreground px-1">
              {t("lifestyle.containersHint")}
            </Text>

            <Card>
              {containers.map((c, i) => (
                <View key={c.id} className={cn("p-4 flex-row items-center justify-between", i > 0 && ROW_RULE)}>
                  <View className="flex-1 pr-3">
                    <Text className="text-[15px] font-semibold leading-5 text-foreground">{c.name}</Text>
                    <Text className="text-xs text-foreground-secondary">{c.dimensionText}</Text>
                  </View>
                  <Press
                    activeScale={0.92}
                    onPress={() => handleRemoveContainer(c.id)}
                    className="size-9 items-center justify-center rounded-lg bg-fill-faint"
                  >
                    <Icon icon={Trash2} size={16} tone="recovery-red-text" />
                  </Press>
                </View>
              ))}

              {addingContainer && (
                <View className="gap-3 p-4 border-t border-border bg-inset rounded-b-2xl">
                  <Text className="text-xs font-bold uppercase text-foreground-secondary">{t("lifestyle.newContainer")}</Text>
                  <TextField
                    variant="input"
                    placeholder="Name (e.g. Office Tiffin Box)"
                    value={newContainerName}
                    onChangeText={setNewContainerName}
                  />
                  <TextField
                    variant="input"
                    placeholder="Dimensions / Volume (e.g. 500 ml oval or 24 cm round)"
                    value={newContainerDim}
                    onChangeText={setNewContainerDim}
                  />
                  <View className="flex-row gap-2 justify-end pt-1">
                    <SmallButton label={t("lifestyle.cancel")} onPress={() => setAddingContainer(false)} />
                    <SmallButton label={t("lifestyle.saveContainer")} onPress={handleAddContainer} />
                  </View>
                </View>
              )}
            </Card>
          </View>

          {/* 5. Travel & Hometown Mode */}
          <View className="gap-2">
            <Text className={GROUP_LABEL}>{t("lifestyle.groupTravel")}</Text>
            <Card>
              <SwitchRow
                label={t("lifestyle.hometownMode")}
                hint={t("lifestyle.hometownModeHint")}
                value={hometownMode}
                onChange={setHometownMode}
              />
            </Card>
          </View>

          {/* 6. Custom Notes */}
          <View className="gap-2">
            <Text className={GROUP_LABEL}>{t("lifestyle.groupAiContext")}</Text>
            <Card className="p-4">
              <Field label={t("lifestyle.customNotes")} hint={t("lifestyle.customNotesHint")}>
                <TextField
                  variant="input"
                  multiline
                  placeholder="e.g. Quitting social media to improve focus at work; prefer direct and pragmatic advice with physiological reasons explained."
                  value={customNotes}
                  onChangeText={setCustomNotes}
                />
              </Field>
            </Card>
          </View>

          {/* Save Button */}
          <Button
            onPress={onSave}
            disabled={saving}
            className="mt-2"
          >
            <Text className="font-semibold text-primary-foreground">
              {saving ? t("lifestyle.saving") : t("lifestyle.save")}
            </Text>
          </Button>
        </View>
      }
    />
  );
}
