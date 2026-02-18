#!/bin/bash
# Setup script for Radicale CalDAV server
# Creates venv, installs dependencies, configures server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/radicale-venv"
DATA_DIR="$SCRIPT_DIR/radicale-data"
CONFIG_FILE="$SCRIPT_DIR/radicale.conf"
HTPASSWD_FILE="$SCRIPT_DIR/htpasswd"

echo "=== Radicale CalDAV Server Setup ==="

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not found"
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "Found: $PYTHON_VERSION"

# Create virtual environment
echo "Creating virtual environment at $VENV_DIR..."
python3 -m venv "$VENV_DIR"

# Activate venv and install packages
echo "Installing radicale and passlib[bcrypt]..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install radicale passlib[bcrypt]

# Create htpasswd file with user 'agent'
echo "Creating htpasswd file..."
python3 -c "
from passlib.hash import bcrypt
password_hash = bcrypt.using(rounds=12).hash('agent123')
print(f'agent:{password_hash}')
" > "$HTPASSWD_FILE"
echo "Created user 'agent' with password 'agent123'"

# Create data directory
echo "Creating data directory at $DATA_DIR..."
mkdir -p "$DATA_DIR"

# Create Radicale config
echo "Creating Radicale configuration..."
cat > "$CONFIG_FILE" << 'EOF'
[server]
hosts = 127.0.0.1:5232

[auth]
type = htpasswd
htpasswd_filename = %(here)s/htpasswd
htpasswd_encryption = bcrypt

[storage]
filesystem_folder = %(here)s/radicale-data

[logging]
level = info
EOF

echo ""
echo "=== Setup Complete ==="
echo "Configuration: $CONFIG_FILE"
echo "Data directory: $DATA_DIR"
echo "Users file: $HTPASSWD_FILE"
echo ""
echo "To start the server, run: ./start-radicale.sh"
echo "Server will be available at: http://127.0.0.1:5232"
