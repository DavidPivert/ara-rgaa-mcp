#!/usr/bin/env bash
# Wrapper script to ensure node_modules are resolved correctly.
# Usage in Claude Code config:
#   "command": "bash",
#   "args": ["/absolute/path/to/ara-rgaa-mcp/run.sh"]

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
exec node build/index.js "$@"
