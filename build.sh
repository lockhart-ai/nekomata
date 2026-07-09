#!/usr/bin/env bash
# Package the Nekomata VS Code extension into an installable .vsix.
# The server (fleet_dashboard.py) is the source of truth at the repo root; this
# copies it into the extension so the .vsix is self-contained.
set -euo pipefail
cd "$(dirname "$0")"

cp fleet_dashboard.py extension/fleet_dashboard.py
rm -rf extension/web && cp -r web extension/web
cp LICENSE extension/LICENSE

cd extension
# @vscode/vsce is fetched on demand; no install step or dependencies needed.
npx --yes @vscode/vsce package --out ../nekomata.vsix

cd ..
echo ""
echo "Built nekomata.vsix — install with:"
echo "  code --install-extension nekomata.vsix        # VS Code"
echo "  cursor --install-extension nekomata.vsix      # Cursor"
echo "  windsurf --install-extension nekomata.vsix    # Windsurf"
