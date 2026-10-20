@echo off
rem MboaPilot - annule le demarrage automatique (supprime le raccourci du dossier Demarrage).
chcp 65001 >nul

if "%MBOAPILOT_DOSSIER_DEMARRAGE%"=="" (
  set "DOSSIER_DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
) else (
  set "DOSSIER_DEMARRAGE=%MBOAPILOT_DOSSIER_DEMARRAGE%"
)

if exist "%DOSSIER_DEMARRAGE%\MboaPilot.lnk" (
  del "%DOSSIER_DEMARRAGE%\MboaPilot.lnk"
  echo Le demarrage automatique de MboaPilot est retire.
) else (
  echo Le demarrage automatique n'etait pas active.
)
if not "%MBOAPILOT_SANS_PAUSE%"=="1" pause
