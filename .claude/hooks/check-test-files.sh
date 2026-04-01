#!/bin/bash
# Stop hook: block if any new/modified source files are missing co-located test files.
set -euo pipefail

INPUT=$(cat)

# Avoid infinite loop — if the stop hook is already active, bail out
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Collect changed/new source files (staged, unstaged, and untracked)
CHANGED_FILES=$(
  {
    git diff --name-only --diff-filter=ACM HEAD 2>/dev/null || true
    git diff --name-only --diff-filter=ACM --cached 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
)

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

MISSING=()

while IFS= read -r file; do
  # Only check src/**/*.ts and src/**/*.tsx
  [[ "$file" == src/* ]] || continue
  [[ "$file" == *.ts || "$file" == *.tsx ]] || continue

  # Skip test files
  [[ "$file" == *.test.ts || "$file" == *.test.tsx ]] && continue

  # Skip type definitions
  [[ "$file" == *.d.ts ]] && continue

  # Skip DB schema/migrations
  [[ "$file" == src/db/* ]] && continue

  # Skip shadcn UI primitives
  [[ "$file" == src/frontend/components/ui/* ]] && continue

  # Skip test setup/helpers
  [[ "$file" == src/test/* ]] && continue
  [[ "$file" == src/frontend/test/* ]] && continue

  # Skip known entry points and config files
  basename=$(basename "$file")
  case "$basename" in
    index.ts|index.tsx|cli.ts|server.ts|events.ts) continue ;;
    types.ts|types.tsx) continue ;;
  esac

  # Determine expected co-located test file path
  dir=$(dirname "$file")
  name="${basename%.*}"
  ext="${basename##*.}"
  test_file="${dir}/${name}.test.${ext}"

  if [ ! -f "$test_file" ]; then
    MISSING+=("$file -> $test_file")
  fi
done <<< "$CHANGED_FILES"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Missing co-located test files for the following source files:" >&2
  echo "" >&2
  for entry in "${MISSING[@]}"; do
    echo "  $entry" >&2
  done
  echo "" >&2
  echo "Every source file needs a co-located test file (e.g. foo.ts -> foo.test.ts)." >&2
  exit 2
fi

exit 0
