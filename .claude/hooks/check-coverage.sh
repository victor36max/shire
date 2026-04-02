#!/bin/bash
# PreToolUse hook: block git commit if test coverage < 90%.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Run tests with coverage, disable color output for reliable parsing
COVERAGE_OUTPUT=$(NO_COLOR=1 bun test --coverage 2>&1) || true

# Strip any remaining ANSI escape codes
CLEAN_OUTPUT=$(echo "$COVERAGE_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')

# Parse the "All files" line for line coverage (first percentage)
COVERAGE_LINE=$(echo "$CLEAN_OUTPUT" | grep "All files" || true)

if [ -z "$COVERAGE_LINE" ]; then
  echo "Could not determine test coverage. Ensure tests pass first." >&2
  echo "" >&2
  echo "$COVERAGE_OUTPUT" >&2
  exit 2
fi

# Extract line coverage (third column): "All files | % Funcs | % Lines | ..."
LINE_COVERAGE=$(echo "$COVERAGE_LINE" | awk -F'|' '{print $3}' | tr -d ' %')

# Validate that the parsed value is numeric
if ! [[ "$LINE_COVERAGE" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "Coverage value '$LINE_COVERAGE' is not numeric." >&2
  echo "Raw line: $COVERAGE_LINE" >&2
  exit 2
fi

# Compare coverage against threshold (90%)
THRESHOLD=90
PASS=$(awk "BEGIN { print ($LINE_COVERAGE >= $THRESHOLD) ? 1 : 0 }")

if [ "$PASS" -eq 0 ]; then
  echo "Test coverage is ${LINE_COVERAGE}%, which is below the ${THRESHOLD}% threshold." >&2
  echo "" >&2
  echo "$CLEAN_OUTPUT" >&2
  exit 2
fi

exit 0
