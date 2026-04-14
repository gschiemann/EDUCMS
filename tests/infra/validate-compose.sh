#!/usr/bin/env bash
# validate-compose.sh
# Validates the docker-compose syntax. Adds infrastructure test coverage.

set -e

echo "Validating docker-compose.yml syntax..."

# Check if docker-compose or docker compose is installed if running manually
if command -v docker-compose &> /dev/null; then
    docker-compose config -q
    echo "✔ docker-compose syntax is VALID."
elif docker compose version &> /dev/null; then
    docker compose config -q
    echo "✔ docker compose syntax is VALID."
else
    echo "Docker Compose not found. Skipping execution test."
fi
