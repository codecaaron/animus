#!/usr/bin/env bash
set -euo pipefail

# ─── Set every publishable package to a release version ───────────
#
# The release job runs this on the tag's version before packing, and
# verify:packed runs it on copies of the manifests to prove the rewrite
# leaves no internal edge behind. Each package's version becomes
# <version>, and every `workspace:*` specifier becomes <version> in every
# block an internal edge can live in. bun pm pack would otherwise resolve
# a remaining `workspace:*` from the lockfile's (stale) version.
#
# Usage:
#   bash scripts/set-release-version.sh <version> [<root>]
#
# <root> holds packages/<name>/package.json; default: the repository.

VERSION="${1:?usage: set-release-version.sh <version> [<root>]}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
PKGS=(properties system extract layergate vite-plugin next-plugin cli unplugin)

for pkg in "${PKGS[@]}"; do
  manifest="$ROOT/packages/$pkg/package.json"
  jq --arg v "$VERSION" '
    def pin: with_entries(if .value == "workspace:*" then .value = $v else . end);
    .version = $v |
    if .dependencies then .dependencies |= pin else . end |
    # devDependencies ship verbatim in npm-pack tarballs and the packed
    # guard rejects any retained workspace: specifier.
    if .devDependencies then .devDependencies |= pin else . end |
    # An optional peer (layergate in the host plugins) stays optional
    # through peerDependenciesMeta, which this leaves alone.
    if .peerDependencies then .peerDependencies |= pin else . end |
    if .optionalDependencies then .optionalDependencies |= with_entries(if (.value | test("^[0-9]")) then .value = $v else . end) else . end
  ' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
  echo "$pkg → $VERSION"
done
