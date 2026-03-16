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

if [ ! -d "$SOURCE_DIR" ] || [ -z "$(ls -A "$SOURCE_DIR" 2>/dev/null)" ]; then
  echo "No developer skills found in $SOURCE_DIR"
  echo "Skills may have already been moved to $TARGET_DIR"
  ls "$TARGET_DIR" 2>/dev/null && echo "" && echo "User-level skills are already installed."
  exit 0
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
