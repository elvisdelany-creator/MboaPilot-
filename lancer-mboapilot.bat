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

if not exist "node_modules" (
  echo Premiere preparation : installation des composants ^(quelques minutes, connexion Internet necessaire^)...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Verifiez la connexion Internet puis relancez.
    pause
    exit /b 1
  )
)

if not exist "apps\web\dist\index.html" (
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
