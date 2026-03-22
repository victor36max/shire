#!/bin/bash
# bootstrap.sh — Sets up the base directory structure on the workspace.
# Run once when the VM is first created.
# Accepts workspace root as $1, defaults to /workspace for Sprite VMs.

set -euo pipefail

WORKSPACE_ROOT="${1:-/workspace}"

# --- Create workspace directories first (must always succeed) ---
mkdir -p "$WORKSPACE_ROOT/.runner"
mkdir -p "$WORKSPACE_ROOT/.scripts"
mkdir -p "$WORKSPACE_ROOT/shared"
mkdir -p "$WORKSPACE_ROOT/agents"

# --- Install Bun if not available (best-effort) ---
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  if curl -fsSL https://bun.sh/install | bash; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    echo "Bun installed: $(bun --version)"
  else
    echo "Warning: Bun installation failed"
  fi
fi

# --- Install Claude Code if not available (best-effort, requires bun or npm) ---
if ! command -v claude &> /dev/null; then
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash || echo "Warning: Claude Code installation failed"
fi

# Set up tool paths and workspace env vars for all shells
cat > "$HOME/.bashrc" << 'BASHRC'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.claude/local:$PATH"
BASHRC

cat >> "$HOME/.bashrc" << BASHRC
if [ -f "$WORKSPACE_ROOT/.env" ]; then
  set -a
  . "$WORKSPACE_ROOT/.env"
  set +a
fi
BASHRC

# Create default PROJECT.md if it doesn't exist
if [ ! -f "$WORKSPACE_ROOT/PROJECT.md" ]; then
  cat > "$WORKSPACE_ROOT/PROJECT.md" << 'PROJECTMD'
# Project

Describe your project here. All agents will check this document for context before starting tasks and update it after completing work.
PROJECTMD
fi

echo "Bootstrap complete"
