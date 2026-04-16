#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/index.lock
git add -A
git commit -m "fix: add upload logging + safer toString"
git push origin master
