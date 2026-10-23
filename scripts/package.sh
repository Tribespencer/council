#!/usr/bin/env bash
# Builds council.skill, the zip you upload to claude.ai / Claude Desktop (Settings > Capabilities > Skills).
# The zip root must contain the skill folder itself, so we zip from skills/.
set -eu
cd "$(dirname "$0")/../skills"
rm -f ../council.skill
zip -qr ../council.skill council -x '*/evals/*' -x '*.DS_Store' -x '*/__pycache__/*'
echo "wrote $(cd .. && pwd)/council.skill ($(du -h ../council.skill | cut -f1))"
