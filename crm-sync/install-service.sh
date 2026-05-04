#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.crm-sync"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

echo "==> CRM Sync — macOS service installer"

# 1. Find node
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found in PATH. Install Node.js first."
  exit 1
fi
echo "    node: $NODE_BIN ($(node --version))"

# 2. Build TypeScript
echo "==> Building TypeScript..."
cd "$SCRIPT_DIR"
npm run build
echo "    Build complete."

# 3. Create logs directory
mkdir -p "$LOG_DIR"

# 4. Write plist
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${SCRIPT_DIR}/dist/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>

    <!-- Start on login and keep alive if it crashes -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <!-- Logs -->
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/crm-sync.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/crm-sync-error.log</string>
</dict>
</plist>
PLIST

echo "    Plist written to: $PLIST_PATH"

# 5. Unload any old version, then load
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "✓ Service installed and running."
echo ""
echo "  Logs:    tail -f $LOG_DIR/crm-sync.log"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Remove:  bash $SCRIPT_DIR/uninstall-service.sh"
