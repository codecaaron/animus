#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo 'ERROR: dry-run-worker expects: package-dir workspace output-dir worker-name build-task' >&2
  exit 2
fi

package_dir="$1"
workspace="$2"
output_dir="$3"
worker_name="$4"
build_task="$5"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/verify/_preconditions.sh"

require_dir "$output_dir" "vp run $build_task"

config="$package_dir/wrangler.jsonc"
actual_worker_name=$(bun run scripts/verify/read-worker-name.ts "$config")
if [ "$actual_worker_name" != "$worker_name" ]; then
  echo "ERROR: $config identifies Worker $actual_worker_name, expected $worker_name" >&2
  exit 1
fi

echo "[workers:dry-run] validating $worker_name from $config"
exec bun run --filter "$workspace" cf:dry-run
