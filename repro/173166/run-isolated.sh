#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESULT="${1:-generation-matrix.json}"
case "$RESULT" in *[!a-zA-Z0-9_.-]*|'') exit 2 ;; esac
test ! -e "$ROOT/runtime/$RESULT"
mkdir -p "$ROOT/runtime"
bwrap --unshare-net --unshare-pid --die-with-parent --clearenv \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$ROOT" "$ROOT" \
  --ro-bind "$(readlink -f "$ROOT/node_modules")" "$(readlink -f "$ROOT/node_modules")" \
  --bind "$ROOT/runtime" /home/fixture \
  --setenv HOME /home/fixture --setenv PATH /usr/bin:/bin \
  --setenv FIXTURE_RESULT "/home/fixture/$RESULT" \
  --chdir "$ROOT" /usr/bin/node supervisor.mjs "${2:-}" "${3:-}"
