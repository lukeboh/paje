#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Precisa ser capturado ANTES do "cd $ROOT_DIR" abaixo — dali em diante o
# diretório de trabalho do processo é o de instalação do PAJÉ, não mais o
# de onde o usuário chamou "paje". gitCommand.ts usa isso pra posicionar o
# cursor da árvore no repositório correspondente ao diretório de origem.
export PAJE_INVOKED_FROM="$PWD"

if [[ ! -f "$ROOT_DIR/package.json" ]]; then
  echo "[ERRO] package.json nao encontrado. Execute o PAJE a partir do diretorio raiz."
  exit 1
fi

cd "$ROOT_DIR"

if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  export PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | tr '\n' ':' | sed 's/:$//')"
  if ! command -v npm >/dev/null 2>&1; then
    echo "[ERRO] WSL detectado mas npm nao encontrado na distro Linux."
    echo "[ERRO] Instale o Node.js diretamente no Linux, por exemplo via:"
    echo "         curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "         sudo apt-get install -y nodejs"
    echo "       ou via nvm: https://github.com/nvm-sh/nvm"
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "[ERRO] WSL detectado mas node nao encontrado na distro Linux."
    echo "[ERRO] Instale o Node.js diretamente no Linux (veja instrucoes acima)."
    exit 1
  fi
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "[INFO] Instalando dependencias..."
  npm install
fi

echo "[INFO] Executando PAJE..."
npm run dev -- "$@"
