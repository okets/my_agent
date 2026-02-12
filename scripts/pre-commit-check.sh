#!/usr/bin/env bash
# Pre-commit hook: scans staged files for private patterns.
# Patterns defined in .guardrails (one per line, # comments ignored).

GUARDRAILS="$(git rev-parse --show-toplevel)/.guardrails"

if [ ! -f "$GUARDRAILS" ]; then
  echo "Warning: .guardrails file not found. Skipping private data check."
  exit 0
fi

FAILED=0

# Read patterns, skip comments and empty lines
while IFS= read -r pattern; do
  [[ -z "$pattern" || "$pattern" == \#* ]] && continue

  # Check staged file contents (not .my_agent/, not .guardrails itself)
  matches=$(git diff --cached --name-only -z | \
    xargs -0 grep -l -E "$pattern" 2>/dev/null | \
    grep -v "^\.my_agent/" | \
    grep -v "^\.guardrails$" | \
    grep -v "^scripts/pre-commit-check.sh$")

  if [ -n "$matches" ]; then
    echo "BLOCKED: Private pattern found in public files:"
    echo "  Pattern: $pattern"
    echo "  Files:"
    echo "$matches" | sed 's/^/    /'
    echo ""
    FAILED=1
  fi
done < "$GUARDRAILS"

if [ "$FAILED" -eq 1 ]; then
  echo "Commit rejected. Remove private data from public files."
  echo "Private data belongs in .my_agent/ (which is gitignored)."
  echo ""
  echo "To bypass (emergency only): git commit --no-verify"
  exit 1
fi

exit 0
