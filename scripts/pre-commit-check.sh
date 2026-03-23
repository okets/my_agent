#!/usr/bin/env bash
# Pre-commit hook: scans staged files for private patterns.
#
# Two layers of protection:
#   1. Static patterns from .guardrails (regex, grep -E)
#   2. Dynamic secrets from packages/dashboard/.env (fixed string, grep -F)
#
# Install: git config core.hooksPath scripts/
#   — or — ln -sf ../../scripts/pre-commit-check.sh .git/hooks/pre-commit

REPO_ROOT="$(git rev-parse --show-toplevel)"
GUARDRAILS="$REPO_ROOT/.guardrails"
ENV_FILE="$REPO_ROOT/packages/dashboard/.env"

# Config keys to skip when scanning .env (not secrets)
SKIP_KEYS="PORT|HOST|NODE_ENV"

FAILED=0

# Get staged diff content (excluding deleted files)
STAGED_DIFF=$(git diff --cached --diff-filter=d -U0 2>/dev/null)

if [ -z "$STAGED_DIFF" ]; then
  exit 0
fi

# ── Layer 1: Static .guardrails patterns (regex) ──────────────────────

if [ -f "$GUARDRAILS" ]; then
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue

    # Only scan added lines (starting with +, excluding +++ file headers and @@ hunks)
    if echo "$STAGED_DIFF" | grep -E '^\+[^+]' | grep -qE "$pattern" 2>/dev/null; then
      # Find which files contain the match
      matched_files=$(git diff --cached --diff-filter=d -U0 --name-only | \
        while read -r fname; do
          # Skip files that are allowed to contain patterns
          case "$fname" in
            .my_agent/*|.guardrails|scripts/pre-commit-check.sh|scripts/check-private-data.sh) continue ;;
          esac
          git diff --cached -U0 -- "$fname" | grep -E '^\+[^+]' | grep -qE "$pattern" 2>/dev/null && echo "    $fname"
        done)

      if [ -n "$matched_files" ]; then
        echo "BLOCKED: Guardrail pattern matched in staged content:"
        echo "  Pattern: $pattern"
        echo "  Files:"
        echo "$matched_files"
        echo ""
        FAILED=1
      fi
    fi
  done < "$GUARDRAILS"
fi

# ── Layer 2: .env secret values (fixed string) ────────────────────────

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    # Skip comments and blank lines
    [[ -z "$line" || "$line" == \#* ]] && continue

    # Extract key and value
    key="${line%%=*}"
    value="${line#*=}"

    # Skip config keys (not secrets)
    if echo "$key" | grep -qE "^($SKIP_KEYS)$"; then
      continue
    fi

    # Strip surrounding quotes from value
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"

    # Skip empty values and short values (< 8 chars) to avoid false positives
    if [ -z "$value" ] || [ "${#value}" -lt 8 ]; then
      continue
    fi

    # Check staged diff for this secret value (fixed string match)
    if echo "$STAGED_DIFF" | grep -qF "$value" 2>/dev/null; then
      # Find which files contain the match (skip .env itself and private dirs)
      matched_files=$(git diff --cached --diff-filter=d -U0 --name-only | \
        while read -r fname; do
          case "$fname" in
            .my_agent/*|packages/dashboard/.env) continue ;;
          esac
          git diff --cached -U0 -- "$fname" | grep -qF "$value" 2>/dev/null && echo "    $fname"
        done)

      if [ -n "$matched_files" ]; then
        echo "BLOCKED: .env secret value leaked in staged content:"
        echo "  Key: $key"
        echo "  Files:"
        echo "$matched_files"
        echo ""
        FAILED=1
      fi
    fi
  done < "$ENV_FILE"
fi

# ── Result ─────────────────────────────────────────────────────────────

if [ "$FAILED" -eq 1 ]; then
  echo "Commit rejected. Remove private data from public files."
  echo "Private data belongs in .my_agent/ (which is gitignored)."
  echo ""
  echo "To bypass (emergency only): git commit --no-verify"
  exit 1
fi

exit 0
