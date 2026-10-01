"""ParaWorld Toolkit: one launcher for the Model & Map Exporter and the ParaWorld remake.

    python -m toolkit            (or "Start ParaWorld Toolkit.bat" / start.sh)

Runs a small web server on this computer (127.0.0.1 only) and opens the launcher in the browser. The launcher asks
where ParaWorld is installed; the exporter reads the game files from there, and the remake's game data is built from
them on its first start (toolkit/remake.py -> remake/pipeline). No game file is part of the toolkit.
"""
VERSION = '2026.10.1'
