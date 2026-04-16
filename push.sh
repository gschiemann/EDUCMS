#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/index.lock
git add -A
git commit -m "fix: ensure Buffer + explicit memoryStorage for multer"
git push origin master
