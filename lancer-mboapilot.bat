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
if errorlevel 1 goto :pas_demarre
if not "%MBOAPILOT_SANS_NAVIGATEUR%"=="1" start "" "%ADRESSE%"
rem une mise a jour copiee pendant que MboaPilot tourne ne s'applique qu'apres un redemarrage : le dire, et laisser le temps de lire
node scripts\preparation.mjs en-attente >nul 2>nul
if errorlevel 12 (
  echo.
  echo ATTENTION : une mise a jour de MboaPilot attend. La version deja ouverte est encore l'ancienne.
  echo Fermez la fenetre MboaPilot deja ouverte ^(souvent reduite dans la barre des taches^), puis relancez ce fichier.
  echo Si vous ne la trouvez pas, redemarrez l'ordinateur.
  echo.
  pause
  exit /b 0
)
echo MboaPilot est deja demarre.
exit /b 0

:pas_demarre

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable sur ce poste.
  echo Installez Node.js ^(version 20 ou plus, https://nodejs.org^) puis relancez MboaPilot.
  pause
  exit /b 1
)

rem apres une mise a jour du code : composants a reinstaller, interface a reconstruire (sinon une ancienne interface tournerait avec le
rem nouveau serveur). Le contenu des fichiers est compare, pas leurs dates.
set "REINSTALLER=0"
set "RECONSTRUIRE=0"
node scripts\preparation.mjs verifier
set "ETAT=%errorlevel%"
if "%ETAT%"=="10" set "REINSTALLER=1"
if "%ETAT%"=="10" set "RECONSTRUIRE=1"
if "%ETAT%"=="11" set "RECONSTRUIRE=1"
if not "%ETAT%"=="0" if not "%ETAT%"=="10" if not "%ETAT%"=="11" (
  echo Impossible de verifier les fichiers de MboaPilot : le dossier est peut-etre incomplet.
  pause
  exit /b 1
)

if "%REINSTALLER%"=="1" (
  echo Installation des composants ^(quelques minutes, connexion Internet necessaire^)...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Verifiez la connexion Internet puis relancez.
    pause
    exit /b 1
  )
  rem repere de fin d'installation : evite de reinstaller a chaque demarrage
  node scripts\preparation.mjs installe
  set "RECONSTRUIRE=1"
)

if "%RECONSTRUIRE%"=="1" (
  echo Construction de l'interface...
  call npm run build
  if errorlevel 1 (
    echo La construction de l'interface a echoue.
    pause
    exit /b 1
  )
  node scripts\preparation.mjs construit
)

rem dossier des donnees : MBOAPILOT_DATA_DIR, sinon donnees.txt (a cote de ce fichier), sinon apps\api\data. Il est affiche ici, et le
rem demarrage s'arrete si donnees.txt est illisible ou designe un dossier vide alors que la boutique est ailleurs.
call npm run --silent donnees --workspace=apps/api
if errorlevel 1 (
  echo.
  echo MboaPilot ne demarre pas : corrigez le probleme ci-dessus, puis relancez.
  pause
  exit /b 1
)

rem ouvre le navigateur des que le serveur repond (jusqu'a 2 minutes d'attente)
if not "%MBOAPILOT_SANS_NAVIGATEUR%"=="1" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri '%ADRESSE%/api/v1/installation/etat' -TimeoutSec 2 | Out-Null; Start-Process '%ADRESSE%'; break } catch { Start-Sleep -Seconds 1 } }"
)

node scripts\preparation.mjs en-service
echo MboaPilot demarre sur %ADRESSE%
echo Ne fermez pas cette fenetre tant que vous utilisez l'application : la fermer arrete MboaPilot.
echo.
call npm start

echo.
echo MboaPilot s'est arrete. Relancez-le en double-cliquant sur ce fichier.
pause
