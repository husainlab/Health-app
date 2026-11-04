// Settings › App (display: theme, units and clock; notifications). Ported from pulse (app)/settings/SettingsView.tsx (Appearance), SettingsClient
// `ThemePicker` and AppSettings.tsx. The theme is system, light or dark, kept on the device (AsyncStorage `pulse.theme`, applied
// at launch by src/state/app.ts boot). The notification toggles live in Settings › Notifications & background
// (NotificationsSection.tsx); this section links there.
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { colorScheme } from "nativewind";
import { Bell, Monitor, Moon, Sun } from "lucide-react-native";
import { saveTheme, type Theme } from "@/actions/preferences";
import { displayPrefs, type UnitSystem } from "@/lib/units";
import { i18n, LANGUAGES, PSEUDO, REVIEWED, showPseudo, type LanguageChoice } from "@/i18n/config";
import { readChoice } from "@/i18n/language";
import { rememberTheme, setDisplay, setLanguage, useApp } from "@/state/app";
import { LinkList } from "@/ui/shells/LinkList";
import { SectionShell } from "@/ui/shells/SectionShell";
import { APP_VERSION } from "@/queries/settings";
import { checkForAppUpdate, checkForUpstreamUpdate, installUpdate, setUpdateCheck, useUpdate } from "@/state/update";
import { cn } from "@/ui/cn";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SelectRow, SmallButton, SwitchRow, type SelectOption } from "./controls";

// The labels resolve when a row draws (never at import), so a language switch reaches them.
const themes = (): SelectOption<Theme>[] => [
  { value: "system", label: i18n.t("settings:app.themeSystem"), icon: Monitor },
  { value: "light", label: i18n.t("settings:app.themeLight"), icon: Sun },
  { value: "dark", label: i18n.t("settings:app.themeDark"), icon: Moon },
];

const units = (): SelectOption<UnitSystem>[] => [
  { value: "metric", label: i18n.t("settings:app.unitsMetric"), detail: i18n.t("settings:app.unitsMetricDetail") },
  { value: "imperial", label: i18n.t("settings:app.unitsImperial"), detail: i18n.t("settings:app.unitsImperialDetail") },
];

const hours = (): SelectOption<"24" | "12">[] => [
  { value: "24", label: i18n.t("settings:app.hours24"), detail: i18n.t("settings:app.hours24Detail") },
  { value: "12", label: i18n.t("settings:app.hours12"), detail: i18n.t("settings:app.hours12Detail") },
];

const languageOptions = (): SelectOption<LanguageChoice>[] => [
  { value: "auto", label: i18n.t("settings:app.languagePhone") },
  ...LANGUAGES.map((l) => ({ value: l.code, label: REVIEWED.has(l.code) ? l.name : i18n.t("settings:app.languageBeta", { name: l.name }) })),
  // Development builds only: English wrapped and padded, to find copy that is not in keys and layouts that overflow.
  ...(showPseudo ? [{ value: PSEUDO, label: "Pseudo (dev)" } as const] : []),
];

/** The language (kept on the device): the phone's, or one of Pulse's. Every screen redraws in it at once. */
function LanguageRow() {
  const { t } = useTranslation("settings");
  const [choice, setChoice] = useState<LanguageChoice>("auto");
  useEffect(() => void readChoice().then(setChoice), []);
  return (
    <SelectRow
      rule
      label={t("app.language")}
      value={choice}
      options={languageOptions()}
      onChange={(v) => {
        setChoice(v);
        void setLanguage(v);
      }}
    />
  );
}

/**
 * The theme (kept on the device), the units and the clock (kept in the profile; every screen redraws in them at once,
 * src/lib/units.ts), each a row whose choices open in a dropdown.
 */
function DisplayRows({ initialTheme }: { initialTheme: Theme }) {
  const { t } = useTranslation("settings");
  const [theme, setTheme] = useState(initialTheme);
  const display = useApp((a) => a.profile?.display) ?? displayPrefs();
  return (
    <View>
      <SelectRow
        label={t("app.theme")}
        value={theme}
        options={themes()}
        onChange={(v) => {
          setTheme(v);
          colorScheme.set(v);
          rememberTheme(v);
          void saveTheme(v);
        }}
      />
      <SelectRow rule label={t("app.units")} value={display.units} options={units()} onChange={(u) => void setDisplay({ ...display, units: u })} />
      <SelectRow rule label={t("app.clock")} value={String(display.hours) as "24" | "12"} options={hours()} onChange={(h) => void setDisplay({ ...display, hours: h === "12" ? 12 : 24 })} />
      <LanguageRow />
    </View>
  );
}

/**
 * Updates: checks for newer Health builds on GitHub and upstream open-source code updates (src/state/update.ts).
 */
function Updates() {
  const { t } = useTranslation("settings");
  const { enabled, available, upstreamUpdate } = useUpdate();
  const [checkingApp, setCheckingApp] = useState(false);
  const [checkingUpstream, setCheckingUpstream] = useState(false);

  const checkAppNow = async () => {
    setCheckingApp(true);
    const update = await checkForAppUpdate(true);
    setCheckingApp(false);
    if (!update) toast.success(t("app.latest", { version: APP_VERSION }));
  };

  const checkUpstreamNow = async () => {
    setCheckingUpstream(true);
    const update = await checkForUpstreamUpdate(true);
    setCheckingUpstream(false);
    if (!update) toast.success(t("app.upstreamLatest"));
  };

  return (
    <SectionShell variant="card" title={t("app.updates")}>
      <SwitchRow rule={false} label={t("app.checkForUpdates")} hint={t("app.checkForUpdatesHint")} value={enabled} onChange={(on) => void setUpdateCheck(on)} />

      {/* App Release Update */}
      <View className={cn(ROW, ROW_RULE)}>
        <View className="flex-1 pr-3">
          <Text className={ROW_LABEL}>{t("app.appUpdate")}</Text>
          <Text className="text-xs text-foreground-secondary">{t("app.version", { version: APP_VERSION })}</Text>
        </View>
        {available ? (
          <View className="flex-row items-center gap-2">
            <Text className={ROW_VALUE}>{t("app.isOut", { version: available.version })}</Text>
            <SmallButton label={t("app.install")} onPress={() => void installUpdate()} />
          </View>
        ) : (
          <SmallButton label={checkingApp ? t("app.checking") : t("app.checkNow")} onPress={() => void checkAppNow()} />
        )}
      </View>

      {/* Upstream Open Source Code Update */}
      <View className={cn(ROW, ROW_RULE)}>
        <View className="flex-1 pr-3">
          <Text className={ROW_LABEL}>{t("app.upstream")}</Text>
          <Text className="text-xs text-foreground-secondary">
            {upstreamUpdate ? t("app.upstreamUpdateFound", { sha: upstreamUpdate.shortSha }) : t("app.upstreamHint")}
          </Text>
        </View>
        {upstreamUpdate ? (
          <SmallButton label={t("app.viewOnGitHub")} onPress={() => void Linking.openURL(upstreamUpdate.url).catch(() => {})} />
        ) : (
          <SmallButton label={checkingUpstream ? t("app.upstreamChecking") : t("app.upstreamCheckNow")} onPress={() => void checkUpstreamNow()} />
        )}
      </View>
    </SectionShell>
  );
}

export function AppSettings() {
  const { t } = useTranslation("settings");
  const theme = useApp((a) => a.theme);
  return (
    <>
      <SectionShell variant="card" title={t("app.display")}>
        <DisplayRows initialTheme={theme} />
      </SectionShell>
      <Updates />
      <LinkList title={t("app.group")} rows={[{ icon: Bell, label: t("app.notificationsLink"), href: "/settings?s=notifications" }]} />
    </>
  );
}
