#requires -Version 5.1
# paje.ps1 - Ponto de entrada do PAJE no Windows (equivalente a paje.sh)
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Precisa ser capturado ANTES do "Set-Location $RootDir" abaixo — dali em
# diante o diretorio de trabalho do processo e o de instalacao do PAJE, nao
# mais o de onde o usuario chamou "paje". gitCommand.ts usa isso pra
# posicionar o cursor da arvore no repositorio correspondente ao diretorio
# de origem.
$invokedFrom = (Get-Location).Path
$env:PAJE_INVOKED_FROM = $invokedFrom

if (-not (Test-Path (Join-Path $RootDir "package.json"))) {
    Write-Host "[ERRO] package.json nao encontrado. Execute o PAJE a partir do diretorio raiz." -ForegroundColor Red
    exit 1
}

Set-Location $RootDir

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERRO] npm nao encontrado no PATH. Instale o Node.js: https://nodejs.org/" -ForegroundColor Red
    Set-Location $invokedFrom
    exit 1
}

if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    Write-Host "[INFO] Instalando dependencias..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        $err = $LASTEXITCODE
        Set-Location $invokedFrom
        exit $err
    }
}

Write-Host "[INFO] Executando PAJE..."
try {
    if ($args.Count -gt 0) {
        & npm.cmd run dev -- @args
    } else {
        & npm.cmd run dev
    }
    $exitCode = $LASTEXITCODE
} finally {
    $cdTarget = Join-Path $env:USERPROFILE ".paje\cd-target"
    if (Test-Path $cdTarget) {
        $targetDir = (Get-Content $cdTarget -Raw).Trim()
        Remove-Item $cdTarget -Force -ErrorAction SilentlyContinue
        if ($targetDir -and (Test-Path $targetDir)) {
            Set-Location $targetDir
        } else {
            Set-Location $invokedFrom
        }
    } else {
        Set-Location $invokedFrom
    }
}

exit $exitCode
