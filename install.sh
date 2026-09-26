#!/usr/bin/env bash
# Installs the Cinnamon applet (symlink, so `git pull` updates it).
set -euo pipefail
UUID="claude-usage-alert@lisandius"
SRC="$(cd "$(dirname "$0")" && pwd)/applet/$UUID"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"
mkdir -p "$(dirname "$DEST")"
ln -sfn "$SRC" "$DEST"
echo "Installed to $DEST"
echo "Now right-click the panel -> Applets -> \"Claude Usage Alert\" -> add it."
echo "(If it is not listed, restart Cinnamon: Ctrl+Alt+Esc, or Alt+F2 -> r.)"
