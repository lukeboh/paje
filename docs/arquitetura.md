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

- Configurações e logs locais ficam em `~/.paje`.
- Parâmetros podem vir do arquivo `~/.paje/env.yaml` ou de `--env-file`.
- Tokens e chaves nunca são persistidos em texto plano no repositório.

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
