@echo off
REM Baoji launcher (Windows). ASCII only to avoid GBK/UTF-8 pitfalls.
REM Usage:
REM   start.bat                  default 0.0.0.0:8000
REM   start.bat --no-auth        disable password (trusted LAN only)
REM   start.bat --port 0          let OS pick a free port (printed on start)
REM   start.bat --host 127.0.0.1  localhost only

cd /d "%~dp0"
if not exist ".venv" (
  python -m venv .venv
  .venv\Scripts\pip install -r requirements.txt
)
.venv\Scripts\python.exe main.py %*
pause
