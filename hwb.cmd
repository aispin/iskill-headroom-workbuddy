@echo off
rem ============================================================
rem  iskill-headroom-workbuddy - Windows double-click entry
rem
rem  Double-click THIS file. Reason: double-clicking a .ps1 opens
rem  Notepad instead of running it. This shim calls PowerShell with
rem  -ExecutionPolicy Bypass so it just works.
rem
rem  Real logic lives in scripts\hwb.py (one cross-platform codebase).
rem ============================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hwb.ps1" %*
set rc=%ERRORLEVEL%
endlocal & exit /b %rc%
