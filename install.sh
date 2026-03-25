#!/usr/bin/env bash
# One-line installer for De-Weaponize
# Usage: curl -fsSL https://raw.githubusercontent.com/nicopi/deweaponize/main/install.sh | bash

set -e

INSTALL_DIR="${DWZ_DIR:-$HOME/deweaponize}"

# Check dependencies
for cmd in node git claude; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed." >&2
    [[ "$cmd" == "node" ]] && echo "  Install from https://nodejs.org/" >&2
    [[ "$cmd" == "claude" ]] && echo "  Install from https://docs.anthropic.com/en/docs/claude-code" >&2
    exit 1
  fi
done

# Clone or update
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning to $INSTALL_DIR..."
  git clone https://github.com/nicopi/deweaponize.git "$INSTALL_DIR"
fi

# Install proxy service
bash "$INSTALL_DIR/install-proxy-service.sh"

echo ""
echo "Done! Now load the extension in Firefox:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select $INSTALL_DIR/manifest.json"
