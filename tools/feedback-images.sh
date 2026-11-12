#!/usr/bin/env bash
# Usage: tools/feedback-images.sh <out-dir> <reportId|pictureId>...
# Run from the Ember compose directory; extracts {reportId}/{pictureId}.{ext} into <out-dir>.
set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <out-dir> <reportId|pictureId>..." >&2
  exit 1
fi
out="$1"
mkdir -p "$out"
docker compose exec -T api dotnet Ember.Api.dll --feedback-images "${@:2}" | tar -x -C "$out"
