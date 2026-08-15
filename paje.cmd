@echo off
rem paje.cmd - Shim para o PAJE ser chamado como "paje" (sem extensao) no Windows.
rem
rem .ps1 nao esta em PATHEXT por padrao, e o PowerShell recusa rodar scripts por
rem nome nu mesmo com o diretorio no PATH (protecao de seguranca contra script
rem malicioso mascarado como comando) - so .cmd/.bat/.exe resolvem dessa forma,
rem tanto no cmd.exe quanto dentro do proprio PowerShell. Este shim so repassa
rem tudo para paje.ps1, que faz o trabalho de verdade.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0paje.ps1" %*
exit /b %ERRORLEVEL%
