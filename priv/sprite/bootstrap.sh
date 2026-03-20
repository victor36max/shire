#!/bin/bash
# bootstrap.sh — Sets up the base directory structure on the shared Sprite VM.
# Run once when the VM is first created.

set -euo pipefail

mkdir -p /workspace/.runner
mkdir -p /workspace/.scripts
mkdir -p /workspace/shared
mkdir -p /workspace/agents

# Source workspace env vars in every interactive/login shell
cat > /root/.bashrc << 'BASHRC'
if [ -f /workspace/.env ]; then
  set -a
  . /workspace/.env
  set +a
fi
BASHRC

# Create default PROJECT.md if it doesn't exist
if [ ! -f /workspace/PROJECT.md ]; then
  cat > /workspace/PROJECT.md << 'PROJECTMD'
# Project

Describe your project here. All agents will check this document for context before starting tasks and update it after completing work.
PROJECTMD
fi

echo "Bootstrap complete"
