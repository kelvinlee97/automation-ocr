#!/usr/bin/env bash
# setup.sh - initialize the environment after pulling the code for the first time
# Usage: bash scripts/setup.sh

set -e

# Enter the sub-project directory (99% of development commands are run under wa-bot/)
cd "$(dirname "$0")/../wa-bot"

# Install dependencies (you only need to do this once, or run it again after changing package.json)
npm install

# Run the test again and confirm that the environment is OK (see "Tests: 80 passed" means the environment is normal)
npm test
