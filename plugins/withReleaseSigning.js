const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let contents = c.modResults.contents;

    const releaseSigningBlock = `
        release {
            def storePath = System.getenv("RELEASE_STORE_FILE") ?: "../../credentials/release.keystore"
            def storeP = System.getenv("RELEASE_STORE_PASSWORD") ?: "healthapp123"
            def kAlias = System.getenv("RELEASE_KEY_ALIAS") ?: "health"
            def kPass = System.getenv("RELEASE_KEY_PASSWORD") ?: "healthapp123"
            if (file(storePath).exists()) {
                storeFile file(storePath)
                storePassword storeP
                keyAlias kAlias
                keyPassword kPass
                v1SigningEnabled true
                v2SigningEnabled true
            }
        }`;

    const debugBlockMatch = /signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\}\s*\}/;
    if (debugBlockMatch.test(contents) && !contents.includes('def kAlias = System.getenv("RELEASE_KEY_ALIAS")')) {
      contents = contents.replace(debugBlockMatch, (m) => {
        return m.slice(0, -1) + releaseSigningBlock + "\n    }";
      });
    }

    contents = contents.replace(
      /\n(\s*)signingConfig\s+signingConfigs\.debug(\s*\n\s*def\s+enableShrinkResources)/,
      `\n$1if (file(System.getenv("RELEASE_STORE_FILE") ?: "../../credentials/release.keystore").exists()) {
$1    signingConfig signingConfigs.release
$1} else {
$1    signingConfig signingConfigs.debug
$1}$2`,
    );

    c.modResults.contents = contents;
    return c;
  });
};
