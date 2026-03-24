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

# --- Ensure unzip is available (needed by Bun installer) ---
if ! command -v unzip &> /dev/null; then
  echo "Installing unzip..."
  if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq unzip
  elif command -v yum &> /dev/null; then
    sudo yum install -y unzip
  fi
fi

# --- Install Bun if not available ---
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash || echo "Warning: Bun installation failed"
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# --- Install Claude Code if not available ---
if ! command -v claude &> /dev/null; then
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash || echo "Warning: Claude Code installation failed"
  export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH"
fi

# --- Write .shire_profile (sourced by SSH commands, no interactive guard) ---
cat > "$HOME/.shire_profile" << 'PROFILE'
export BUN_INSTALL="$HOME/.bun"
export PATH="$HOME/.local/bin:$HOME/.claude/local:$BUN_INSTALL/bin:$PATH"
PROFILE

# Create default PROJECT.md if it doesn't exist
if [ ! -f "$WORKSPACE_ROOT/PROJECT.md" ]; then
  cat > "$WORKSPACE_ROOT/PROJECT.md" << 'PROJECTMD'
# Project

Describe your project here. All agents will check this document for context before starting tasks and update it after completing work.
PROJECTMD
fi

# --- Install runner dependencies ---
if [ -f "$WORKSPACE_ROOT/.runner/package.json" ]; then
  echo "Installing runner dependencies..."
  cd "$WORKSPACE_ROOT/.runner" && bun install
fi

echo "Bootstrap complete"
