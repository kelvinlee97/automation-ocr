#!/usr/bin/env bash
# check.sh - One-click self-check before submission: run test + lint
# Usage: bash scripts/check.sh
#
# Pass both → feel free to submit; fail either → revise first, don’t submit.

set -e

# Switch to the wa-bot/ sub-project directory and execute test and lint consecutively (exit immediately if any of them fails)
cd "$(dirname "$0")/../wa-bot" && npm test && npm run lint
