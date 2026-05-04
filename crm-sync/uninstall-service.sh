#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.crm-sync"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "==> Removing CRM Sync service..."

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "    Service stopped." || echo "    Service was not running."
rm -f "$PLIST_PATH" && echo "    Plist removed."

echo "✓ Done. Logs in ./logs/ were kept — delete manually if no longer needed."
