@echo off
rem MboaPilot - copie de securite HORS de l'ordinateur (cle USB, second disque, dossier reseau).
rem Usage : double-clic (le dossier de destination est demande), ou  sauvegarde-externe.bat E:\MboaPilot-copie
rem Copie les sauvegardes, la cle de chiffrement (.encryption-key), les photos SAV et le logo.
rem Ne copie JAMAIS la base en cours d'utilisation (mboapilot.db et son journal) : ce fichier peut etre vide ou perime tant que
rem MboaPilot tourne. Les sauvegardes du dossier backups\ sont, elles, completes (une par jour, et a la cloture de caisse).
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%MBOAPILOT_DATA_DIR%"=="" (set "DONNEES=%~dp0apps\api\data") else (set "DONNEES=%MBOAPILOT_DATA_DIR%")
set "DESTINATION=%~1"
set "INTERACTIF=0"
if "%DESTINATION%"=="" (
  set "INTERACTIF=1"
  set /p "DESTINATION=Dossier de destination (par exemple E:\MboaPilot-copie) : "
)
if "%DESTINATION%"=="" (
  echo Aucune destination indiquee : rien n'a ete copie.
  if "%INTERACTIF%"=="1" pause
  exit /b 1
)
if not exist "%DONNEES%\" (
  echo Dossier de donnees introuvable : %DONNEES%
  if "%INTERACTIF%"=="1" pause
  exit /b 1
)

echo Copie de "%DONNEES%" vers "%DESTINATION%" ...
robocopy "%DONNEES%" "%DESTINATION%" /E /XF mboapilot.db mboapilot.db-wal mboapilot.db-shm .jwt-secret /NFL /NDL /NJH /NJS /NP >nul
rem robocopy : 0 a 7 = succes (8 et plus = echec)
if errorlevel 8 (
  echo ECHEC de la copie : verifiez que la destination est branchee et qu'il reste de la place.
  if "%INTERACTIF%"=="1" pause
  exit /b 1
)

dir /b "%DESTINATION%\backups\mboapilot-sauvegarde-*.db" >nul 2>nul
if errorlevel 1 (
  echo ATTENTION : aucune sauvegarde trouvee a la destination. Dans MboaPilot, faites Administration, Parametres, "Exporter mes donnees",
  echo ou cloturez la caisse, puis relancez cette copie.
  if "%INTERACTIF%"=="1" pause
  exit /b 2
)

echo Copie terminee : "%DESTINATION%"
echo Gardez ce support en lieu sur, hors de l'ordinateur de la boutique.
if "%INTERACTIF%"=="1" pause
exit /b 0
