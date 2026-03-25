#!/bin/bash
# bootstrap.sh — Installs runtime dependencies on the VM.
# Workspace directory creation is handled by Setup.setup_workspace/1 in Elixir.
# Accepts workspace root as $1, defaults to /workspace for Sprite VMs.

set -euo pipefail

WORKSPACE_ROOT="${1:-/workspace}"

# --- Ensure unzip is available (needed by Bun installer) ---
if ! command -v unzip &> /dev/null; then
  echo "Installing unzip..."
  if command -v apt-get &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y -qq unzip
  elif command -v yum &> /dev/null; then
    sudo yum install -y unzip
  fi
fi

# --- Write .shire_profile (sourced by SSH commands, no interactive guard) ---
cat > "$HOME/.shire_profile" << 'PROFILE'
export BUN_INSTALL="$HOME/.bun"
export PATH="$HOME/.local/bin:$HOME/.claude/local:$BUN_INSTALL/bin:$PATH"
PROFILE
source "$HOME/.shire_profile"

# --- Install Bun if not available ---
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash || echo "Warning: Bun installation failed"
fi

# --- Install Claude Code if not available ---
if ! command -v claude &> /dev/null; then
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash || echo "Warning: Claude Code installation failed"
fi

# --- Install runner dependencies ---
if [ -f "$WORKSPACE_ROOT/.runner/package.json" ]; then
  echo "Installing runner dependencies..."
  cd "$WORKSPACE_ROOT/.runner" && bun install
fi

echo "Bootstrap complete"
