@echo off
rem ParaWorld Shooter (third-person action game made with your ParaWorld files) - double-click to start.
rem The game data must have been prepared once in the ParaWorld Toolkit (Remake card, "Prepare the game data"). Needs Python 3.8 or newer (python.org).
setlocal
cd /d "%~dp0"
title ParaWorld Shooter
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY (
  echo.
  echo  Python 3 is needed to run the ParaWorld Shooter.
  echo  Download it from https://www.python.org/downloads/ and tick
  echo  "Add python.exe to PATH" in the installer, then start this file again.
  echo.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)
%PY% -c "import numpy, PIL" 2>nul
if errorlevel 1 (
  echo Installing the helper packages numpy and pillow - only needed once...
  %PY% -m pip install --user -r requirements.txt
  if errorlevel 1 (
    echo Could not install numpy and pillow. Try: %PY% -m pip install numpy pillow
    pause
    exit /b 1
  )
)
%PY% -m shooter %*
if errorlevel 1 pause
