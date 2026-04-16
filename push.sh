#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/index.lock
git add -A
git commit -m "fix: Uint8Array upload + templates TS errors"
git push origin master
