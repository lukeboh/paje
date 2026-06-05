# PAJÉ — Plataforma de Apoio à Jornada do Engenheiro

O PAJÉ automatiza tarefas repetitivas de ambiente de desenvolvimento, com foco inicial em GitLab: sincronização paralela de repositórios, gerenciamento de chaves SSH e tokens pessoais de acesso.

## Características

- **CLI + TUI**: execução por comando (`paje <comando>`) e interface textual guiada ao iniciar sem parâmetros.
- **Sincronização paralela de repositórios GitLab**: seleção de grupos/projetos, clone/pull em paralelo, resumo de status.
- **Multi-servidor**: múltiplos servidores GitLab simultâneos, cada um com suas próprias configurações (diretório, filtros, e-mail).
- **Gerenciamento de SSH e tokens**: geração ou reaproveitamento de chaves, atualização de `~/.ssh/config`, `known_hosts`, criação e rotação de PAT.
- **Persistência local**: servidores e tokens em `~/.paje/git-servers.json`; logs em `~/.paje/logs`.
- **Configuração por arquivo**: parâmetros em `~/.paje/env.yaml` (ou `--env-file`), com prioridade sobre padrões embutidos.

## Requisitos

- Linux com Bash (WSL suportado — `paje.sh` filtra o PATH do Windows automaticamente)
- Git
- Node.js 24.x (Active LTS) + npm

## Instalação

```bash
curl -fsSL https://raw.githubusercontent.com/lukeboh/paje/main/install-page.sh -o install-page.sh \
  && chmod +x install-page.sh && ./install-page.sh
```

O instalador verifica o Git, clona o repositório, executa health-check, cria o link `paje` e opcionalmente adiciona ao `PATH`.

Para garantir Node.js 24.x correto:

```bash
./config-paje.sh
```

## Como executar

```bash
paje                          # TUI interativa (menu de funcionalidades)
paje git-sync [opções]        # CLI — sincronizar repositórios
paje git-server-store [opções]# CLI — registrar servidor, SSH e token
npm run dev -- <comando>      # execução de desenvolvimento
```

---

## Funcionalidades

### `git-sync` — sincronizar repositórios GitLab

Carrega a árvore de grupos/projetos de todos os servidores configurados, exibe na TUI para seleção e sincroniza em paralelo.

**Parâmetros principais:**

| Flag CLI | Chave env | Padrão | Descrição |
|---|---|---|---|
| `--base-dir <dir>` | `baseDir` | `repos` | Diretório base de clonagem |
| `--server-name <name>` | `serverName` | `""` | Filtrar por nome de servidor |
| `--base-url <url>` | `baseUrl` | `""` | Filtrar por URL de servidor |
| `--use-basic-auth` | `useBasicAuth` | `false` | HTTPS + PAT em vez de SSH |
| `--username <u>` | `username` | `""` | Usuário para auth básica |
| `--user-email <e>` | `userEmail` | `""` | E-mail Git nos repos clonados |
| `--no-public-repos` | `noPublicRepos` | `false` | Ocultar repos públicos |
| `--no-archived-repos` | `noArchivedRepos` | `false` | Ocultar repos arquivados |
| `--filter <padrão>` | `filter` | `""` | Filtro Ant/Glob de `path_with_namespace` (`;` separa múltiplos) |
| `--sync-repos <lista>` | `syncRepos` | `""` | Repos/branches a sincronizar (`grupo/repo#branch;...`) |
| `--parallels <n>` | `parallels` | `auto` | Paralelismo (`AUTO` \| `0` \| `1..N`) |
| `--dry-run` | `dryRun` | `false` | Simular sem persistir |
| `--prepare-local-dirs` | `prepareLocalDirs` | `false` | Criar estrutura de diretórios sem clonar |
| `--no-summary` | `noSummary` | `false` | Ocultar resumo final |
| `--verbose` | `verbose` | `false` | Logs detalhados |
| `--env-file <path>` | — | `~/.paje/env.yaml` | Arquivo de ambiente |

**Comportamento relevante:**

- Opera sobre todos os servidores configurados quando nenhum filtro de servidor é fornecido.
- A TUI pré-seleciona repositórios com clone local (`[x]`); grupos propagam seleção parcial (`[~]`).
- Grupos com o mesmo `full_path` em servidores diferentes são consolidados em um único nó.
- Em colisão de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório recebe sufixo `-<Servidor>`.
- Filtros Ant/Glob suportam `?`, `*`, `**`; múltiplos padrões separados por `;`.
- O log usa `LoggerBroker` com transports para console (`info`), painel TUI (`warn`) e arquivo `~/.paje/logs` (`debug`).

---

### `git-server-store` — registrar servidor, SSH e token

Registra um servidor GitLab, gera ou reutiliza chave SSH, configura `~/.ssh/config` e cria/rotaciona PAT.

**Parâmetros principais:**

| Flag CLI | Chave env | Padrão | Descrição |
|---|---|---|---|
| `--base-url <url>` | `baseUrl` | `""` | URL base do GitLab |
| `--server-name <name>` | `serverName` | `GitLab` | Nome do servidor |
| `--username <u>` | `username` | `""` | Usuário do GitLab |
| `--use-basic-auth` | `useBasicAuth` | `false` | Usar HTTPS + PAT (sem SSH) |
| `--token-name <name>` | `tokenName` | `""` | Nome do PAT no GitLab |
| `--token-scopes <escopos>` | `tokenScopes` | `read_repository,read_api,…` | Escopos do PAT |
| `--token-expires-at <data>` | `tokenExpiresAt` | `""` | Expiração do PAT (`YYYY-MM-DD`) |
| `--key-label <name>` | `keyLabel` | `""` | Nome da chave SSH |
| `--public-key-path <path>` | `publicKeyPath` | `""` | Reutilizar chave pública existente |
| `--key-overwrite` | `keyOverwrite` | `false` | Sobrescrever chave existente |
| `--base-dir <dir>` | `baseDir` | `""` | Diretório base salvo neste servidor |
| `--user-email <e>` | `userEmail` | `""` | E-mail Git salvo neste servidor |
| `--filter <padrão>` | `filter` | `""` | Filtro Ant/Glob salvo neste servidor |
| `--env-file <path>` | — | `~/.paje/env.yaml` | Arquivo de credenciais |

**Fluxo SSH (padrão, `--use-basic-auth` ausente):**

1. Sonda TCP na porta 22 do servidor (timeout 3 s).
2. Se porta 22 bloqueada: exibe guia passo a passo para geração de PAT no GitLab (e futuramente GitHub) e encerra — reexecutar com `--use-basic-auth`.
3. Gera ou reutiliza par de chaves ed25519.
4. Atualiza `~/.ssh/config` e `~/.ssh/known_hosts`.
5. Registra a chave pública no GitLab e cria/rotaciona PAT.
6. Persiste o servidor e token em `~/.paje/git-servers.json`.

**Fluxo HTTPS + PAT (`--use-basic-auth`):**

1. Valida token existente salvo (se houver) e reutiliza se válido.
2. Se inválido, rotaciona automaticamente.
3. Se não houver token, solicita usuário/senha ou lê do arquivo de ambiente, cria novo PAT e persiste.
4. As operações `git clone/pull/push` passam a usar URL HTTPS com `oauth2:<token>@host` embutido.

---

## Propriedades por servidor (`~/.paje/git-servers.json`)

Cada servidor registrado armazena suas próprias propriedades. Durante o `git-sync`, essas propriedades têm **prioridade** sobre os parâmetros de sessão (CLI/env):

| Propriedade | Descrição |
|---|---|
| `baseDir` | Diretório base de clone exclusivo deste servidor |
| `userEmail` | E-mail Git aplicado aos repos deste servidor |
| `filter` | Filtro Ant/Glob aplicado antes da mesclagem multi-servidor |
| `noPublicRepos` | Ocultar repos públicos deste servidor |
| `noArchivedRepos` | Ocultar repos arquivados deste servidor |
| `syncRepos` | Repos/branches a sincronizar deste servidor |
| `token` | PAT salvo — único segredo persistido em disco |

**Ordem de prioridade para resolução de parâmetros:**

```
Propriedade do servidor (git-servers.json)
  > Argumento CLI (--flag)
    > Arquivo de ambiente (env.yaml)
      > Padrão embutido
```

Veja tabela completa em [`docs/arquitetura.md`](docs/arquitetura.md) — seções *Parâmetros* e *Propriedades por servidor*.

---

## Configuração por arquivo (`env.yaml`)

O PAJÉ lê parâmetros de `~/.paje/env.yaml` por padrão, ou do caminho informado em `--env-file`.

```yaml
# ~/.paje/env.yaml — exemplo completo
baseDir: ~/repos
serverName: GitLab
baseUrl: https://gitlab.com
useBasicAuth: false
username: meu.usuario
userEmail: nome@empresa.com
keyLabel: paje
passphrase: ""
publicKeyPath: ""
noPublicRepos: false
noArchivedRepos: false
filter: ""
syncRepos: "grupo/projeto#main;grupo/outro"
parallels: "auto"
dryRun: false
tokenName: paje-token
tokenScopes: [read_repository, read_api, read_virtual_registry, self_rotate]
tokenExpiresAt: "2027-01-01"
verbose: false
```

> Senhas e tokens não devem ser versionados. Use arquivos locais com permissões restritas (`chmod 600`).

---

## Interface TUI

A TUI é composta por quatro quadros:

1. **Barra de título** — 1 linha no topo com o nome da funcionalidade.
2. **Área de trabalho** — menus, formulários e árvore de repositórios.
3. **Barra de orientação** — 1 linha com atalhos contextuais.
4. **Painel de log** — ~15% da tela, com timestamp por linha, erros em vermelho e auto-scroll.

Layout detalhado em [`docs/TUI-leiaute.md`](docs/TUI-leiaute.md).

### Atalhos globais

| Atalho | Ação |
|---|---|
| `Ctrl+H` | Abrir/fechar modal de ajuda (atalhos) |
| `Ctrl+P` | Abrir/fechar modal de parâmetros carregados |
| `Ctrl+W` | Alternar área de trabalho entre padrão e tela cheia |
| `Ctrl+L` | Alternar painel de log entre padrão e tela cheia |
| `Esc` | Fechar modal → restaurar painel maximizado → voltar tela → sair (no menu) |
| `Ctrl+C` | Encerrar a aplicação |

### Atalhos do menu

| Atalho | Ação |
|---|---|
| `Ctrl+S` | Selecionar git-sync |
| `Ctrl+G` | Selecionar git-server-store |
| `Enter` | Confirmar seleção |
| `↑ ↓ ← →` | Navegar entre cartões |

### Atalhos da árvore git-sync

| Atalho | Ação |
|---|---|
| `↑ ↓` / `PgUp PgDn` | Navegar |
| `Space` | Selecionar/deselecionar repositório |
| `Ctrl+S` | Sincronizar todos os marcados |
| `Enter` | Sincronizar apenas o escopo destacado (linha/grupo) |
| `Ctrl+M` | Alternar filtro: todos / apenas selecionados |
| `Ctrl+B` | Abrir modal de seleção de branch |
| `Esc` | Cancelar |

---

## Testes

```bash
npm run build   # compilação TypeScript — deve terminar sem erros
npm test        # suite completa
```

Falhas pré-existentes (infraestrutura do container, não código):
- `git_branch_service_test` — servidor de assinatura git retorna 400.
- `ssh_key_store_command_test` — segunda etapa requer `ssh-keygen` ausente no container.

---

## Documentação técnica

| Documento | Conteúdo |
|---|---|
| [`docs/arquitetura.md`](docs/arquitetura.md) | Separação de camadas, tabela de parâmetros, propriedades de servidor, ordem de prioridade |
| [`docs/TUI-leiaute.md`](docs/TUI-leiaute.md) | Layout obrigatório da TUI, atalhos e componentes |
| [`docs/requisitos-tui-git-sync.md`](docs/requisitos-tui-git-sync.md) | Requisitos funcionais e de usabilidade da TUI git-sync |
| [`docs/bugs-conhecidos.md`](docs/bugs-conhecidos.md) | Bugs conhecidos com status e workaround |
| [`docs/auditoria-codigo.md`](docs/auditoria-codigo.md) | Bugs, inconsistências e débitos técnicos identificados |
| [`docs/auditoria-arquitetura.md`](docs/auditoria-arquitetura.md) | Histórico de problemas arquiteturais e status de resolução |
| [`CLAUDE.md`](CLAUDE.md) | Regras obrigatórias para agentes (arquitetura, testes, i18n, commits) |
