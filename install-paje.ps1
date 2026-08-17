#requires -Version 5.1
# install-paje.ps1 - Instalacao e provisionamento inicial do PAJE (Windows/PowerShell)
# Equivalente Windows de install-paje.sh: mesma logica geral (checar Git, clonar
# repositorio, health-check, criar entrypoint, adicionar ao PATH do usuario),
# adaptada as ferramentas nativas do PowerShell.

$ErrorActionPreference = "Stop"

$PajeDefaultRepo = "https://github.com/lukeboh/paje.git"
$PajeDirDefault = "paje"
$PajeBaseDirDefault = Join-Path $env:USERPROFILE "git"

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message"
}

function Write-WarnMsg([string]$Message) {
    Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Exit-WithError([string]$Message) {
    Write-Host "[ERRO] $Message" -ForegroundColor Red
    exit 1
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Git {
    if (Test-CommandExists "git") {
        Write-Info "Git encontrado."
        return
    }
    Write-WarnMsg "Git nao encontrado. Iniciando instalacao..."
    if (Test-CommandExists "winget") {
        Write-Info "Usando winget para instalar o Git."
        winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
        # winget acabou de alterar o PATH da maquina; a sessao atual do
        # PowerShell nao recarrega isso sozinha, entao reconstruimos o PATH
        # combinando Machine + User antes de checar de novo.
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not (Test-CommandExists "git")) {
            Exit-WithError "Git instalado, mas nao encontrado nesta sessao. Feche e reabra o PowerShell e rode o instalador de novo, ou instale manualmente: https://git-scm.com/download/win"
        }
    } else {
        Exit-WithError "Git nao encontrado e winget indisponivel. Instale manualmente: https://git-scm.com/download/win"
    }
}

function Read-WithDefault([string]$Prompt, [string]$Default) {
    $value = Read-Host "$Prompt (enter para padrao: $Default)"
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }
    return $value
}

function Read-YesNo([string]$Prompt, [string]$DefaultAnswer) {
    while ($true) {
        $answer = Read-Host "$Prompt (S/N) [padrao: $DefaultAnswer]"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            $answer = $DefaultAnswer
        }
        switch ($answer.ToUpper()) {
            "S" { return $true }
            "N" { return $false }
            default { Write-WarnMsg "Resposta invalida. Informe S ou N." }
        }
    }
}

function Read-InstallDir {
    while ($true) {
        $baseDir = Read-WithDefault "Informe o diretorio base para instalacao" $PajeBaseDirDefault
        if (Test-Path $baseDir) {
            return $baseDir
        }
        try {
            New-Item -ItemType Directory -Path $baseDir -Force -ErrorAction Stop | Out-Null
            return $baseDir
        } catch {
            Write-WarnMsg "Nao foi possivel criar o diretorio informado. Verifique permissoes e tente novamente."
        }
    }
}

function Build-AuthUrl([string]$RepoUrl, [string]$Username, [string]$Token) {
    if ($RepoUrl -match "^(https?://)(.*)$") {
        return "$($Matches[1])$($Username):$($Token)@$($Matches[2])"
    }
    return $RepoUrl
}

function Invoke-CloneWithOptionalCredentials([string]$RepoUrl, [string]$DestDir) {
    Write-Info "Clonando repositorio (sem credenciais): $RepoUrl"
    git clone $RepoUrl $DestDir
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-WarnMsg "Falha ao clonar sem credenciais. Solicitando credenciais..."
    $username = Read-Host "Informe seu usuario Git"
    $tokenSecure = Read-Host "Informe sua senha/token de acesso (nao sera armazenado)" -AsSecureString
    $token = [System.Net.NetworkCredential]::new("", $tokenSecure).Password

    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($token)) {
        Exit-WithError "Credenciais nao informadas. Encerrando com seguranca."
    }

    $authUrl = Build-AuthUrl $RepoUrl $username $token
    Write-Info "Tentando clonar com credenciais informadas."
    git clone $authUrl $DestDir
    if ($LASTEXITCODE -ne 0) {
        Exit-WithError "Falha ao clonar o repositorio com credenciais."
    }
}

function Confirm-HealthCheck([string]$DestDir) {
    if (-not (Test-Path $DestDir -PathType Container)) {
        Exit-WithError "Pasta do projeto nao foi criada: $DestDir"
    }
    if (-not (Test-Path (Join-Path $DestDir "README.md"))) {
        Exit-WithError "Arquivo essencial nao encontrado: README.md"
    }
    if (-not (Test-Path (Join-Path $DestDir ".git"))) {
        Exit-WithError "Repositorio Git nao parece ter sido clonado corretamente."
    }
    Write-Info "Health check OK."
}

function Confirm-PajeOnPath([string]$DestDir) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -ne $currentPath -and ";$currentPath;".Contains(";$DestDir;")) {
        Write-Info "PATH ja contem o PAJE."
        return
    }
    if (-not (Read-YesNo "Deseja incluir o PAJE no PATH do usuario?" "S")) {
        Write-WarnMsg "PAJE nao foi adicionado ao PATH. Chame o script diretamente: $DestDir\paje.cmd"
        return
    }
    $newPath = if ([string]::IsNullOrWhiteSpace($currentPath)) { $DestDir } else { "$currentPath;$DestDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$DestDir"
    Write-Info "PAJE adicionado ao PATH do usuario ($DestDir). Ja disponivel nesta sessao; novos terminais tambem terao automaticamente."
}

# Registra uma funcao "paje" no $PROFILE do usuario que envolve o binario
# real (paje.cmd) para permitir "cd persistente" ao sair via Ctrl+Q na
# arvore git-sync. paje.cmd sempre roda como processo novo (powershell -File
# paje.ps1) - um Set-Location dentro dele nunca afeta a sessao interativa
# que chamou. So uma funcao do proprio $PROFILE, que roda no processo da
# sessao, consegue. A funcao sombreia o comando "paje" do PATH (resolucao de
# comando do PowerShell prioriza funcoes sobre executaveis externos).
function Confirm-PajeShellFunction([string]$DestDir) {
    $marker = "# PAJE - cd persistente"
    if ((Test-Path $PROFILE) -and (Select-String -Path $PROFILE -Pattern ([regex]::Escape($marker)) -Quiet)) {
        Write-Info "Funcao paje (cd persistente) ja presente em `$PROFILE."
        return
    }

    if (-not (Test-Path $PROFILE)) {
        New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    }

    $pajeCmdPath = Join-Path $DestDir "paje.cmd"
    Add-Content -Path $PROFILE -Value @"
$marker
function paje {
    & "$pajeCmdPath" @args
    `$cdTarget = Join-Path `$env:USERPROFILE ".paje\cd-target"
    if (Test-Path `$cdTarget) {
        `$dir = (Get-Content `$cdTarget -Raw).Trim()
        Remove-Item `$cdTarget -Force
        if (`$dir -and (Test-Path `$dir)) {
            Set-Location `$dir
        }
    }
}
"@
    Write-Info "Funcao paje (cd persistente) adicionada a `$PROFILE."
}

function Confirm-FinalVerification([string]$DestDir) {
    $entrypoint = Join-Path $DestDir "paje.ps1"
    if (-not (Test-Path $entrypoint)) {
        Exit-WithError "Arquivo de inicializacao nao encontrado: $entrypoint"
    }
    # paje.cmd e o shim que permite chamar "paje" sem extensao (cmd.exe e o
    # proprio PowerShell so resolvem nomes nus para .cmd/.bat/.exe no PATH,
    # nunca para .ps1 por seguranca) - sem ele, o comando "paje" nao existe
    # mesmo com o diretorio no PATH.
    $shim = Join-Path $DestDir "paje.cmd"
    if (-not (Test-Path $shim)) {
        Exit-WithError "Shim de linha de comando nao encontrado: $shim"
    }
    Write-Info "Verificacao final OK."
}

function Invoke-Main {
    Write-Info "Iniciando instalacao do PAJE..."
    Confirm-Git

    $repoUrl = Read-WithDefault "Informe a URL do repositorio PAJE" $PajeDefaultRepo
    $baseDir = Read-InstallDir
    $destDir = Join-Path $baseDir $PajeDirDefault

    if (Test-Path $destDir) {
        Write-WarnMsg "Diretorio '$destDir' ja existe. Pulando clonagem."
    } else {
        Invoke-CloneWithOptionalCredentials $repoUrl $destDir
        Confirm-HealthCheck $destDir
        Write-Host ""
        Write-Host "Resumo da instalacao:"
        Write-Host "- Repositorio: $repoUrl"
        Write-Host "- Diretorio:   $destDir"
    }

    Confirm-PajeOnPath $destDir
    Confirm-PajeShellFunction $destDir
    Confirm-FinalVerification $destDir

    if (Read-YesNo "Deseja iniciar o PAJE agora?" "S") {
        Write-Info "Iniciando PAJE..."
        & (Join-Path $destDir "paje.cmd")
    } else {
        Write-Info "Instalacao finalizada. Execute com: paje (se estiver no PATH) ou $destDir\paje.cmd"
    }
}

if ($MyInvocation.InvocationName -ne "." -and $env:PAJE_SKIP_MAIN -ne "1") {
    Invoke-Main
}
