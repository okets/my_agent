#!/usr/bin/env bash
# Claude Code hook: checks if a file being written contains private patterns.
# Runs on PostToolUse for Write/Edit tools.
# Reads the file path from the tool input and scans against .guardrails.

FILE_PATH="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARDRAILS="$REPO_ROOT/.guardrails"

# Only check files in the public repo, not .my_agent/
case "$FILE_PATH" in
  */.my_agent/*) exit 0 ;;
  */.guardrails) exit 0 ;;
  */pre-commit-check.sh) exit 0 ;;
  */check-private-data.sh) exit 0 ;;
esac

if [ ! -f "$GUARDRAILS" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" == \#* ]] && continue

  if grep -qE "$pattern" "$FILE_PATH" 2>/dev/null; then
    echo "WARNING: Private pattern '$pattern' found in $FILE_PATH"
    echo "This file is in the PUBLIC repo. Move private data to .my_agent/"
    exit 1
  fi
done < "$GUARDRAILS"

exit 0
