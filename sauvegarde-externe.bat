@echo off
rem MboaPilot - copie de securite HORS de l'ordinateur (cle USB, second disque, dossier reseau).
rem Usage : double-clic (le dossier de destination est demande), ou  sauvegarde-externe.bat E:\MboaPilot-copie
rem Copie les sauvegardes, la cle de chiffrement (.encryption-key), les photos SAV et le logo, jamais la base en service.
rem Le travail est fait par apps\api\src\outils\copie-externe.ts (meme dossier de donnees que lancer-mboapilot.bat).
rem Code de sortie : 0 copie a jour, 1 echec, 2 copie sans sauvegarde recente.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "MBOAPILOT_DESTINATION=%~1"
set "INTERACTIF=0"
if not defined MBOAPILOT_DESTINATION (
  set "INTERACTIF=1"
  set /p "MBOAPILOT_DESTINATION=Dossier de destination (par exemple E:\MboaPilot-copie) : "
)
if defined MBOAPILOT_DESTINATION set "MBOAPILOT_DESTINATION=%MBOAPILOT_DESTINATION:"=%"
if not defined MBOAPILOT_DESTINATION (
  echo Aucune destination indiquee : rien n'a ete copie.
  if "%INTERACTIF%"=="1" pause
  exit /b 1
)
if not exist "node_modules" (
  echo Les composants de MboaPilot ne sont pas installes : lancez d'abord lancer-mboapilot.bat.
  if "%INTERACTIF%"=="1" pause
  exit /b 1
)

call npm run --silent copie:externe --workspace=apps/api
set "CODE=%errorlevel%"
if "%INTERACTIF%"=="1" pause
exit /b %CODE%
