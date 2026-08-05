#!/usr/bin/env bash
# test.sh - test related commands
# usage:
#   bash scripts/test.sh #Run all tests (80 test cases, about 1 second)
#   bash scripts/test.sh watch # Monitor file changes and automatically rerun
#   bash scripts/test.sh coverage # Generate coverage report (output to coverage/)
#   bash scripts/test.sh file <path> # Only run a certain test file
#   bash scripts/test.sh name <keyword> # Filter use cases by name
#   bash scripts/test.sh verbose # Verbose output
#
# NOTE: All tests are done using mocks, no real network/database/WhatsApp account is required.

set -e

# Switch to the wa-bot/ sub-project directory (the root directory cannot be run)
cd "$(dirname "$0")/../wa-bot"

case "${1:-}" in
  "")
    # Default: run all tests
    npm test
    ;;
  watch)
    # Monitor file changes and automatically rerun (always open a terminal during development)
    npm run test:watch
    ;;
  coverage)
    # Generate test coverage report (report located in wa-bot/coverage/)
    npm run test:coverage
    ;;
  file)
    # Only run test files in the specified path, used when debugging a single test
    npx jest "$2"
    ;;
  name)
    # Filter by use case name keywords
    npx jest -t "$2"
    ;;
  verbose)
    # Output more detailed test information
    npx jest --verbose
    ;;
  *)
    echo "Unknown subcommand: $1"
    echo "Available: (null) | watch | coverage | file <path> | name <keyword> | verbose"
    exit 1
    ;;
esac
