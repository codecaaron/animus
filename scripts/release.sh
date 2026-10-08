#!/usr/bin/env bash
set -euo pipefail

# ─── Tag-only release for all publishable packages ────────────────
#
# Tags HEAD with the next version and pushes main and the tag. CI's
# publish job sets every package version from the tag, so no
# package.json is edited here.
#
# Usage:
#   bun release <bump> [--channel <name>] [--dry-run]
#
# Bump types:
#   patch | minor | major        → stable release
#   prepatch | preminor | premajor → prerelease of next bump
#   prerelease                   → increment prerelease counter
#   graduate                     → strip prerelease suffix
#
# Examples:
#   bun release patch            → 0.1.0 → 0.1.1
#   bun release preminor         → 0.1.0 → 0.2.0-next.0
#   bun release prerelease       → 0.2.0-next.0 → 0.2.0-next.1
#   bun release graduate         → 0.2.0-next.3 → 0.2.0
#   bun release premajor --channel beta  → 0.1.0 → 1.0.0-beta.0

REMOTE="origin"
DEFAULT_CHANNEL="next"

# ─── Arg parsing ──────────────────────────────────────────────────
BUMP=""
CHANNEL="$DEFAULT_CHANNEL"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
    *) BUMP="$1"; shift ;;
  esac
done

if [[ -z "$BUMP" ]]; then
  echo "Usage: bun release <patch|minor|major|prepatch|preminor|premajor|prerelease|graduate> [--channel name] [--dry-run]"
  exit 1
fi

# ─── Guard: must be on main, clean working tree ───────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: releases must be cut from main (currently on '$BRANCH')"
  exit 1
fi

if ! git diff --quiet HEAD; then
  echo "Error: working tree is dirty — commit or stash changes first"
  exit 1
fi

# ─── Resolve current version from latest semver tag ───────────────
get_latest_tag() {
  git tag --list 'v*' --sort=-v:refname \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z]+\.[0-9]+)?$' \
    | head -1
}

LATEST_TAG=$(get_latest_tag)
if [[ -z "$LATEST_TAG" ]]; then
  echo "No valid semver tag found — starting from 0.0.0"
  CURRENT="0.0.0"
else
  CURRENT="${LATEST_TAG#v}"
fi

echo "Current version: $CURRENT"

# ─── Semver arithmetic ────────────────────────────────────────────
parse_semver() {
  local ver="$1"
  local core="${ver%%-*}"
  MAJOR="${core%%.*}"
  local rest="${core#*.}"
  MINOR="${rest%%.*}"
  PATCH="${rest#*.}"

  if [[ "$ver" == *-* ]]; then
    local pre="${ver#*-}"
    PRE_ID="${pre%%.*}"
    PRE_NUM="${pre#*.}"
  else
    PRE_ID=""
    PRE_NUM=""
  fi
}

parse_semver "$CURRENT"

case "$BUMP" in
  patch)
    if [[ -n "$PRE_ID" ]]; then
      # If already prerelease, patch just strips the pre (same as graduate)
      NEXT="$MAJOR.$MINOR.$PATCH"
    else
      NEXT="$MAJOR.$MINOR.$((PATCH + 1))"
    fi
    ;;
  minor)
    NEXT="$MAJOR.$((MINOR + 1)).0"
    ;;
  major)
    NEXT="$((MAJOR + 1)).0.0"
    ;;
  prepatch)
    if [[ -n "$PRE_ID" ]]; then
      NEXT="$MAJOR.$MINOR.$((PATCH + 1))-${CHANNEL}.0"
    else
      NEXT="$MAJOR.$MINOR.$((PATCH + 1))-${CHANNEL}.0"
    fi
    ;;
  preminor)
    NEXT="$MAJOR.$((MINOR + 1)).0-${CHANNEL}.0"
    ;;
  premajor)
    NEXT="$((MAJOR + 1)).0.0-${CHANNEL}.0"
    ;;
  prerelease)
    if [[ -n "$PRE_ID" ]]; then
      NEXT="$MAJOR.$MINOR.$PATCH-${PRE_ID}.$((PRE_NUM + 1))"
    else
      NEXT="$MAJOR.$MINOR.$((PATCH + 1))-${CHANNEL}.0"
    fi
    ;;
  graduate)
    if [[ -z "$PRE_ID" ]]; then
      echo "Error: current version ($CURRENT) is not a prerelease — nothing to graduate"
      exit 1
    fi
    NEXT="$MAJOR.$MINOR.$PATCH"
    ;;
  *)
    echo "Unknown bump type: $BUMP"
    echo "Valid: patch | minor | major | prepatch | preminor | premajor | prerelease | graduate"
    exit 1
    ;;
esac

echo "Next version:    $NEXT"
echo ""

TAG="v$NEXT"

if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag $TAG already exists locally"
  exit 1
fi

if ! REMOTE_TAGS=$(git ls-remote --tags "$REMOTE" "refs/tags/$TAG"); then
  echo "Error: could not list tags on $REMOTE"
  exit 1
fi
if [[ -n "$REMOTE_TAGS" ]]; then
  echo "Error: tag $TAG already exists on $REMOTE"
  exit 1
fi

if $DRY_RUN; then
  echo "[dry-run] Would tag $(git rev-parse --short HEAD) as $TAG and push main and $TAG to $REMOTE"
  exit 0
fi

# ─── Tag, push ────────────────────────────────────────────────────
git tag "$TAG"
if ! git push --atomic "$REMOTE" main "$TAG"; then
  git tag -d "$TAG" >/dev/null
  echo "Error: push failed — removed the local $TAG tag"
  exit 1
fi

echo ""
echo "Released $TAG — CI will set package versions and publish to npm"
