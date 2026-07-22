#!/bin/bash
# Installs the plans viewer as a launchd agent. Resolves node at install time
# (nvm paths change between machines/upgrades), writes the plist, and loads it.
# Re-run after upgrading node to repoint the agent.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.jacewardell.plansviewer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

NODE="$(command -v node || true)"
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE="$(ls -d "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
[ -x "$NODE" ] || { echo "node not found; install node (or nvm) first"; exit 1; }
echo "Using node: $NODE"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/plansviewer.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/plansviewer.err</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Loaded $LABEL (log: /tmp/plansviewer.log)"
