#!/bin/bash
# bootstrap.sh — Sets up the base directory structure on the workspace.
# Run once when the VM is first created.
# Accepts workspace root as $1, defaults to /workspace for Sprite VMs.

set -euo pipefail

WORKSPACE_ROOT="${1:-/workspace}"

# --- Install Bun if not available ---
if ! command -v bun &> /dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.com/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "Bun installed: $(bun --version)"
fi

# --- Install Claude Code if not available ---
if ! command -v claude &> /dev/null; then
  echo "Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  echo "Claude Code installed: $(claude --version)"
fi

mkdir -p "$WORKSPACE_ROOT/.runner"
mkdir -p "$WORKSPACE_ROOT/.scripts"
mkdir -p "$WORKSPACE_ROOT/shared"
mkdir -p "$WORKSPACE_ROOT/agents"

# Source workspace env vars and tool paths in every interactive/login shell
cat > /root/.bashrc << BASHRC
export BUN_INSTALL="\$HOME/.bun"
export PATH="\$BUN_INSTALL/bin:\$HOME/.claude/local:\$PATH"
if [ -f $WORKSPACE_ROOT/.env ]; then
  set -a
  . $WORKSPACE_ROOT/.env
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
