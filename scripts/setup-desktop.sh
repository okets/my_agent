#!/bin/bash
# Desktop Control Setup — installs xdotool, maim, wmctrl for X11 desktop automation

set -e

TOOLS="xdotool maim wmctrl"
MISSING=""

for tool in $TOOLS; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING="$MISSING $tool"
  else
    echo "✓ $tool already installed"
  fi
done

if [ -z "$MISSING" ]; then
  echo "All desktop tools already installed."
  exit 0
fi

echo "Installing:$MISSING"

if command -v apt &>/dev/null; then
  sudo apt install -y $MISSING
elif command -v dnf &>/dev/null; then
  sudo dnf install -y $MISSING
elif command -v pacman &>/dev/null; then
  sudo pacman -S --noconfirm $MISSING
else
  echo "ERROR: No supported package manager found (apt, dnf, pacman)"
  exit 1
fi

echo "Desktop tools installed successfully."
