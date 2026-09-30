#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_dir="$repo_root/scripts/offline-sync"
image="public.ecr.aws/supabase/postgres:17.6.1.166"
container="karma-v126-local-smoke-$$"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  printf '%s\n' "Required cached PostgreSQL image is unavailable: $image" >&2
  exit 1
fi

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" != "0" ]]; then
    docker logs --tail 80 "$container" >&2 || true
  fi
  docker rm --force "$container" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker run --pull=never --detach --rm --network none --name "$container" \
  --env POSTGRES_PASSWORD=local-smoke-only "$image" >/dev/null

ready=0
for attempt in {1..60}; do
  initialized=0
  if docker logs "$container" 2>&1 | grep -q "PostgreSQL init process complete"; then
    initialized=1
  fi
  if [[ "$initialized" == "1" ]] && docker exec "$container" \
      pg_isready --username supabase_admin --dbname postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != "1" ]]; then
  printf '%s\n' "Disposable PostgreSQL container did not become ready." >&2
  exit 1
fi

psql_apply() {
  docker exec -i "$container" psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --username supabase_admin --dbname postgres
}

psql_apply < "$script_dir/pos-operations-server-v126-local-bootstrap.sql"
psql_apply < "$repo_root/supabase/migrations/20260929000100_evl114_command_batches.sql"
psql_apply < "$repo_root/supabase/migrations/20260929000200_evl118_access_control.sql"
psql_apply < "$repo_root/supabase/migrations/20260930000100_evl126_pos_operations_v1.sql"
psql_apply < "$script_dir/pos-operations-server-v126-local-smoke.sql"

printf '%s\n' "EVL-126 local PostgreSQL smoke proof passed; disposable container removed."
