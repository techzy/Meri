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

    <!-- Fallback log for hard crashes that bypass our daily logger.
         Routine output goes to logs/MM-DD-YYYY.log via src/logger.ts -->
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/launchd-fallback.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/launchd-fallback.log</string>
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
echo "  Logs:    tail -f $LOG_DIR/\$(date +%m-%d-%Y).log"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Remove:  bash $SCRIPT_DIR/uninstall-service.sh"
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo " ONE-TIME SETUP (required for iMessage reading)"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo " To read messages from ~/Library/Messages/chat.db, the running Node"
echo " binary needs Full Disk Access. Without it, the sync still runs but"
echo " skips the iMessage source for every contact."
echo ""
echo "   1. Open: System Settings → Privacy & Security → Full Disk Access"
echo "   2. Click '+' and add this binary:"
echo "        $NODE_BIN"
echo "   3. Toggle it ON"
echo "   4. Restart the service:"
echo "        launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
echo ""
echo "════════════════════════════════════════════════════════════════════"
