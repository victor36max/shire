#!/bin/bash
# bootstrap.sh — Sets up the mailbox directory structure on a Sprite VM.
# Run once when an agent is first created.

set -euo pipefail

mkdir -p /workspace/mailbox/inbox
mkdir -p /workspace/mailbox/outbox
mkdir -p /workspace/skills

echo "0" > /workspace/mailbox/.inbox_seq
echo "0" > /workspace/mailbox/.outbox_seq

echo "Bootstrap complete"
