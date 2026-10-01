#!/bin/sh
# ParaWorld Toolkit for Linux / macOS (Python 3.8+). Usage: ./start.sh [--port N] [--no-browser]
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
[ -z "$PY" ] && { echo "Python 3 is needed: https://www.python.org/downloads/"; exit 1; }
"$PY" -c "import numpy, PIL" 2>/dev/null || "$PY" -m pip install --user -r requirements.txt || exit 1
exec "$PY" -m toolkit "$@"
