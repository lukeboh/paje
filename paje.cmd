@echo off
rem paje.cmd - Shim de inicializacao do PAJE no Windows (cmd.exe e PowerShell).
rem
rem Define PAJE_INVOKED_FROM com o diretorio de origem do usuario (para a
rem arvore git-sync posicionar o cursor no repositorio atual) e executa o
rem PAJE diretamente via Node/npm, sem instanciar subprocessos do PowerShell
rem que bloqueiam o modo raw de stdin e impedem a captura de teclado (Bug 1)
rem ou deixam o terminal preso na saida ate Ctrl+C (Bug 2).

setlocal
set "PAJE_INVOKED_FROM=%CD%"

set "PAJE_ROOT=%~dp0"
if "%PAJE_ROOT:~-1%"=="\" set "PAJE_ROOT=%PAJE_ROOT:~0,-1%"

if not exist "%PAJE_ROOT%\package.json" (
    echo [ERRO] package.json nao encontrado em %PAJE_ROOT%.
    exit /b 1
)

cd /d "%PAJE_ROOT%"

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERRO] npm nao encontrado no PATH. Instale o Node.js: https://nodejs.org/
    exit /b 1
)

if not exist "%PAJE_ROOT%\node_modules" (
    echo [INFO] Instalando dependencias...
    call npm install
    if errorlevel 1 exit /b %errorlevel%
)

call npm run dev -- %*
exit /b %ERRORLEVEL%
