# PAJÉ - Plataforma de Apoio à Jornada do Engenheiro

O PAJÉ é um facilitador de ambiente de desenvolvimento. Ele automatiza tarefas repetitivas e configura integrações de forma harmonizada para o desenvolvedor, com foco inicial em GitLab (CLI/TUI) e organização local de repositórios.

## Características do sistema

- **CLI + TUI**: execução por comando (`paje`) e interface textual guiada ao iniciar sem parâmetros.
- **Sincronização paralela de repositórios GitLab**: seleção de grupos/projetos, clonagem/pull em paralelo e resumo de status.
- **Gerenciamento de SSH**: geração ou reaproveitamento de chaves, atualização do `~/.ssh/config`, adição em `known_hosts`.
- **Persistência local**: informações de servidores GitLab e logs são salvos em `~/.paje`.
- **Configuração por arquivo**: parâmetros podem ser definidos via arquivo de ambiente (`~/.paje/env.yaml` por padrão).

## Requisitos

- Linux com Bash
- Git (o instalador tenta instalar caso não esteja disponível)
- Node.js 24.x (Active LTS recomendado) e npm (para execução do PAJÉ)

## Instalação e provisionamento inicial

Execute o instalador em uma única linha (Linux/Bash):

```bash
curl -fsSL https://raw.githubusercontent.com/lukeboh/paje/main/install-paje.sh -o install-paje.sh && chmod +x install-paje.sh && ./install-paje.sh
```

O instalador:

1. Verifica Git e instala se necessário.
2. Clona o repositório do PAJÉ.
3. Executa health-check.
4. Cria link `paje` apontando para `paje.sh`.
5. (Opcional) adiciona o diretório ao `PATH`.
6. (Opcional) inicia o PAJÉ ao final.

## Configuração do runtime JavaScript

Para garantir Node.js e npm corretos:

```bash
./config-paje.sh
```

O script garante Node.js 24.x (Active LTS) e valida a instalação.

## Como executar

### Execução interativa (TUI)

Sem parâmetros, o PAJÉ abre o menu TUI (dashboard com cartões e atalhos S/G):

```bash
paje
```

> Observação: o `paje.sh` ajusta o diretório de trabalho apenas dentro do próprio processo para localizar o `package.json`. Isso não altera o diretório do seu terminal e permite chamar o comando de qualquer local.

### Execução via CLI

```bash
paje git-sync [opções]
paje git-server-store [opções]
```

### Execução via npm (dev)

```bash
npm run dev -- <comando>
```

## Funcionalidades disponíveis

### 0) Help/Shortcuts — atalhos da TUI

Tabela com os atalhos disponíveis por contexto. A modal é aberta com **H** e permite executar o atalho selecionado diretamente.

**Documentação detalhada:** [`docs/funcionalidades/help-shortcuts.md`](docs/funcionalidades/help-shortcuts.md:1).

### 1) `git-sync` — sincronizar repositórios GitLab

Sincroniza repositórios em paralelo, agregando todos os servidores configurados (um único `base-dir` local) e exibindo a árvore consolidada na TUI.

**Documentação detalhada:** [`docs/funcionalidades/git-sync.md`](docs/funcionalidades/git-sync.md:1).

**Parâmetros principais:**

| Parâmetro | Obrigatório | Padrão | Descrição | Valores/Observações |
| --- | --- | --- | --- | --- |
| `-v`, `--verbose` | não | `false` | Exibe logs detalhados | `true`/`false` |
| `--base-dir <dir>` | não | `repos` | Diretório base de clonagem | caminho local (aceita `~`) |
| `--server-name <name>` | não | — | Nome do servidor GitLab | filtro por nome |
| `--base-url <url>` | não | — | URL base do GitLab | filtro por URL |
| `--use-basic-auth` | não | `false` | Usar autenticação básica | requer `--username` |
| `--username <username>` | condicional | — | Usuário para auth básica | obrigatório se `--use-basic-auth` |
| `--password <password>` | condicional | — | Senha para auth básica | solicitado se necessário |
| `--env-file <path>` | não | `~/.paje/env.yaml` | Caminho do arquivo de ambiente | YAML |

**Comportamento relevante:**

- O `git-sync` opera sobre todos os servidores configurados quando nenhum filtro é fornecido.
- A TUI pré-seleciona repositórios que já possuem clone local (checkbox `[x]`) e propaga seleção parcial para grupos.
- O atalho `C` alterna a visualização para mostrar apenas repositórios marcados na árvore.
- O resumo final mostra estados: `SYNCED`, `BEHIND`, `AHEAD`, `REMOTE`, `EMPTY`, `LOCAL`, `UNCOMMITTED`.
- Grupos com o mesmo `full_path` em servidores diferentes são consolidados no mesmo nó da árvore.
- Em colisões de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório local recebe sufixo `-<Servidor>`.
- Os filtros suportam padrões Ant/Glob: `?`, `*`, `**` e múltiplos padrões separados por `;`.
- O log é centralizado no LoggerBroker, com transports para console, painel TUI e arquivo em `~/.paje/logs`.
- Níveis padrão: console `info`, painel `warn`, arquivo `debug`.
- Mensagens de seleção do menu TUI e filtros de árvore são `[DEBUG]` e só aparecem com `--verbose`.

### 2) `git-server-store` — registrar SSH e token no GitLab

Gera (ou reutiliza) chave SSH, registra no GitLab e cria/rotaciona token pessoal.

**Documentação detalhada:** [`docs/funcionalidades/git-server-store.md`](docs/funcionalidades/git-server-store.md:1).

**Parâmetros principais:**

| Parâmetro | Obrigatório | Padrão | Descrição | Valores/Observações |
| --- | --- | --- | --- | --- |
| `--server-name <name>` | não | `GitLab` | Nome do servidor | ? |
| `--base-url <url>` | sim | — | URL base do GitLab | ? |
| `--username <username>` | sim | — | Usuário do GitLab | obrigatório |
| `--token-name <name>` | sim | — | Nome do token pessoal | obrigatório |
| `--env-file <path>` | não | `~/.paje/env.yaml` | Caminho do arquivo de credenciais | YAML |

## Configuração por arquivo (env.yaml)

O PAJÉ lê parâmetros de `~/.paje/env.yaml` (padrão), ou de um arquivo informado via `--env-file`.

**Exemplo de `~/.paje/env.yaml`:**

```yaml
baseDir: ~/repos
serverName: GitLab
baseUrl: https://gitlab.com
useBasicAuth: false
username: meu.usuario
password: "**********"
userEmail: "nome@empresa.com"
keyLabel: paje
passphrase: ""
publicKeyPath: /home/user/.ssh/paje.pub
prepareLocalDirs: false
noSummary: false
noPublicRepos: false
noArchivedRepos: false
syncRepos: "grupo/projeto.git#main;grupo/outro-projeto"
parallels: "1"
dryRun: false
tokenName: paje-token
tokenScopes: [read_repository, read_api, read_virtual_registry, self_rotate]
tokenExpiresAt: 2026-04-30
retryDelayMs: 4000
maxAttempts: 3
verbose: false
```

> Senhas e tokens não devem ser versionados. Use arquivos locais com permissões restritas.

## Persistência de dados

O PAJÉ salva dados locais em:

- `~/.paje/logs` — logs de execução.
- `~/.paje/git-servers.json` — servidores GitLab e tokens.

## Interface TUI

A TUI segue o padrão de quatro quadros:

> Observação: o renderer em Ink foi otimizado para minimizar redesenhos completos em terminais remotos (SSH), usando memoização de componentes e cálculo de layout estável para reduzir flicker perceptível.

1. **Barra de título**: 1 linha no topo com o nome da funcionalidade.
2. **Área de trabalho**: região central com menus, formulários e árvore de repositórios.
3. **Barra de orientações** (1 linha) com comandos possíveis.
4. **Painel de log**: ~15% da tela na parte inferior, com timestamp por linha e erros em vermelho.

Atalho `F12` alterna o log em tela cheia e retorna ao layout padrão. `H` abre a modal de ajuda (shortcuts). `P` abre/fecha a modal de parâmetros carregados. `B` abre a modal de seleção de branch para o repositório selecionado na árvore. `S` confirma a seleção e sincroniza todos os repositórios marcados; `Ctrl+S` confirma a seleção e sincroniza apenas o escopo destacado (linha/grupo). `Esc` retorna à tela anterior ou fecha a modal e `Ctrl+C` encerra a aplicação. Ao iniciar `git-sync` pelo menu, um spinner central "Carregando repositórios..." é exibido enquanto o PAJÉ consulta os servidores, com logs em tempo real no painel inferior.

Consulte o layout detalhado em [`docs/TUI-leiaute.md`](docs/TUI-leiaute.md:1).

## Arquitetura

Visão geral do código em [`docs/arquitetura.md`](docs/arquitetura.md:1).

## Bugs conhecidos

Lista de problemas conhecidos em [`docs/bugs-conhecidos.md`](docs/bugs-conhecidos.md:1).

## Testes

```bash
npm test
```

## Regras do projeto (leitura obrigatória)

Este repositório usa o arquivo [`.roo/rules-code/paje-core.md`](.roo/rules-code/paje-core.md:1) como fonte oficial de regras e contexto.
