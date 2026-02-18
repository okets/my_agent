#!/bin/bash
# Start Radicale CalDAV server in foreground

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/radicale-venv"
CONFIG_FILE="$SCRIPT_DIR/radicale.conf"

# Check if venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "ERROR: Virtual environment not found at $VENV_DIR"
    echo "Please run ./setup-radicale.sh first"
    exit 1
fi

# Check if config exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Configuration file not found at $CONFIG_FILE"
    echo "Please run ./setup-radicale.sh first"
    exit 1
fi

echo "Starting Radicale CalDAV server..."
echo "URL: http://127.0.0.1:5232"
echo "User: agent / Password: agent123"
echo "Press Ctrl+C to stop"
echo ""

# Activate venv and run Radicale
source "$VENV_DIR/bin/activate"
python3 -m radicale --config "$CONFIG_FILE"
