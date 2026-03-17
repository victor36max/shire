#!/bin/bash
# bootstrap.sh — Sets up the base directory structure on the shared Sprite VM.
# Run once when the VM is first created.

set -euo pipefail

mkdir -p /workspace/.runner
mkdir -p /workspace/.scripts
mkdir -p /workspace/shared
mkdir -p /workspace/agents

echo "Bootstrap complete"
