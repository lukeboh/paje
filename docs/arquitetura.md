# Arquitetura do PAJÉ

## Visão geral

O PAJÉ é uma plataforma CLI/TUI escrita em TypeScript (Node.js) que automatiza tarefas
de ambiente para engenharia, com foco inicial em integrações GitLab.

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
│  gitlabApi.ts, parallelSync.ts, persistence.ts  │
│  gitRepoScanner.ts, sshManager.ts, treeBuilder  │
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
- Chamadas HTTP ao GitLab (`gitlabApi.ts`).
- Leitura de estado local de repositórios (`gitRepoScanner.ts`).
- Persistência em `~/.paje` (`persistence.ts`).

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
      tui/                     # Componentes Ink reutilizáveis
      gitlabApi.ts             # Infraestrutura — API GitLab
      parallelSync.ts          # Infraestrutura — execução paralela de git
      gitRepoScanner.ts        # Infraestrutura — leitura de estado local
      persistence.ts           # Infraestrutura — persistência em ~/.paje
      sshManager.ts            # Infraestrutura — SSH e autenticação
      treeBuilder.ts           # Infraestrutura — construção de árvore GitLab
      patternFilter.ts         # Infraestrutura — filtros Ant/Glob
      types.ts                 # Tipos do domínio (compartilhados por todas as camadas)
```

---

## Ciclo de testes obrigatório

Após **toda** modificação de código:

```bash
npm run build   # deve terminar sem erros de TypeScript
npm test        # nenhum teste existente pode quebrar
```

Falhas pré-existentes conhecidas (infraestrutura de container, não código):
- `git_branch_service_test` — servidor de assinatura git retorna 400.
- `ssh_key_store_command_test` — `ssh-keygen` ausente no container.

---

## Persistência e configuração

- Configurações e logs locais ficam em `~/.paje/`.
- Servidores são gravados em `~/.paje/git-servers.json`.
- Tokens são gravados em `~/.paje/git-servers.json` (somente token, nunca senha).
- Parâmetros de sessão podem vir de `~/.paje/env.yaml` ou de `--env-file <caminho>`.
- Nenhum dado sensível é persistido no repositório.

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
| `baseUrl` | `string` | URL base da API GitLab |
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

### Fluxo de autenticação (`useBasicAuth`)

| `useBasicAuth` | Modo | Operações git usam |
|---|---|---|
| `false` (padrão) | SSH | URL `ssh_url_to_repo` via `~/.ssh/config` |
| `true` | HTTPS + PAT | `pajeHttpUrl` com `oauth2:<token>@host` embutido |

Ao executar `git-server-store` sem `--use-basic-auth`, o fluxo SSH é iniciado.
O PAJE verifica proativamente se a porta 22 do servidor está acessível antes
de tentar o setup. Se bloqueada, exibe orientação para geração de PAT e sugere
reexecutar com `--use-basic-auth`.

## Componentes de TUI

O layout padrão em Ink é composto por:

- Barra de título (`TitleBar`) — 1 linha no topo.
- Área de trabalho (`Workspace`) — árvore de repositórios.
- Barra de orientação (`OrientationBar`) — atalhos e comandos.
- Painel de log (`LoggerPanel`) — ocupa 15% da tela, na parte inferior.

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
- Cheerio para fluxos web.
- Tough-cookie para sessões.

## Documentos relacionados

| Documento | Conteúdo |
|---|---|
| `auditoria-arquitetura.md` | 16 problemas arquiteturais conhecidos com localização exata |
| `auditoria-codigo.md` | 36 bugs e inconsistências de código identificados |
| `requisitos-tui-git-sync.md` | Requisitos funcionais e de usabilidade da TUI git-sync |
| `bugs-conhecidos.md` | Bugs conhecidos pendentes de correção |
