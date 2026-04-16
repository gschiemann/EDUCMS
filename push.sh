#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/index.lock
git add -A
git commit -m "fix: copy Buffer to clean ArrayBuffer for Blob+fetch upload"
git push origin master
