#!/usr/bin/env bash
# Package Nekomata.
#
#   ./build.sh          # the VS Code extension: nekomata.vsix
#   ./build.sh glade    # the Glade plugin folder: dist/glade/nekomata/
#
# The server (fleet_dashboard.py) is the source of truth at the repo root; the
# vsix build copies it into the extension so the .vsix is self-contained.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "glade" ]; then
  node glade/build.mjs
  echo ""
  echo "Install it by copying the folder into Glade's plugins folder:"
  echo "  cp -R dist/glade/nekomata ~/Library/Application\\ Support/glade/plugins/"
  exit 0
fi

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
