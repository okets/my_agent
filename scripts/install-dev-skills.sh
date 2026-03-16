#!/usr/bin/env bash
#
# Install developer skills to user-level ~/.claude/skills/
# These skills are for Claude Code (the developer), not for Nina.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_DIR/.claude/skills"
TARGET_DIR="$HOME/.claude/skills"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source skills directory not found: $SOURCE_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR"

for skill_dir in "$SOURCE_DIR"/*/; do
  skill_name="$(basename "$skill_dir")"
  target="$TARGET_DIR/$skill_name"

  if [ -d "$target" ]; then
    echo "  Updating: $skill_name"
    rm -rf "$target"
  else
    echo "  Installing: $skill_name"
  fi

  cp -r "$skill_dir" "$target"
done

echo ""
echo "Developer skills installed to $TARGET_DIR"
echo "These are visible to Claude Code but NOT to Nina."
