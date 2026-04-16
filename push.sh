#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/index.lock
git add -A
git commit -m "fix: bypass Supabase JS client, use REST API for uploads"
git push origin master
