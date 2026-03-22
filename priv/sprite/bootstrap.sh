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
  if command -v bun &> /dev/null; then
    bun install -g @anthropic-ai/claude-code || echo "Warning: Claude Code installation failed"
  elif command -v npm &> /dev/null; then
    npm install -g @anthropic-ai/claude-code || echo "Warning: Claude Code installation failed"
  else
    echo "Warning: Neither bun nor npm available, skipping Claude Code install"
  fi
fi

# --- Write environment profile sourced by all shells ---
# Use /etc/profile.d/ so both interactive and non-interactive login shells pick up paths
PROFILE_SCRIPT="/etc/profile.d/shire-env.sh"
cat > "$PROFILE_SCRIPT" << 'ENVSH'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.bun/install/global/node_modules/.bin:$PATH"
ENVSH

# Also write workspace-specific env sourcing to bashrc
cat > "$HOME/.bashrc" << BASHRC
# Source tool paths
if [ -f "$PROFILE_SCRIPT" ]; then
  . "$PROFILE_SCRIPT"
fi
# Source workspace env vars
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
