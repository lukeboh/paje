# Arquitetura do PAJÉ

## Visão geral

O PAJÉ é uma plataforma CLI/TUI escrita em TypeScript (Node.js) que automatiza tarefas
de ambiente para engenharia, com integrações GitLab (gitlab.com e self-hosted) e
GitHub (github.com e GitHub Enterprise Server).

---

## Separação de camadas — REGRA FUNDAMENTAL

O projeto é organizado em três camadas. **Esta separação deve ser respeitada em toda
evolução.** Violá-la é o erro arquitetural mais caro de manter — ver
`auditoria-arquitetura.md` para evidências concretas.

```
┌─────────────────────────────────────────────────┐
│  Camada de Apresentação                         │
│  CLI  →  gitCommand.ts  (Commander / formatação)│
│  TUI  →  tui.app.tsx, tuiSession.tsx (Ink/React)│
│  VSCode → vscode-extension/ (TreeView/comandos) │
└───────────────────┬─────────────────────────────┘
                    │ chama apenas
┌───────────────────▼─────────────────────────────┐
│  Core  (src/modules/git/core/)                  │
│  Toda lógica de negócio vive aqui               │
│  gitSyncService.ts — ponto de entrada principal │
│  gitSyncConfig.ts  — resolução de parâmetros    │
│  gitBranchService.ts, loggerBroker.ts, etc.     │
└───────────────────┬─────────────────────────────┘
                    │ chama apenas
┌───────────────────▼─────────────────────────────┐
│  Infraestrutura                                 │
│  gitlabApi.ts, githubApi.ts, parallelSync.ts    │
│  persistence.ts, gitRepoScanner.ts,             │
│  sshManager.ts, treeBuilder.ts, logger.ts       │
└─────────────────────────────────────────────────┘
```

### Responsabilidades por camada

**Apresentação (CLI e TUI)**
- Ler parâmetros do usuário e convertê-los em `GitSyncConfig` via `resolveGitSyncConfig()`.
- Chamar métodos do core (`createGitSyncCore()`).
- Formatar e exibir resultados (texto, árvore Ink, modal de resumo).
- Fornecer callbacks de progresso e log ao core.

**Core (`src/modules/git/core/`)**
- Toda lógica de negócio: filtrar projetos, resolver conflitos de path, preparar alvos,
  orquestrar sincronização, calcular sumário, gerenciar SSH/autenticação.
- Agnóstico de apresentação — não conhece Ink, Commander nem stdout direto.

**Infraestrutura**
- Execução de comandos git (`parallelSync.ts`).
- Chamadas HTTP ao GitLab (`gitlabApi.ts`) e ao GitHub (`githubApi.ts`).
- Leitura de estado local de repositórios (`gitRepoScanner.ts`).
- Persistência em `~/.paje` (`persistence.ts`) — servidores, tokens, cache da árvore e env.yaml.
- Escrita de log em arquivo (`logger.ts` — pino).

### O que é proibido na camada de apresentação

- Chamar `GitLabApi` diretamente — use `core.loadTree()`.
- Chamar `parallelSync()` diretamente — use `core.syncSelected()`.
- Reimplementar `filterProjects`, `prepareTargets`, `resolveLocalPathConflicts`,
  `resolveSyncTargets`, `resolveRepoStatus`, `resolveSyncReposSpecs` ou `buildSummary`.
- Duplicar qualquer função que já existe no core.

### Padrão de uso do core

```typescript
const core = createGitSyncCore();

// Carrega árvore (lista projetos, filtra, resolve paths, computa status)
const { header, tree, statusMap } = await core.loadTree({ config, logger });

// CLI imprime / TUI renderiza a árvore para o usuário selecionar

// Sincroniza os selecionados e retorna sumário tipado
const { summary } = await core.syncSelected({
  config,
  logger,
  tree,   // árvore com seleção do usuário aplicada
  handlers: { onProgress, onResult },
});

// CLI imprime / TUI exibe modal com summary
```

---

## Organização do código

```
src/
  cli.ts                       # Entrada principal (CLI/TUI)
  i18n/                        # Internacionalização (pt_BR, en_US)
  modules/
    git/                       # Domínio Git/GitLab
      core/                    # ← LÓGICA DE NEGÓCIO (nunca duplicar fora daqui)
        gitSyncService.ts      #   Factory createGitSyncCore() — ponto de entrada
        gitSyncConfig.ts       #   Resolução de parâmetros CLI/ENV → GitSyncConfig
        gitBranchService.ts    #   Resolução de status de branch local
        envResolver.ts         #   Leitura de variáveis de ambiente
        loggerBroker.ts        #   Intermediário de logging
        loggerTransports.ts    #   Transports de log
      gitCommand.ts            # Apresentação CLI (Commander, formatação de saída)
      tui.app.tsx              # Apresentação TUI — renderização da árvore (Ink)
      tuiSession.tsx           # Apresentação TUI — prompts interativos (Ink)
      tui/                     # Componentes Ink reutilizáveis (Layout, modais, painéis)
      gitlabApi.ts             # Infraestrutura — API GitLab
      githubApi.ts             # Infraestrutura — API GitHub (orgs→grupos, repos→projetos)
      parallelSync.ts          # Infraestrutura — execução paralela de git
      gitRepoScanner.ts        # Infraestrutura — leitura de estado local
      persistence.ts           # Infraestrutura — persistência em ~/.paje (servidores, cache, env.yaml)
      sshManager.ts            # Infraestrutura — SSH e autenticação
      treeBuilder.ts           # Infraestrutura — construção de árvore de grupos/projetos
      patternFilter.ts         # Infraestrutura — filtros Ant/Glob
      logger.ts                # Infraestrutura — PajeLogger (pino, arquivo diário)
      types.ts                 # Tipos do domínio (compartilhados por todas as camadas)
```

---

## Ciclo de testes obrigatório

Após **toda** modificação de código:

```bash
npm run build   # deve terminar sem erros de TypeScript
npm test        # nenhum teste existente pode quebrar
```

- O runner (`tests/run-all.ts`) é tolerante a falhas: um teste que quebra não
  impede os demais de rodar. Verifique sempre a linha final da execução
  ("Todos os arquivos de teste passaram." ou a lista de falhas).
- Testes de TUI usam `tests/tui_test_utils.ts`: TTY simulado (`createFakeTTY`),
  bytes reais de teclado (`KEYS.ctrlP`, `KEYS.ctrlE`, ...), `press()` com espera
  de renderização e `getLastFrame()` para asserções sobre o frame atual.
- Testes de chave SSH requerem `ssh-keygen` (`apt-get install -y openssh-client`
  em containers que não o tenham).

---

## Persistência e configuração

- Configurações e logs locais ficam em `~/.paje/`.
- Servidores são gravados em `~/.paje/git-servers.json`.
- Tokens são gravados em `~/.paje/git-servers.json` (somente token, nunca senha).
- A árvore de grupos/projetos é cacheada em `~/.paje/git-tree-cache.json` (ver seção *Cache da árvore*). Tokens **não** são gravados no cache — URLs autenticadas são reidratadas a partir da configuração atual do servidor.
- Parâmetros de sessão podem vir de `~/.paje/env.yaml` ou de `--env-file <caminho>`.
- O editor da TUI (`Ctrl+E`) grava alterações no `env.yaml` via `writeEnvYamlUpdates()` (`persistence.ts`), preservando comentários e convertendo chaves para kebab-case.
- Nenhum dado sensível é persistido no repositório.

---

## Cache da árvore (`git-tree-cache.json`)

O `loadTree()` (`gitSyncService.ts`) implementa carga instantânea:

1. Calcula `configHash` a partir dos servidores configurados (nome, URL normalizada, filtros).
2. **Cache hit** (hash igual): a árvore é montada imediatamente a partir do cache (`fromCache: true`) e um refresh de status é agendado com `setImmediate`:
   - o status local de cada repositório é recalculado com **concorrência limitada a 4** (um subprocesso git por repositório — sem limite, dezenas de processos simultâneos saturariam a máquina e travariam a TUI);
   - cada status é entregue **incrementalmente** via callback `onStatusRefreshed(projectId, status)` — a TUI atualiza linha a linha;
   - ao final, o cache é regravado com o `statusMap` atualizado.
3. **Cache miss** (hash diferente ou sem cache): carga completa via API; ao final o cache é gravado (sem `pajeHttpUrl`, que contém token).

O cache **não tem TTL** — é invalidado apenas por mudança de configuração de servidores.

Na camada de apresentação (`gitCommand.ts`), statuses que chegam antes de a TUI montar
são bufferizados e aplicados no `onReady` da árvore.

---

## Parâmetros — fontes e ordem de prioridade

Todo parâmetro de execução passa por `resolveGitSyncConfig()` (em `gitSyncConfig.ts`),
que aplica a seguinte precedência, da mais alta para a mais baixa:

| Prioridade | Fonte | Exemplo |
|---|---|---|
| 1 — mais alta | **Argumento CLI** | `--base-dir /projetos` |
| 2 | **Arquivo de ambiente** (`--env-file` ou `~/.paje/env.yaml`) | `baseDir: /projetos` |
| 3 — mais baixa | **Padrão embutido** | `repos` (para `baseDir`) |

A origem de cada parâmetro resolvido é rastreada (`"cli"` / `"env"` / `"default"`)
e exibida no modal de parâmetros carregados (`Ctrl+P` na TUI).

### Parâmetros disponíveis (`git-sync` e `git-server-store`)

| Parâmetro | Flag CLI | Chave env | Padrão |
|---|---|---|---|
| Diretório base para clone | `--base-dir` | `baseDir` | `repos` |
| Nome do servidor | `--server-name` | `serverName` | `""` |
| URL base do servidor | `--base-url` | `baseUrl` | `""` |
| Tipo do servidor (`git-server-store`) | `--server-type` | — | auto-detectado pela URL |
| PAT do GitHub (`git-server-store`) | `--token` | — | `""` |
| Autenticação básica (HTTPS+PAT) | `--use-basic-auth` | `useBasicAuth` | `false` |
| Usuário GitLab | `--username` | `username` | `""` |
| E-mail Git | `--user-email` | `userEmail` | `""` |
| Senha / PAT | `--password` | `password` | `""` |
| Nome da chave SSH | `--key-label` | `keyLabel` | `""` |
| Passphrase da chave SSH | `--passphrase` | `passphrase` | `""` |
| Caminho da chave pública existente | `--public-key-path` | `publicKeyPath` | `""` |
| Ocultar repos públicos | `--no-public-repos` | `noPublicRepos` | `false` |
| Ocultar repos arquivados | `--no-archived-repos` | `noArchivedRepos` | `false` |
| Filtro Ant/Glob de path | `--filter` | `filter` | `""` |
| Repos/branches a sincronizar | `--sync-repos` | `syncRepos` | `""` |
| Nível de detalhe | `--verbose` | `verbose` | `false` |
| Simular sem persistir | `--dry-run` | `dryRun` | `false` |
| Paralelismo | `--parallels` | `parallels` | `auto` |
| Criar dirs sem clonar | `--prepare-local-dirs` | `prepareLocalDirs` | `false` |
| Ocultar resumo final | `--no-summary` | `noSummary` | `false` |
| Arquivo de ambiente | `--env-file` | — | `~/.paje/env.yaml` |

---

## Propriedades por servidor (`GitServerEntry`)

Cada servidor registrado via `git-server-store` é salvo em `~/.paje/git-servers.json`
com as seguintes propriedades:

| Propriedade | Tipo | Descrição |
|---|---|---|
| `id` | `string` | URL base normalizada (chave de identidade) |
| `name` | `string` | Nome legível do servidor |
| `type` | `"gitlab" \| "github"?` | Tipo do servidor; ausente = `gitlab`. Detectado pela URL no registro (`github.com` → `github`) ou forçado com `--server-type` |
| `baseUrl` | `string` | URL base do servidor |
| `useBasicAuth` | `boolean?` | Se `true`, usa HTTPS + token; se `false`/ausente, usa SSH |
| `username` | `string?` | Usuário para autenticação básica |
| `token` | `string?` | PAT salvo — único segredo persistido em disco |
| `userEmail` | `string?` | E-mail Git aplicado aos repos clonados deste servidor |
| `baseDir` | `string?` | Diretório base de clone específico deste servidor |
| `filter` | `string?` | Filtro Ant/Glob aplicado somente aos projetos deste servidor |
| `noPublicRepos` | `boolean?` | Ocultar repos públicos para este servidor |
| `noArchivedRepos` | `boolean?` | Ocultar repos arquivados para este servidor |
| `syncRepos` | `string?` | Repos/branches a sincronizar para este servidor |
| `tokenName` | `string?` | Nome do PAT no GitLab (usado na criação/rotação) |
| `tokenScopes` | `string?` | Escopos do PAT separados por vírgula |
| `tokenExpiresAt` | `string?` | Data de expiração do PAT (`YYYY-MM-DD`) |

### Prioridade das propriedades de servidor vs. parâmetros de sessão

Para os campos `baseDir`, `userEmail`, `filter`, `noPublicRepos` e `noArchivedRepos`,
a precedência efetiva durante um `git-sync` é:

| Prioridade | Fonte |
|---|---|
| 1 — mais alta | **Propriedade gravada no servidor** (`~/.paje/git-servers.json`) |
| 2 | **Argumento CLI** da sessão atual (`--base-dir`, `--filter`, etc.) |
| 3 | **Arquivo de ambiente** (`env.yaml` / `--env-file`) |
| 4 — mais baixa | **Padrão embutido** |

Ou seja: se o servidor tem `baseDir: /projetos/tse` salvo, esse valor é usado
independentemente de `--base-dir` passado na linha de comando. O argumento CLI
só prevalece se o servidor não tiver a propriedade definida.

**Implementação:** em `loadTree()` (`gitSyncService.ts`), cada projeto recebe os campos
`pajeBaseDir`, `pajeUserEmail` e `pajeHttpUrl` estampados a partir do servidor de origem.
Em `prepareTargets()`, esses campos têm precedência sobre os valores de `config`:

```typescript
localPath: path.join(project.pajeBaseDir ?? config.baseDir, ...),
gitUserEmail: project.pajeUserEmail ?? config.userEmail,
httpUrl: project.pajeHttpUrl,   // URL HTTPS com token OAuth2 embutido
```

O filtro por servidor é aplicado por `filterProjects()` dentro do loop por servidor,
antes da mesclagem de projetos de múltiplos servidores. O filtro global de `config`
é aplicado novamente após a mesclagem como segundo passe.

### Fluxo de autenticação por tipo de servidor

| Servidor | Modo | Operações git usam |
|---|---|---|
| GitLab, `useBasicAuth: false` (padrão) | SSH | URL `ssh_url_to_repo` via `~/.ssh/config` |
| GitLab, `useBasicAuth: true` | HTTPS + PAT | `pajeHttpUrl` com `oauth2:<token>@host` embutido |
| GitHub (`type: "github"`) | HTTPS + PAT | `pajeHttpUrl` com `x-access-token:<token>@host` embutido |

Ao executar `git-server-store` sem `--use-basic-auth` em servidor GitLab, o fluxo SSH
é iniciado. O PAJÉ verifica proativamente se a porta 22 do servidor está acessível antes
de tentar o setup. Se bloqueada, exibe orientação para geração de PAT e sugere
reexecutar com `--use-basic-auth`.

Para GitHub não há fluxo SSH: o registro valida o PAT via `GET /user` e persiste o
servidor com o login retornado. Em `loadTree()`, o `GitHubApi` mapeia organizações
para `GitLabGroup[]` (o login do usuário também vira um grupo pessoal) e repositórios
para `GitLabProject[]`, de modo que todo o restante do pipeline (árvore, filtros,
sincronização) é agnóstico do provedor. Em GitHub Enterprise Server a API é resolvida
como `<baseUrl>/api/v3`; em github.com, `https://api.github.com`.

## Componentes de TUI

O layout padrão em Ink é composto por:

- Barra de título (`TitleBar`) — 1 linha no topo.
- Área de trabalho (`Workspace`) — árvore de repositórios.
- Barra de orientação (`OrientationBar`) — atalhos e comandos.
- Painel de log (`LoggerPanel`) — ocupa 15% da tela, na parte inferior; colorização
  por nível com ANSI manual (chalk desabilita cores fora de TTY real) e truncamento
  em uma linha física por entrada.

Modais sobrepostos ao layout (`layout.tsx`):

- `ParametersModal` (`Ctrl+P`) — parâmetros carregados, somente leitura.
- `EditParamsModal` (`Ctrl+E`) — edição do `env.yaml` com pendências e `Ctrl+S` para gravar.
- `HelpModal` (`Ctrl+H`) — atalhos por contexto, executáveis a partir do modal.
- `BranchModal` (`Ctrl+B`, na árvore) — seleção/criação de branch.

**Regra de posse do teclado:** modais de workflow (`edit-params` e `branch`) são donos
do teclado enquanto abertos — o `Layout` não processa `Esc`/`Ctrl+P`/`Ctrl+H`/`Ctrl+E`
nesses estados (trocar de modal descartaria estado pendente). `Ctrl+C` funciona sempre,
inclusive com modal aberto.

**Atalhos e bytes de terminal:** o terminal envia o mesmo byte para `Ctrl+M` e `Enter`
(`0x0d`) e o byte de backspace para `Ctrl+H` (`0x08`; a tecla Backspace física envia
`0x7f`). Por isso a pesquisa por nome na árvore usa `Ctrl+F` (que precisa ser pressionado
para entrar no modo de pesquisa antes de digitar) e o filtro de itens marcados usa
`Ctrl+X`; o `Layout` aceita `key.backspace` como abertura da ajuda apenas em telas sem
campo de texto ativo (prop `helpOnBackspace`).

## Extensão VSCode (`vscode-extension/`)

Terceira camada de apresentação sobre o mesmo core:

- `extension.ts` — ativação: registra a TreeView, comandos (`paje.refreshTree`,
  `paje.syncSelected`, `paje.syncNode`, `paje.openRepository`, `paje.openEnvFile`)
  e um Output Channel "PAJÉ" ligado ao `LoggerBroker` via `createPanelTransport`.
- `pajeTreeProvider.ts` — `TreeDataProvider` com checkboxes
  (`toggleTreeNode`/`recomputeTreeSelection` do treeBuilder).
- `treeAdapter.ts` — mapeamento puro `GitLabTreeNode` → descritor de TreeItem,
  **sem importar o módulo `vscode`**, testável pela suíte principal
  (`vscode_tree_adapter_test`).
- Config e persistência idênticas à CLI/TUI: `resolveGitSyncConfig()` sem flags,
  `~/.paje/git-servers.json`, cache instantâneo da árvore.
- Bundle via esbuild (`npm run build:vscode`) → `dist/extension.cjs` (CJS único
  com o core embutido; `external: ["vscode"]`). O pacote da extensão é
  `"type": "module"` para os fontes; o runtime CJS fica explícito no `.cjs`.
- A regra de camadas vale aqui também: a extensão **não** importa Ink/React nem
  reimplementa lógica do core — o smoke test (`vscode_extension_smoke_test`)
  ativa o bundle real com um mock do módulo `vscode`.

## Logging (pino)

O pipeline de log usa [pino](https://getpino.io) como motor:

- `LoggerBroker` (`core/loggerBroker.ts`) — fachada com `debug/info/warn/error`;
  serializa via pino e distribui `LogEntry` aos transports registrados, com
  filtragem por `minLevel` por transport (`setTransportLevel`).
- `PajeLogger` (`logger.ts`) — escrita no arquivo diário `~/.paje/logs/git-sync-YYYY-MM-DD.log`
  via pino + pino-pretty (formato legível). Usa **instância compartilhada por arquivo**
  (singleton) — instâncias por componente vazariam fds e disparariam avisos de
  MaxListeners no stderr, corrompendo a TUI.
- Transports (`core/loggerTransports.ts`):
  - `createConsoleTransport` — **obrigatoriamente** via `console.log`/`console.error`:
    o Ink intercepta o console para desenhar acima da UI; escrever direto no fd 1
    corrompe o frame.
  - `createFileTransport` — delega ao `PajeLogger` (debug é prefixado `[DEBUG]`).
  - `createGlobalPanelTransport` — alimenta o `logStore` global do painel TUI.
- Níveis padrão: console `info`; painel TUI `info` (`debug` com `--verbose`);
  arquivo `info` (`debug` com `--verbose`).

## i18n

Todo texto visível ao usuário usa `t("chave")`. Novas chaves devem ser adicionadas
em `src/i18n/pt_BR.ts` **e** `src/i18n/en_US.ts`. Nunca usar string literal
hardcoded em mensagens de log, orientações ou erros.

## Tipos canônicos

| Tipo | Arquivo |
|---|---|
| `RepoSyncState` | `src/modules/git/types.ts` |
| `GitSyncConfig` | `src/modules/git/core/gitSyncConfig.ts` |
| `GitServerEntry` | `src/modules/git/core/gitSyncService.ts` |
| `GitLabProject`, `GitLabTreeNode` | `src/modules/git/types.ts` |

Não redeclarar tipos que já existem em outro arquivo.

## Dependências principais

- Ink/React para TUI.
- Commander para CLI.
- Pino + pino-pretty para logging.
- Cheerio para fluxos web.
- Tough-cookie para sessões.

## Documentos relacionados

| Documento | Conteúdo |
|---|---|
| `auditoria-arquitetura.md` | 16 problemas arquiteturais conhecidos com localização exata |
| `auditoria-codigo.md` | Bugs, inconsistências e débitos técnicos — abertos e resolvidos |
| `requisitos-tui-git-sync.md` | Requisitos funcionais e de usabilidade da TUI git-sync |
