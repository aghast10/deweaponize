#!/usr/bin/env bash
# Installs pharmakon-proxy as a systemd user service so the local proxy
# starts automatically on login.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(which node 2>/dev/null || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Error: node not found in PATH. Install Node.js first." >&2
  exit 1
fi

SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"

cat > "$SERVICE_DIR/pharmakon-proxy.service" <<EOF
[Unit]
Description=Pharmakon local proxy (bridges extension → claude CLI)
After=network.target

[Service]
ExecStart=$NODE_BIN $SCRIPT_DIR/proxy.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable pharmakon-proxy
systemctl --user start pharmakon-proxy

echo "pharmakon-proxy installed and running."
echo "  status:  systemctl --user status pharmakon-proxy"
echo "  logs:    journalctl --user -u pharmakon-proxy -f"
echo "  stop:    systemctl --user stop pharmakon-proxy"
echo "  disable: systemctl --user disable pharmakon-proxy"
