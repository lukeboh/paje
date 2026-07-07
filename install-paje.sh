#!/usr/bin/env bash
# install-page.sh - Instalação e provisionamento inicial do PAJÉ (Linux/Bash)
# Objetivo: preparar o ambiente para execução do PAJÉ com validações e mensagens claras.
# Arquitetura cross-platform: script modular, funções reutilizáveis para facilitar futura versão .bat.

set -Eeuo pipefail

PAJE_DEFAULT_REPO="https://github.com/lukeboh/paje.git"
PAJE_DIR_DEFAULT="paje"
PAJE_BASE_DIR_DEFAULT="${HOME}/git"

# Cores (ANSI) para melhorar transparência no terminal
COLOR_GREEN_BOLD="\033[1;32m"
COLOR_GRAY="\033[0;90m"
COLOR_RESET="\033[0m"

log_info() {
  printf "[INFO] %s\n" "$*"
}

log_warn() {
  printf "[AVISO] %s\n" "$*" >&2
}

log_error() {
  printf "[ERRO] %s\n" "$*" >&2
}

abort() {
  log_error "$*"
  exit 1
}

check_command() {
  command -v "$1" >/dev/null 2>&1
}

install_git() {
  log_warn "Git não encontrado. Iniciando instalação..."
  if check_command apt-get; then
    log_info "Usando apt-get para instalar o Git."
    sudo apt-get update || abort "Falha ao atualizar repositórios via apt-get."
    sudo apt-get install -y git || abort "Falha ao instalar o Git via apt-get."
  elif check_command dnf; then
    log_info "Usando dnf para instalar o Git."
    sudo dnf install -y git || abort "Falha ao instalar o Git via dnf."
  elif check_command yum; then
    log_info "Usando yum para instalar o Git."
    sudo yum install -y git || abort "Falha ao instalar o Git via yum."
  elif check_command zypper; then
    log_info "Usando zypper para instalar o Git."
    sudo zypper install -y git || abort "Falha ao instalar o Git via zypper."
  elif check_command pacman; then
    log_info "Usando pacman para instalar o Git."
    sudo pacman -Sy --noconfirm git || abort "Falha ao instalar o Git via pacman."
  else
    abort "Gerenciador de pacotes não identificado. Instale o Git manualmente e tente novamente."
  fi
}

ensure_git() {
  if ! check_command git; then
    install_git
  else
    log_info "Git encontrado."
  fi
}

ask_repo_url() {
  local repo_url
  printf "Informe a URL do repositório PAJÉ (enter para padrão: %s): " "$PAJE_DEFAULT_REPO" >&2
  read -r repo_url
  if [[ -z "$repo_url" ]]; then
    repo_url="$PAJE_DEFAULT_REPO"
  fi
  printf "%s" "$repo_url"
}

ask_install_dir() {
  local base_dir
  while true; do
    printf "Informe o diretório base para instalação (enter para padrão: %s): " "$PAJE_BASE_DIR_DEFAULT" >&2
    read -r base_dir
    if [[ -z "$base_dir" ]]; then
      base_dir="$PAJE_BASE_DIR_DEFAULT"
    fi
    if [[ -d "$base_dir" ]]; then
      printf "%s" "$base_dir"
      return 0
    fi
    if mkdir -p "$base_dir"; then
      printf "%s" "$base_dir"
      return 0
    fi
    log_warn "Não foi possível criar o diretório informado. Verifique permissões e tente novamente."
  done
}

ask_credentials() {
  local username token
  username="$(select_user_option)"
  printf "Informe sua senha/token de acesso (não será armazenado): "
  read -rs token
  printf "\n"
  # Credenciais mantidas apenas em variáveis de sessão, sem persistência.
  export PAJE_GIT_USER="$username"
  export PAJE_GIT_TOKEN="$token"
}

get_git_local_user() {
  git config --local user.name 2>/dev/null || true
}

get_git_global_user() {
  git config --global user.name 2>/dev/null || true
}

get_logged_user() {
  if check_command whoami; then
    whoami 2>/dev/null || true
  fi
}

select_user_option() {
  local local_user global_user logged_user
  local choice custom_user
  local_user="$(get_git_local_user)"
  global_user="$(get_git_global_user)"
  logged_user="$(get_logged_user)"

  while true; do
    printf "Selecione o usuário (GitHub/GitLab/Corp):\n" >&2
    if [[ -n "$local_user" ]]; then
      printf "  %b[1]%b %s (user.name local do git)\n" "$COLOR_GREEN_BOLD" "$COLOR_RESET" "$local_user" >&2
    else
      printf "  %b[1]%b *NÃO PRESENTE* (user.name local do git)\n" "$COLOR_GRAY" "$COLOR_RESET" >&2
    fi
    if [[ -n "$global_user" ]]; then
      printf "  %b[2]%b %s (user.name global do git)\n" "$COLOR_GREEN_BOLD" "$COLOR_RESET" "$global_user" >&2
    else
      printf "  %b[2]%b *NÃO PRESENTE* (user.name global do git)\n" "$COLOR_GRAY" "$COLOR_RESET" >&2
    fi
    if [[ -n "$logged_user" ]]; then
      printf "  %b[3]%b %s (Usuário logado)\n" "$COLOR_GREEN_BOLD" "$COLOR_RESET" "$logged_user" >&2
    else
      printf "  %b[3]%b *NÃO PRESENTE* (Usuário logado)\n" "$COLOR_GRAY" "$COLOR_RESET" >&2
    fi
    printf "  %b[4]%b Outro: _____________________________\n" "$COLOR_GREEN_BOLD" "$COLOR_RESET" >&2
    printf "Opção: " >&2
    read -r choice

    case "$choice" in
      1)
        if [[ -n "$local_user" ]]; then
          printf "%s" "$local_user"
          return 0
        fi
        log_warn "Opção 1 indisponível. Selecione outra opção válida."
        ;;
      2)
        if [[ -n "$global_user" ]]; then
          printf "%s" "$global_user"
          return 0
        fi
        log_warn "Opção 2 indisponível. Selecione outra opção válida."
        ;;
      3)
        if [[ -n "$logged_user" ]]; then
          printf "%s" "$logged_user"
          return 0
        fi
        log_warn "Opção 3 indisponível. Selecione outra opção válida."
        ;;
      4)
        printf "Informe o usuário desejado: " >&2
        read -r custom_user
        if [[ -n "$custom_user" ]]; then
          printf "%s" "$custom_user"
          return 0
        fi
        log_warn "Usuário não informado. Selecione outra opção válida."
        ;;
      *)
        log_warn "Opção inválida. Informe 1, 2, 3 ou 4."
        ;;
    esac
  done
}

safe_clone() {
  local repo_url="$1"
  local dest_dir="$2"
  if [[ -d "$dest_dir" ]]; then
    abort "Diretório '$dest_dir' já existe. Remova ou escolha outro destino."
  fi
  log_info "Clonando repositório: $repo_url"
  git clone "$repo_url" "$dest_dir" || abort "Falha ao clonar o repositório. Verifique a URL e credenciais."
}

health_check() {
  local dest_dir="$1"
  [[ -d "$dest_dir" ]] || abort "Pasta do projeto não foi criada: $dest_dir"
  [[ -f "$dest_dir/README.md" ]] || abort "Arquivo essencial não encontrado: README.md"
  [[ -d "$dest_dir/.git" ]] || abort "Repositório Git não parece ter sido clonado corretamente."
  log_info "Health check OK."
}

final_verification() {
  local dest_dir="$1"
  local -a binaries=("paje" "paje.sh" "install-page.sh")
  local binary

  for binary in "${binaries[@]}"; do
    local binary_path="$dest_dir/$binary"
    [[ -f "$binary_path" || -L "$binary_path" ]] || abort "Binário esperado não encontrado: $binary_path"
    [[ -x "$binary_path" ]] || abort "Permissão de execução ausente para: $binary_path"
  done

  case ":$PATH:" in
    *":$dest_dir:"*)
      ;; 
    *)
      abort "Diretório $dest_dir não está no PATH. Adicione com: export PATH=\"$dest_dir:\$PATH\""
      ;;
  esac

  for binary in "${binaries[@]}"; do
    if ! command -v "$binary" >/dev/null 2>&1; then
      abort "Binário $binary não encontrado no PATH após validação."
    fi
  done

  log_info "Verificação final OK. Binários no PATH e permissões corretas."
}

ensure_cli_symlink() {
  local dest_dir="$1"
  local target="$dest_dir/paje.sh"
  local link="$dest_dir/paje"

  [[ -f "$target" ]] || abort "Arquivo de inicialização não encontrado: $target"
  chmod +x "$target" || abort "Falha ao aplicar permissão de execução em $target"

  if [[ -L "$link" || -f "$link" ]]; then
    return 0
  fi

  ln -s "paje.sh" "$link" || abort "Falha ao criar link simbólico para $link"
  chmod +x "$link" || abort "Falha ao aplicar permissão de execução em $link"
}

detect_shell_rc() {
  local shell_name
  shell_name="${SHELL##*/}"
  case "$shell_name" in
    bash)
      printf "%s" "$HOME/.bashrc"
      ;;
    zsh)
      printf "%s" "$HOME/.zshrc"
      ;;
    *)
      printf "%s" "$HOME/.profile"
      ;;
  esac
}

ensure_paje_on_path() {
  local dest_dir="$1"

  case ":$PATH:" in
    *":$dest_dir:"*)
      return 0
      ;;
  esac

  if ! ask_yes_no "Deseja incluir o PAJÉ no PATH? (S/N) [padrão: S] " "S"; then
    log_warn "PAJÉ não foi adicionado ao PATH. A validação final pode falhar."
    return 0
  fi

  local rc_file
  rc_file="$(detect_shell_rc)"
  local export_line
  export_line="export PATH=\"$dest_dir:\$PATH\""

  if [[ -f "$rc_file" ]] && grep -Fxq "$export_line" "$rc_file"; then
    log_info "PATH já contém o PAJÉ em $rc_file."
  else
    log_info "Adicionando PAJÉ ao PATH em $rc_file"
    {
      printf "\n# PAJÉ - PATH\n"
      printf "%s\n" "$export_line"
    } >>"$rc_file" || abort "Falha ao atualizar $rc_file"
  fi

  export PATH="$dest_dir:$PATH"
  if [[ -f "$rc_file" ]]; then
    # shellcheck disable=SC1090
    source "$rc_file" || log_warn "Não foi possível aplicar o source em $rc_file."
  fi

  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    if ask_yes_no "Deseja recarregar o shell agora? (S/N) [padrão: N] " "N"; then
      log_info "Recarregando o shell para aplicar o PATH..."
      exec "${SHELL:-/bin/bash}" -l
    fi
    log_warn "Para aplicar no terminal atual, execute: source $rc_file"
    log_warn "Alternativa: feche e reabra o terminal para recarregar o PATH."
  fi
}

summary() {
  local repo_url="$1"
  local dest_dir="$2"
  printf "\nResumo da instalação:\n"
  printf "%s\n" "- Repositório: $repo_url"
  printf "%s\n" "- Diretório:   $dest_dir"
}

ask_yes_no() {
  local prompt="$1"
  local default_answer="$2"
  local answer
  while true; do
    printf "%s" "$prompt" >&2
    read -r answer
    if [[ -z "$answer" ]]; then
      answer="$default_answer"
    fi
    case "$answer" in
      S|s)
        return 0
        ;;
      N|n)
        return 1
        ;;
      *)
        log_warn "Resposta inválida. Informe S ou N."
        ;;
    esac
  done
}

build_auth_url() {
  local repo_url="$1"
  local username="$2"
  local token="$3"

  if [[ "$repo_url" =~ ^https?:// ]]; then
    # Inserir credenciais no URL apenas para HTTPS.
    printf "%s" "${repo_url/\/\//\/\/${username}:${token}@}"
    return 0
  fi

  printf "%s" "$repo_url"
}

clone_with_optional_credentials() {
  local repo_url="$1"
  local dest_dir="$2"

  log_info "Clonando repositório (sem credenciais): $repo_url"
  if git clone "$repo_url" "$dest_dir"; then
    return 0
  fi

  log_warn "Falha ao clonar sem credenciais. Solicitando credenciais..."
  ask_credentials

  if [[ -z "${PAJE_GIT_USER:-}" || -z "${PAJE_GIT_TOKEN:-}" ]]; then
    abort "Credenciais não informadas. Encerrando com segurança."
  fi

  local auth_url
  auth_url="$(build_auth_url "$repo_url" "$PAJE_GIT_USER" "$PAJE_GIT_TOKEN")"
  log_info "Tentando clonar com credenciais informadas."
  git clone "$auth_url" "$dest_dir" || abort "Falha ao clonar o repositório com credenciais."
}

main() {
  log_info "Iniciando instalação do PAJÉ..."
  ensure_git

  local repo_url
  repo_url="$(ask_repo_url)"

  local base_dir
  base_dir="$(ask_install_dir)"

  local dest_dir="${base_dir}/${PAJE_DIR_DEFAULT}"
  if [[ -d "$dest_dir" ]]; then
    log_warn "Diretório '$dest_dir' já existe. Pulando clonagem."
  else
    clone_with_optional_credentials "$repo_url" "$dest_dir"
    health_check "$dest_dir"
    summary "$repo_url" "$dest_dir"
  fi

  ensure_cli_symlink "$dest_dir"
  ensure_paje_on_path "$dest_dir"
  final_verification "$dest_dir"

  if ask_yes_no "Deseja iniciar o PAJÉ agora? (S/N) [padrão: S] " "S"; then
    log_info "Iniciando PAJÉ..."
    if [[ -f "$dest_dir/paje.sh" ]]; then
      bash "$dest_dir/paje.sh" || abort "Falha ao iniciar o PAJÉ."
    else
      abort "Arquivo de inicialização não encontrado: $dest_dir/paje.sh"
    fi
  else
    if ask_yes_no "Deseja excluir o diretório '$dest_dir'? (S/N) [padrão: N] " "N"; then
      rm -rf "$dest_dir" || abort "Falha ao remover o diretório '$dest_dir'."
      log_info "Diretório removido com sucesso."
      if ask_yes_no "Deseja reiniciar o processo de instalação? (S/N) [padrão: N] " "N"; then
        main "$@"
        return 0
      fi
    fi
    log_info "Instalação finalizada."
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" && "${PAJE_SKIP_MAIN:-}" != "1" ]]; then
  main "$@"
fi
