@echo off
rem MboaPilot - lanceur Windows : demarre le serveur et ouvre l'application dans le navigateur.
rem Double-cliquez sur ce fichier. Laissez la fenetre ouverte (reduite) tant que vous utilisez l'application.
chcp 65001 >nul
title MboaPilot
cd /d "%~dp0"

if "%PORT%"=="" set PORT=3001
set "ADRESSE=http://127.0.0.1:%PORT%"

rem deja demarre (deuxieme double-clic, ou demarrage automatique) : on ouvre simplement le navigateur
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%ADRESSE%/api/v1/installation/etat' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo MboaPilot est deja demarre.
  if not "%MBOAPILOT_SANS_NAVIGATEUR%"=="1" start "" "%ADRESSE%"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable sur ce poste.
  echo Installez Node.js ^(version 20 ou plus, https://nodejs.org^) puis relancez MboaPilot.
  pause
  exit /b 1
)

rem apres une mise a jour du code : composants a reinstaller si la liste des dependances est plus recente que leur
rem installation, interface a reconstruire si ses sources sont plus recentes que la version construite (sinon une ancienne
rem interface tournerait avec le nouveau serveur)
set "REINSTALLER=0"
set "RECONSTRUIRE=0"
if not exist "node_modules" set "REINSTALLER=1"
if exist "node_modules\.package-lock.json" if exist "package-lock.json" (
  powershell -NoProfile -Command "if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.package-lock.json').LastWriteTime) { exit 1 } else { exit 0 }" >nul 2>nul
  if errorlevel 1 set "REINSTALLER=1"
)

if "%REINSTALLER%"=="1" (
  echo Installation des composants ^(quelques minutes, connexion Internet necessaire^)...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Verifiez la connexion Internet puis relancez.
    pause
    exit /b 1
  )
  rem repere de fin d'installation : evite de reinstaller a chaque demarrage meme si npm n'a rien eu a changer
  powershell -NoProfile -Command "if (Test-Path 'node_modules\.package-lock.json') { (Get-Item 'node_modules\.package-lock.json').LastWriteTime = Get-Date }" >nul 2>nul
  set "RECONSTRUIRE=1"
)

if not exist "apps\web\dist\index.html" set "RECONSTRUIRE=1"
if exist "apps\web\dist\index.html" (
  powershell -NoProfile -Command "$d = (Get-Item 'apps\web\dist\index.html').LastWriteTime; $s = Get-ChildItem 'apps\web\src','packages\shared\src' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($s -and $s.LastWriteTime -gt $d) { exit 1 } else { exit 0 }" >nul 2>nul
  if errorlevel 1 set "RECONSTRUIRE=1"
)

if "%RECONSTRUIRE%"=="1" (
  echo Construction de l'interface...
  call npm run build
  if errorlevel 1 (
    echo La construction de l'interface a echoue.
    pause
    exit /b 1
  )
)

rem ouvre le navigateur des que le serveur repond (jusqu'a 2 minutes d'attente)
if not "%MBOAPILOT_SANS_NAVIGATEUR%"=="1" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri '%ADRESSE%/api/v1/installation/etat' -TimeoutSec 2 | Out-Null; Start-Process '%ADRESSE%'; break } catch { Start-Sleep -Seconds 1 } }"
)

echo MboaPilot demarre sur %ADRESSE%
echo Ne fermez pas cette fenetre tant que vous utilisez l'application : la fermer arrete MboaPilot.
echo.
call npm start

echo.
echo MboaPilot s'est arrete. Relancez-le en double-cliquant sur ce fichier.
pause
