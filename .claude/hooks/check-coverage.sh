#!/bin/bash
# Enforce test coverage thresholds (used by pre-commit hook, CI, and Claude hooks).
# - Overall function and line coverage must be >= 80%
# - Per-file line coverage must be >= 80% (except skipped files)
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

THRESHOLD=80

# Files excluded from per-file checks (coverage tool limitations)
SKIP_FILES=(
  "src/cli.ts"              # process spawning, port binding
  "src/index.ts"            # Bun.serve() binds port
  "src/db/schema.ts"        # Drizzle ORM $defaultFn lambdas
  "src/runtime/harness/index.ts"       # globally mocked by other tests
  "src/runtime/harness/pi-harness.ts"  # SDK-internal callbacks
  "src/frontend/lib/ws.ts"               # globally mocked in all frontend tests
  "src/frontend/hooks/ws.ts"             # globally mocked in all frontend component tests
  "src/frontend/components/AgentChatView.tsx"   # ws subscription callbacks unreachable
  "src/frontend/components/ProjectLayout.tsx"   # ws subscription callbacks unreachable
  "src/frontend/components/Markdown.tsx"         # rehype plugin callbacks
  "src/server.ts"                                # Bun.serve() + WebSocket handlers
  "src/frontend/components/editor/"              # Lexical editor plugins need real DOM
  "src/frontend/components/lib/utils.ts"         # utility file, tested transitively
)

# Run tests with coverage
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
NO_COLOR=1 bun test --coverage > "$TMPFILE" 2>&1 || true

# Strip ANSI escape codes
perl -pi -e 's/\x1b\[[0-9;]*m//g' "$TMPFILE"

# Verify the coverage table exists
if ! grep -q "All files" "$TMPFILE"; then
  echo "Could not determine test coverage. Ensure tests pass first." >&2
  tail -50 "$TMPFILE" >&2
  exit 2
fi

FAILURES=""

# --- Check overall coverage ---
ALL_LINE=$(grep "All files" "$TMPFILE")
OVERALL_FUNCS=$(echo "$ALL_LINE" | awk -F'|' '{print $2}' | tr -d ' %')
OVERALL_LINES=$(echo "$ALL_LINE" | awk -F'|' '{print $3}' | tr -d ' %')

FUNCS_OK=$(awk "BEGIN { print ($OVERALL_FUNCS >= $THRESHOLD) ? 1 : 0 }")
LINES_OK=$(awk "BEGIN { print ($OVERALL_LINES >= $THRESHOLD) ? 1 : 0 }")

if [ "$FUNCS_OK" -eq 0 ] || [ "$LINES_OK" -eq 0 ]; then
  FAILURES="${FAILURES}  [overall] funcs=${OVERALL_FUNCS}% lines=${OVERALL_LINES}% (both must be >=${THRESHOLD}%)\n"
fi

# --- Check per-file line coverage ---
while IFS='|' read -r FILE _FUNCS LINES _REST; do
  LINES_VAL=$(echo "$LINES" | tr -d ' %')
  FILE_TRIMMED=$(echo "$FILE" | sed 's/^ *//;s/ *$//')

  [[ "$LINES_VAL" =~ ^[0-9]+(\.[0-9]+)?$ ]] || continue

  # Skip test files
  [[ "$FILE_TRIMMED" == *.test.* ]] && continue
  [[ "$FILE_TRIMMED" == */test/* ]] && continue

  # Skip excluded files
  SKIP=false
  for sf in "${SKIP_FILES[@]}"; do
    # Support both exact file matches and directory prefixes (ending in /)
    if [[ "$sf" == */ ]]; then
      [[ "$FILE_TRIMMED" == "$sf"* ]] && SKIP=true && break
    else
      [[ "$FILE_TRIMMED" == "$sf" ]] && SKIP=true && break
    fi
  done
  $SKIP && continue

  LINE_OK=$(awk "BEGIN { print ($LINES_VAL >= $THRESHOLD) ? 1 : 0 }")
  if [ "$LINE_OK" -eq 0 ]; then
    FAILURES="${FAILURES}  ${FILE_TRIMMED}  lines=${LINES_VAL}%\n"
  fi
done < <(grep '^ *src/' "$TMPFILE")

if [ -n "$FAILURES" ]; then
  echo "Coverage below ${THRESHOLD}% threshold:" >&2
  echo "" >&2
  printf "%b" "$FAILURES" >&2
  exit 2
fi

exit 0
