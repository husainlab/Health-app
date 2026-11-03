#!/usr/bin/env bash
# Publishes a version's APKs as a GitHub release (docs/releases.md).
# usage: scripts/github-release.sh <version> <apk>...
# Creates the release v<version>, titled "Pulse Mobile <version>", on HEAD (or reuses it if it exists) and uploads each
# APK as an asset, named as the file is (pulse-mobile-<version>-<abi>.apk). <version> must be app.json's expo.version.
# The token is $GH_TOKEN (~/.zshrc sets it to adityaongit's under ~/personal/; $GITHUB_TOKEN there is the work
# account's, so it is not used), else the github.com password git's credential helper holds.
set -euo pipefail
REPO=husainlab/Health-app
version=${1:?usage: scripts/github-release.sh <version> <apk>...}
shift
[ $# -gt 0 ] || { echo "no APKs given" >&2; exit 1; }
app=$(jq -r .expo.version "$(dirname "$0")/../app.json")
[ "$version" = "$app" ] || { echo "version $version is not app.json's $app: bump expo.version first" >&2; exit 1; }
tag=v$version
TOKEN=${GH_TOKEN:-$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')}
[ -n "$TOKEN" ] || { echo "No token: set GH_TOKEN." >&2; exit 1; }
api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

notes="Download **health-$version.apk**. Installing over an earlier release keeps your data."

id=$(api "https://api.github.com/repos/$REPO/releases/tags/$tag" 2>/dev/null | jq -r .id || true)
if [ -z "$id" ] || [ "$id" = null ]; then
  body=$(jq -n --arg t "$tag" --arg c "$(git rev-parse HEAD)" --arg n "Health $version" --arg b "$notes" \
    '{tag_name: $t, target_commitish: $c, name: $n, body: $b, generate_release_notes: true, make_latest: "true"}')
  id=$(api -X POST "https://api.github.com/repos/$REPO/releases" -d "$body" | jq -r .id) || {
    echo "Could not create the release. The token needs write access to $REPO: a classic token with the repo scope, or a fine-grained one with Contents read and write. Pass it as GH_TOKEN." >&2
    exit 1
  }
fi
for apk in "$@"; do
  api -X POST -H "Content-Type: application/vnd.android.package-archive" --data-binary @"$apk" \
    "https://uploads.github.com/repos/$REPO/releases/$id/assets?name=$(basename "$apk")" | jq -r .browser_download_url
done
