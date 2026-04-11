#!/usr/bin/env bash
set -euo pipefail

# Usage: reset-capability.sh <capability-folder-name>
# Deletes the capability from .my_agent/capabilities/ for rebuild testing.
# Note: if the dashboard is running with this capability active, restart it after reset.

if [ $# -lt 1 ]; then
  echo "Usage: $0 <capability-name>"
  echo "Example: $0 desktop-x11"
  exit 1
fi

CAP_NAME="$1"
CAP_DIR=".my_agent/capabilities/${CAP_NAME}"

if [ ! -d "$CAP_DIR" ]; then
  echo "Capability folder not found: $CAP_DIR"
  exit 1
fi

echo "Removing capability: $CAP_DIR"
rm -rf "$CAP_DIR"
echo "Done. Capability '$CAP_NAME' removed."
echo "To rebuild, ask the agent: 'I want desktop control'"
echo "Note: restart the dashboard if it was running with this capability."
