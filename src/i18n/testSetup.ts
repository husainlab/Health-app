// Vitest setup: i18next in English, synchronously, so tests that read copy keep asserting English.
import { vi } from "vitest";
import { initI18n } from "./config";
import "./types";

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  PermissionsAndroid: { check: vi.fn(async () => false) },
}));

vi.mock("react-native-health-connect", () => ({
  initialize: vi.fn(async () => true),
  getSdkStatus: vi.fn(async () => 1),
  getGrantedPermissions: vi.fn(async () => []),
  requestPermission: vi.fn(async () => []),
  readRecords: vi.fn(async () => ({ records: [], pageToken: undefined })),
  insertRecords: vi.fn(async () => []),
  deleteRecordsByUuids: vi.fn(async () => {}),
  openHealthConnectSettings: vi.fn(),
  getChanges: vi.fn(async () => ({ nextChangesToken: "tok", upsertionChanges: [], deletionChanges: [], hasMore: false, changesTokenExpired: false })),
  SdkAvailabilityStatus: { SDK_AVAILABLE: 1, SDK_UNAVAILABLE: 2, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 3 },
  MealType: { UNKNOWN: 0, BREAKFAST: 1, LUNCH: 2, DINNER: 3, SNACK: 4 },
}));

initI18n("en");
