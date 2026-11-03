// Maps Pulse logged entries to HealthConnectRecord for writing to Android Health Connect.
import type { HealthConnectRecord } from "react-native-health-connect";
import { MealType } from "./import";
import type { Meal } from "@/queries/log";

const MEAL_MAP: Record<Meal, number> = {
  BREAKFAST: MealType.BREAKFAST,
  LUNCH: MealType.LUNCH,
  DINNER: MealType.DINNER,
  SNACK: MealType.SNACK,
};

export function toHealthConnectWaterRecord(ml: number, tsSec: number): HealthConnectRecord {
  const startTime = new Date(tsSec * 1000).toISOString();
  const endTime = new Date((tsSec + 1) * 1000).toISOString();
  return {
    recordType: "Hydration",
    startTime,
    endTime,
    volume: { value: ml, unit: "milliliters" },
    metadata: {
      recordingMethod: 3, // RECORDING_METHOD_MANUAL_ENTRY
      clientRecordId: `health-hydration-${tsSec}`,
    },
  } as HealthConnectRecord;
}

export function toHealthConnectWeightRecord(kg: number, tsSec: number): HealthConnectRecord {
  const time = new Date(tsSec * 1000).toISOString();
  return {
    recordType: "Weight",
    time,
    weight: { value: kg, unit: "kilograms" },
    metadata: {
      recordingMethod: 3, // RECORDING_METHOD_MANUAL_ENTRY
      clientRecordId: `health-weight-${tsSec}`,
    },
  } as HealthConnectRecord;
}

export function toHealthConnectBodyFatRecord(fatPct: number, tsSec: number): HealthConnectRecord {
  const time = new Date(tsSec * 1000).toISOString();
  return {
    recordType: "BodyFat",
    time,
    percentage: fatPct,
    metadata: {
      recordingMethod: 3, // RECORDING_METHOD_MANUAL_ENTRY
      clientRecordId: `health-bodyfat-${tsSec}`,
    },
  } as HealthConnectRecord;
}

export function toHealthConnectNutritionRecord(
  food: { name?: string | null; kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null },
  meal: Meal,
  tsSec: number,
): HealthConnectRecord {
  const startTime = new Date(tsSec * 1000).toISOString();
  const endTime = new Date((tsSec + 1) * 1000).toISOString();
  const mealType = MEAL_MAP[meal] ?? MealType.UNKNOWN;
  const record: Record<string, unknown> = {
    recordType: "Nutrition",
    startTime,
    endTime,
    name: food.name?.trim() || undefined,
    mealType,
    energy: { value: food.kcal, unit: "kilocalories" },
    metadata: {
      recordingMethod: 3, // RECORDING_METHOD_MANUAL_ENTRY
      clientRecordId: `health-nutrition-${tsSec}-${Math.abs(Math.round(food.kcal))}`,
    },
  };
  if (food.protein != null && food.protein > 0) record.protein = { value: food.protein, unit: "grams" };
  if (food.carbs != null && food.carbs > 0) record.totalCarbohydrate = { value: food.carbs, unit: "grams" };
  if (food.fat != null && food.fat > 0) record.totalFat = { value: food.fat, unit: "grams" };
  return record as unknown as HealthConnectRecord;
}
