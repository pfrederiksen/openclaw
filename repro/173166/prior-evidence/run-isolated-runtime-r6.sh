#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESULT="${1:-runtime-r6.json}"
case "$RESULT" in
  *[!a-zA-Z0-9_.-]*|'') printf '%s\n' 'Use a simple unique JSON basename.' >&2; exit 2 ;;
esac
if [[ -e "$ROOT/runtime/$RESULT" ]]; then printf '%s\n' 'Choose another basename.' >&2; exit 2; fi
mkdir -p "$ROOT/runtime"
bwrap --unshare-net --unshare-pid --die-with-parent --clearenv \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$ROOT" "$ROOT" --bind "$ROOT/runtime" /home/fixture \
  --setenv HOME /home/fixture --setenv PATH /usr/bin:/bin \
  --setenv FIXTURE_RESULT "/home/fixture/$RESULT" \
  --chdir "$ROOT" /usr/bin/node supervisor-runtime-r6.mjs
