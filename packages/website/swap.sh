#!/bin/bash
FILE="src/pages/index.astro"
V1="src/pages/index.claude-v1.astro"
V4="src/pages/index.claude-v4.astro"

# save current v4 as named copy if not already
[ ! -f "$V4" ] && cp "$FILE" "$V4"

CURRENT=$(md5 -q "$FILE")
CHECK_V1=$(md5 -q "$V1")

if [ "$CURRENT" = "$CHECK_V1" ]; then
  cp "$V4" "$FILE"
  echo "→ Showing v4 (CC blend)"
else
  cp "$V1" "$FILE"
  echo "→ Showing v1"
fi
