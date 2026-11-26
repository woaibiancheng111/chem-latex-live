#!/usr/bin/env bash
set -Eeuo pipefail

base=/opt/chem-latex-live
exec 9>"$HOME/.chem-latex-live-release.lock"
flock -n 9 || { printf 'Another release is running.\n' >&2; exit 1; }
repo=$(git rev-parse --show-toplevel)
rev=$(git -C "$repo" rev-parse HEAD)
stamp=$(date -u +%Y%m%dT%H%M%S)-${rev:0:12}-$$
sudo install -d -m 755 "$base/releases"
stage=$(sudo mktemp -d "$base/releases/.stage.XXXXXXXX")
release="$base/releases/$stamp"
previous="$base/app.previous-$stamp"
trap 'if [[ -d "$stage" ]]; then sudo rm -rf -- "$stage"; fi' EXIT

sudo chmod 755 "$stage"
sudo install -d -m 755 "$stage/chem_latex_live" "$stage/tools"
git -C "$repo" archive "$rev" __init__.py catalog.py chemfig_gen.py compiler.py server.py static |
    sudo tar --no-same-owner -xf - -C "$stage/chem_latex_live"
sudo install -m 644 "$base/app/tools/molvec-0.9.8-jar-with-dependencies.jar" "$stage/tools/"
printf '%s\n' "$rev" | sudo tee "$stage/REVISION" >/dev/null
(cd "$stage" && PYTHONDONTWRITEBYTECODE=1 "$base/venv/bin/python" -c 'from chem_latex_live.server import app')
sudo mv -T -- "$stage" "$release"

sudo mv -T -- "$base/app" "$previous"
if sudo ln -s -- "$release" "$base/app" && sudo systemctl restart chem-latex-live; then
    for attempt in {1..20}; do
        if curl -fsS --max-time 2 http://127.0.0.1:8765/api/health | "$base/venv/bin/python" -c 'import json,sys; h=json.load(sys.stdin); sys.exit(not (h.get("ok") and h.get("molvec")))' 2>/dev/null; then
            printf 'Deployed %s; previous version: %s\n' "$rev" "$previous"
            exit 0
        fi
        sleep 1
    done
fi

if [[ -L "$base/app" && $(readlink "$base/app") == "$release" ]]; then
    sudo unlink "$base/app"
fi
sudo mv -T -- "$previous" "$base/app"
sudo systemctl restart chem-latex-live
printf 'Release failed; previous version restored.\n' >&2
exit 1
