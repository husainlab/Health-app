// The launcher's long-press shortcuts: Check in, Recovery and Sleep, the PWA's manifest shortcuts (pulse
// src/app/manifest.ts). Android static shortcuts: a meta-data on the launcher activity points at res/xml/shortcuts.xml,
// and each shortcut opens a pulse:// deep link that expo-router resolves to its route (docs/learning.md, "App shortcuts").
// The XML, its labels and the glyphs are written on every prebuild, so they survive `expo prebuild --clean`.
const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// The PWA's shortcut glyphs (pulse scripts/shortcuts/*.svg, lucide icons) in its deep brand tones: Android draws them
// on the launcher's own grey disc, where the bright brand colours all but vanish (pulse scripts/gen-pwa-assets.py).
const SHORTCUTS = [
  {
    id: "checkin",
    short: "Check in",
    long: "Check in",
    color: "#101518",
    paths: [
      "M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4",
      "M2 6h4",
      "M2 10h4",
      "M2 14h4",
      "M2 18h4",
      "M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",
    ],
  },
  {
    id: "recovery",
    short: "Recovery",
    long: "Today’s recovery",
    color: "#00643E",
    paths: [
      "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
      "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
    ],
  },
  {
    id: "sleep",
    short: "Sleep",
    long: "Last night’s sleep",
    color: "#0D47A1",
    paths: ["M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "\\'");

// The 24-unit glyph at three quarters of a 32-unit canvas, as the PWA renders its PNGs.
const drawable = (s) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="32" android:viewportHeight="32">
  <group android:translateX="4" android:translateY="4">
${s.paths.map((d) => `    <path android:pathData="${d}" android:strokeColor="${s.color}" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000"/>`).join("\n")}
  </group>
</vector>
`;

const shortcutsXml = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${SHORTCUTS.map(
  (s) => `  <shortcut android:shortcutId="${s.id}" android:enabled="true" android:icon="@drawable/shortcut_${s.id}" android:shortcutShortLabel="@string/shortcut_${s.id}_short" android:shortcutLongLabel="@string/shortcut_${s.id}_long">
    <intent android:action="android.intent.action.VIEW" android:data="health://${s.id}" android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity"/>
  </shortcut>`,
).join("\n")}
</shortcuts>
`;

// Labels must be string resources. A file of their own, so expo's strings.xml mods never meet them.
const stringsXml = () => `<?xml version="1.0" encoding="utf-8"?>
<resources>
${SHORTCUTS.map((s) => `  <string name="shortcut_${s.id}_short">${esc(s.short)}</string>\n  <string name="shortcut_${s.id}_long">${esc(s.long)}</string>`).join("\n")}
</resources>
`;

const withShortcutsMetaData = (config) =>
  withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    const meta = (activity["meta-data"] ??= []);
    if (!meta.some((m) => m.$["android:name"] === "android.app.shortcuts")) {
      meta.push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" } });
    }
    return c;
  });

const withShortcutFiles = (config) =>
  withDangerousMod(config, [
    "android",
    (c) => {
      const pkg = c.android?.package;
      if (!pkg) throw new Error("[withAppShortcuts] android.package is not set");
      const res = path.join(c.modRequest.platformProjectRoot, "app/src/main/res");
      const write = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(res, rel)), { recursive: true });
        fs.writeFileSync(path.join(res, rel), text);
      };
      write("xml/shortcuts.xml", shortcutsXml(pkg));
      write("values/strings_shortcuts.xml", stringsXml());
      for (const s of SHORTCUTS) write(`drawable/shortcut_${s.id}.xml`, drawable(s));
      return c;
    },
  ]);

module.exports = (config) => withShortcutFiles(withShortcutsMetaData(config));
