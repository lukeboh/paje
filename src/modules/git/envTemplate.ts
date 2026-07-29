// Conteúdo do modelo de configuração (`env-template.yaml`, raiz do
// repositório) embutido como constante. Necessário porque o núcleo do
// PAJÉ roda em contextos onde o caminho do arquivo na raiz do repositório
// não é resolvível de forma confiável (bundle da extensão VSCode via
// esbuild, execução via `tsx` fora do diretório do projeto) — embutir o
// texto garante que a criação do env.yaml na primeira execução funcione
// em qualquer camada de apresentação (CLI, TUI, extensão VSCode).
//
// Mantido em sincronia com `env-template.yaml` por teste automatizado
// (tests/env_yaml_write_test.ts) que compara os dois byte a byte.
export const ENV_TEMPLATE_CONTENT = `# Parâmetros do PAJÉ (git-sync e git-server-store)
# CLI sempre tem prioridade. Quando ausente, usa este arquivo.
# Se continuar ausente e obrigatório, o PAJÉ perguntará interativamente.
#
# Este arquivo é criado automaticamente na primeira execução do PAJÉ, em
# ~/.paje/env.yaml, a partir deste modelo. Atualizações feitas pela TUI
# (Ctrl+E) ou por comandos preservam os comentários e a ordem existentes.
#
# Tokens de acesso pessoal (GitLab/GitHub) NÃO ficam neste arquivo — são
# armazenados em ~/.paje/git-servers.json após o registro do servidor. A
# senha do GitLab/GitHub também NÃO pode ser configurada aqui — ela só é
# pedida interativamente, uma única vez, para gerar um token ou chave SSH
# novos, e nunca é persistida em lugar nenhum (use --password para informá-la
# de forma não interativa, sem gravá-la em arquivo).

# --- Parâmetros comuns ---
# Idioma da interface (opcional; pt_BR ou en_US; default: pt_BR)
locale: ""
# Usuário do GitLab para autenticação básica (obrigatório para git-server-store; opcional para git-sync)
username: ""
# Email do Git para configurar nos repositórios clonados (opcional; usado no git-sync)
user-email: ""
# Nome amigável do servidor (opcional; default: GitLab)
server-name: ""
# URL base do servidor GitLab ou GitHub (opcional; default: https://gitlab.com)
base-url: ""

# --- Parâmetros do git-sync ---
# Diretório base para clonagem (opcional; default: repos)
base-dir: "repos"
# Usar autenticação básica (opcional; default: false)
use-basic-auth: false
# Exibir logs detalhados (opcional; default: false)
verbose: false
# Nome da chave SSH a ser gerada (opcional; default: paje)
key-label: "paje"
# Passphrase da chave SSH (opcional)
passphrase: ""
# Caminho para chave pública existente (.pub) (opcional)
public-key-path: ""
# Criar diretórios locais sem clonar repositórios (opcional; default: false)
prepare-local-dirs: false
# Ocultar resumo final (opcional; default: false)
no-summary: false
# Ocultar repositórios públicos (opcional; default: false)
no-public-repos: false
# Ocultar repositórios arquivados (opcional; default: false)
no-archived-repos: false
# Filtro Ant/Glob por caminho (path_with_namespace) (opcional; separado por ;)
filter: ""
# Repos/branchs para sincronizar (opcional; separado por ;) (default: vazio)
# Exemplo: "grupo/projeto.git#main;grupo/outro-projeto"
sync-repos: ""
# Número de processos/threads para sincronização (AUTO|0|1..N) (opcional; default: auto)
parallels: "auto"
# Simular operações sem persistir (opcional; default: false)
dry-run: false

# --- Parâmetros do git-server-store ---
# Sobrescrever chave existente, salvando .bak (opcional; default: false)
key-overwrite: false
# Intervalo de retry em ms (opcional; default: 4000)
retry-delay-ms: 4000
# Número máximo de tentativas (opcional; default: 1)
max-attempts: 1
# Nome do token pessoal no GitLab (obrigatório)
token-name: ""
# Escopos do token pessoal (opcional; default: [read_repository, read_api, read_virtual_registry, self_rotate])
token-scopes: ["read_repository", "read_api", "read_virtual_registry", "self_rotate"]
# Data de expiração do token (YYYY-MM-DD) (opcional)
token-expires-at: ""
`;
