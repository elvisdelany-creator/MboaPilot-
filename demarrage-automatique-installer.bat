@echo off
rem MboaPilot - demarre automatiquement a l'ouverture de session Windows (raccourci dans le dossier Demarrage).
chcp 65001 >nul
cd /d "%~dp0"

if "%MBOAPILOT_DOSSIER_DEMARRAGE%"=="" (
  set "DOSSIER_DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
) else (
  set "DOSSIER_DEMARRAGE=%MBOAPILOT_DOSSIER_DEMARRAGE%"
)

powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DOSSIER_DEMARRAGE + '\MboaPilot.lnk'); $s.TargetPath = '%~dp0lancer-mboapilot.bat'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Description = 'Demarre MboaPilot'; $s.Save()"
if errorlevel 1 (
  echo Impossible de creer le raccourci de demarrage automatique.
  pause
  exit /b 1
)

echo MboaPilot demarrera automatiquement a la prochaine ouverture de session Windows.
echo Pour annuler : double-cliquez sur demarrage-automatique-retirer.bat
if not "%MBOAPILOT_SANS_PAUSE%"=="1" pause
