import { describe, expect, it } from "vitest";
import {
  toHealthConnectBodyFatRecord,
  toHealthConnectNutritionRecord,
  toHealthConnectWaterRecord,
  toHealthConnectWeightRecord,
} from "./write";

describe("Health Connect write record mappers", () => {
  const ts = 1793500000;

  it("maps water to HydrationRecord", () => {
    const record = toHealthConnectWaterRecord(500, ts);
    expect(record).toMatchObject({
      recordType: "Hydration",
      volume: { value: 500, unit: "milliliters" },
    });
  });

  it("maps weight to WeightRecord", () => {
    const record = toHealthConnectWeightRecord(72.5, ts);
    expect(record).toMatchObject({
      recordType: "Weight",
      weight: { value: 72.5, unit: "kilograms" },
    });
  });

  it("maps body fat to BodyFatRecord", () => {
    const record = toHealthConnectBodyFatRecord(18.2, ts);
    expect(record).toMatchObject({
      recordType: "BodyFat",
      percentage: 18.2,
    });
  });

  it("maps food item to NutritionRecord", () => {
    const record = toHealthConnectNutritionRecord(
      { name: "Oatmeal", kcal: 350, protein: 12, carbs: 55, fat: 6 },
      "BREAKFAST",
      ts,
    );
    expect(record).toMatchObject({
      recordType: "Nutrition",
      name: "Oatmeal",
      energy: { value: 350, unit: "kilocalories" },
      protein: { value: 12, unit: "grams" },
      totalCarbohydrate: { value: 55, unit: "grams" },
      totalFat: { value: 6, unit: "grams" },
    });
  });
});
