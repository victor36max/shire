#!/bin/bash
# bootstrap.sh — Sets up the directory structure on a Sprite VM.
# Run once when an agent is first created.

set -euo pipefail

mkdir -p /workspace/.runner
mkdir -p /workspace/.recipe-state
mkdir -p /workspace/mailbox/inbox
mkdir -p /workspace/mailbox/outbox
mkdir -p /workspace/scripts
mkdir -p /workspace/documents
mkdir -p /workspace/shared
mkdir -p /workspace/.drive-sync

echo "0" > /workspace/mailbox/.inbox_seq
echo "0" > /workspace/mailbox/.outbox_seq

echo "Bootstrap complete"
