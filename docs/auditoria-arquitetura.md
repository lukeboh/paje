# Auditoria Arquitetural — PAJÉ

**Data:** 2026-06-05
**Escopo:** Separação CLI / TUI / Core no fluxo `git-sync`

---

## Intenção declarada vs realidade

> _A intenção era que TUI e CLI compartilhassem toda a lógica de manipulação de
> repositórios, parâmetros e paralelização, e que TUI e CLI fossem apenas camadas
> de apresentação sobre o core do PAJÉ._

**Esta intenção não é respeitada.** O core (`src/modules/git/core/gitSyncService.ts`)
existe, porém quase nunca é chamado. CLI e TUI reproduzem internamente toda a lógica
que deveria viver exclusivamente no core.

---

## 1. Mapeamento dos arquivos

| Arquivo | Papel real |
|---|---|
| `src/modules/git/core/gitSyncService.ts` | Core declarado — factory `createGitSyncCore()`. Lógica correta, mas ignorada. |
| `src/modules/git/core/gitSyncConfig.ts` | Resolve opções do Commander → `GitSyncConfig`. **Único ponto efetivamente reaproveitado.** |
| `src/modules/git/core/gitBranchService.ts` | Resolução de status de branch local. |
| `src/modules/git/core/envResolver.ts` | Leitura de variáveis de ambiente. |
| `src/modules/git/core/loggerBroker.ts` / `loggerTransports.ts` | Intermediário de log. |
| `src/modules/git/gitCommand.ts` | CLI — 2 844 linhas. Contém toda a lógica de negócio duplicada. |
| `src/modules/git/tui.app.tsx` | TUI — renderização da árvore. |
| `src/modules/git/tuiSession.tsx` | TUI — prompts interativos. |
| `src/modules/git/parallelSync.ts` | Execução paralela de git. Deveria ser interno ao core. |
| `src/modules/git/treeBuilder.ts` | Construção da árvore GitLab. |
| `src/modules/git/gitRepoScanner.ts` | Scanning de repositórios locais. |
| `src/modules/git/gitlabApi.ts` | API do GitLab. |
| `src/modules/git/persistence.ts` | Persistência de servidores. |
| `src/modules/git/patternFilter.ts` | Filtros Ant/Glob. |

---

## 2. O que o core oferece (e não é usado)

`createGitSyncCore()` em `gitSyncService.ts:507` retorna:

```typescript
type GitSyncCore = {
  listServers:        (options) => Promise<GitServerEntry[]>;
  loadTree:           (options) => Promise<GitSyncTreeView>;
  toggleTreeSelection:(tree, id) => GitLabTreeNode[];
  syncSelected:       (options) => Promise<{ summary: GitSyncSummary }>;
};
```

Estes métodos encapsulam todo o fluxo esperado:
1. `loadTree` — carrega servidores, lista projetos, filtra, resolve paths, computa status.
2. `syncSelected` — coleta selecionados, prepara alvos, chama `parallelSync`, retorna sumário.

**Nenhum dos dois é chamado pela CLI ou pela TUI.**

---

## 3. Duplicações concretas

As tabelas abaixo mostram funções que existem tanto no core quanto na CLI.

### 3.1 Funções completamente duplicadas

| Função | CLI (`gitCommand.ts`) | Core (`gitSyncService.ts`) |
|---|---|---|
| `resolveProjectLocalPath` | linha 426 | linha 301 |
| `resolveLocalPathConflicts` | linha 430 | linha 305 |
| `ensureLocalDirsIfNeeded` | linha 456 | linha 331 |
| `resolveSyncReposSpecs` | linha 499 | linha 208 |
| `resolveSyncTargets` | linha 515 | linha 224 |
| `resolveRepoStatus` | linha 551 | linha 259 |
| `prepareTargets` | linha 1630 | linha 472 |
| `resolveParallels` | linha 1723 | linha 492 |
| `createSummary` / `buildSummary` | linha 292 | linha 438 |

### 3.2 Funções divergentes (mesma responsabilidade, lógica diferente)

| Função | Divergência |
|---|---|
| `filterProjects` | Core (linha 455): `includes()` — substring simples. CLI (linha 2282): `matchesAntPatterns()` — glob correto. A CLI está mais completa; o core está desatualizado. |
| `ensureSshKey` | Core (linha 396): versão mínima (40 linhas). CLI (linha 821): versão completa com rotação de PAT, useBasicAuth, prompts (270 linhas). O core não tem o fluxo completo. |

### 3.3 Fluxo de API GitLab

O core expõe `loadTree()` para carregar projetos. Ele nunca é chamado. Em vez disso:

- **CLI** chama `GitLabApi` diretamente a partir de `gitCommand.ts:2261`.
- **TUI** (dentro do fluxo `gitCommand.ts`) faz o mesmo.

Resultado: qualquer bug ou melhoria na listagem de projetos precisa ser corrigida em dois
lugares diferentes.

---

## 4. Fluxo de execução atual (evidência do problema)

### CLI (`paje git-sync ...`)

```
gitCommand.ts:2112  .action(options)
gitCommand.ts:2238  ✅ resolveGitSyncConfig()          ← único ponto de contato com o core
gitCommand.ts:2261  ❌ GitLabApi.listUserProjects()     ← deveria ser core.loadTree()
gitCommand.ts:2282  ❌ filterProjects() inline          ← duplicado, lógica diferente
gitCommand.ts:2318  ❌ resolveLocalPathConflicts()      ← duplicado
gitCommand.ts:2321  ❌ resolveRepoStatus() por projeto  ← duplicado
gitCommand.ts:2355  ❌ resolveSyncTargets()             ← duplicado
gitCommand.ts:2580  ❌ parallelSync() direto            ← deveria ser core.syncSelected()
gitCommand.ts:2686  ❌ sumário contado manualmente      ← duplicado
```

### TUI (`paje git-sync` com terminal interativo)

```
gitCommand.ts:2200  ✅ resolveGitSyncConfig()          ← único ponto de contato com o core
gitCommand.ts:2261  ❌ GitLabApi.listUserProjects()     ← deveria ser core.loadTree()
gitCommand.ts:2313  ❌ buildGitLabTree() inline         ← deveria vir de core.loadTree()
gitCommand.ts:2260  renderRepositoryTree() [tui.app.tsx] ← apresentação OK
gitCommand.ts:2970  ❌ collectSelectedProjects()        ← deveria ser core.toggleTreeSelection
gitCommand.ts:3004  ❌ resolveSyncReposSpecs()          ← duplicado
gitCommand.ts:3012  ❌ prepareTargets()                 ← duplicado
gitCommand.ts:3034  ❌ parallelSync() direto            ← deveria ser core.syncSelected()
```

### Como deveria ser

```
[CLI ou TUI]
  ↓ resolveGitSyncConfig()         ← já existe e funciona
  ↓ core.loadTree()                ← carrega tudo, retorna árvore + statusMap
  ↓ [TUI renderiza / CLI imprime árvore]
  ↓ core.syncSelected()            ← sincroniza, retorna summary
  ↓ [TUI ou CLI formata e exibe summary]
```

---

## 5. Impacto do estado atual

### 5.1 Impacto na TUI

A TUI é o ponto mais crítico: ela deveria ser exclusivamente uma camada de apresentação,
mas todo o processamento que ela exibe é feito fora do core e fora dela — fica
embutido no handler de comando em `gitCommand.ts`.

**Consequências específicas para a TUI:**

| Consequência | Detalhe |
|---|---|
| **TUI não tem controle do carregamento** | `loadTree()` do core nunca é chamado. A TUI recebe a árvore já pronta, sem poder reagir a progresso de carregamento, erros por servidor ou recargas parciais. O spinner de "acessando servidores" (RF-01) precisa ser implementado fora do core, duplicando lógica. |
| **Sincronização desacoplada do core** | Após a seleção do usuário, a TUI (via `gitCommand.ts:3034`) chama `parallelSync()` diretamente. Isso significa que `core.syncSelected()` — que consolida preparação de alvos, resolução de paths e paralelização — é completamente ignorado. Qualquer melhoria no core não chega à TUI. |
| **Progresso por linha não usa contrato do core** | Os eventos de progresso (`ProgressEvent`) chegam à TUI via callback direto de `parallelSync`, não via `handlers` do `core.syncSelected()`. Se o core mudar o contrato de progresso, a TUI não é automaticamente afetada — e vice-versa. |
| **Filtros da TUI divergem do core** | A filtragem de projetos antes de montar a árvore é feita inline em `gitCommand.ts:2282` usando `matchesAntPatterns` (glob). O core usa `includes()` (substring). A árvore que o usuário vê na TUI pode diferir do que o core processaria. |
| **Resumo final não usa `GitSyncSummary` do core** | O modal de resumo pós-sincronização (RF-08) é montado a partir de contagem manual em `gitCommand.ts`, não a partir do `summary` retornado por `core.syncSelected()`. O tipo `GitSyncSummary` com `byStatus: Record<RepoSyncState, number>` existe no core mas a TUI nunca o recebe. |
| **TUI não é testável isoladamente** | Como a lógica de negócio está misturada ao handler Commander em `gitCommand.ts`, não é possível testar o comportamento da TUI (seleção → sincronização → resumo) sem instanciar toda a infraestrutura de comando CLI. |
| **Componentes TUI (`tui.app.tsx`, `tuiSession.tsx`) são apresentação pura** | Estes arquivos fazem apenas renderização React/Ink — estão corretos. O problema não está neles, mas no fato de que o código que os alimenta (`gitCommand.ts`) mistura lógica de negócio com orquestração de apresentação. |

### 5.2 Impacto geral

| Consequência | Descrição |
|---|---|
| **Bugs assimétricos** | Uma correção no core não afeta a TUI automaticamente. Exemplo: `filterProjects` usa glob na CLI/TUI e substring no core — a árvore exibida na TUI pode conter projetos diferentes do que o core processaria. |
| **Testes cobrem código morto** | O core tem testes (`tests/`), mas a lógica real de produção não passa por ele. Os testes cobrem código que nunca é executado em produção. |
| **Manutenção multiplicada** | Qualquer nova regra de negócio (ex: novo estado de repo, nova flag de filtro) precisa ser aplicada em `gitCommand.ts` e em `gitSyncService.ts` separadamente. |
| **`gitCommand.ts` inchado** | 2 844 linhas misturando apresentação, lógica de negócio, acesso a API e parsing de parâmetros. Refatorar qualquer coisa nele exige entender o arquivo inteiro. |

---

## 6. Problemas classificados

| ID | Descrição | Arquivo:Linha | Severidade |
|---|---|---|---|
| ARQ-01 | `core.loadTree()` nunca é chamado pela CLI | `gitCommand.ts:2261` | CRÍTICO |
| ARQ-02 | `core.syncSelected()` nunca é chamado pela CLI | `gitCommand.ts:2580` | CRÍTICO |
| ARQ-03 | `core.loadTree()` nunca é chamado pela TUI | `gitCommand.ts:2261` | CRÍTICO |
| ARQ-04 | `core.syncSelected()` nunca é chamado pela TUI | `gitCommand.ts:3034` | CRÍTICO |
| ARQ-05 | `filterProjects` duplicada com lógica divergente | `gitCommand.ts:2282` vs `gitSyncService.ts:455` | CRÍTICO |
| ARQ-06 | `resolveRepoStatus` duplicada | `gitCommand.ts:551` vs `gitSyncService.ts:259` | ALTO |
| ARQ-07 | `resolveLocalPathConflicts` duplicada | `gitCommand.ts:430` vs `gitSyncService.ts:305` | ALTO |
| ARQ-08 | `resolveSyncReposSpecs` duplicada | `gitCommand.ts:499` vs `gitSyncService.ts:208` | ALTO |
| ARQ-09 | `resolveSyncTargets` duplicada | `gitCommand.ts:515` vs `gitSyncService.ts:224` | ALTO |
| ARQ-10 | `prepareTargets` duplicada | `gitCommand.ts:1630` vs `gitSyncService.ts:472` | ALTO |
| ARQ-11 | `resolveParallels` duplicada | `gitCommand.ts:1723` vs `gitSyncService.ts:492` | ALTO |
| ARQ-12 | `ensureLocalDirsIfNeeded` duplicada | `gitCommand.ts:456` vs `gitSyncService.ts:331` | ALTO |
| ARQ-13 | `buildSummary`/`createSummary` duplicadas | `gitCommand.ts:292` vs `gitSyncService.ts:438` | ALTO |
| ARQ-14 | `parallelSync` importado diretamente pela CLI/TUI | `gitCommand.ts:44` | ALTO |
| ARQ-15 | `ensureSshKey` divergente: core incompleto | `gitCommand.ts:821` vs `gitSyncService.ts:396` | MÉDIO |
| ARQ-16 | `resolveProjectLocalPath` duplicada | `gitCommand.ts:426` vs `gitSyncService.ts:301` | MÉDIO |

---

## 7. Plano de refatoração sugerido

### Fase 1 — Nivelar o core com a CLI (sem quebrar nada)

Antes de migrar os pontos de chamada, o core precisa ter a lógica completa e
correta. Itens a ajustar no core:

1. `filterProjects`: substituir `includes()` por `matchesAntPatterns()` (glob).
2. `ensureSshKey`: incorporar o fluxo completo de `useBasicAuth`, rotação de PAT e prompts.
3. Exportar `resolveProjectLocalPath` e `resolveLocalPathConflicts` de um único módulo
   compartilhado (ex: `gitPathUtils.ts`) para evitar que elas existam em dois lugares.

### Fase 2 — CLI usa `core.loadTree()` e `core.syncSelected()`

Substituir as chamadas inline na CLI pelo core:

```typescript
// gitCommand.ts — fluxo sem TUI
const core = createGitSyncCore();
const { header, tree, statusMap } = await core.loadTree({ config, logger });
// ... renderizar na CLI
const { summary } = await core.syncSelected({ config, logger, tree, handlers });
```

```typescript
// gitCommand.ts — fluxo com TUI
const core = createGitSyncCore();
const { header, tree } = await core.loadTree({ config, logger });
const selectedTree = await renderRepositoryTree({ tree, header, ... });
const { summary } = await core.syncSelected({ config, logger, tree: selectedTree, handlers });
```

### Fase 3 — Remover duplicatas da CLI

Após a fase 2, as seguintes funções em `gitCommand.ts` podem ser deletadas:

- `resolveProjectLocalPath` (linha 426)
- `resolveLocalPathConflicts` (linha 430)
- `ensureLocalDirsIfNeeded` (linha 456)
- `resolveSyncReposSpecs` (linha 499)
- `resolveSyncTargets` (linha 515)
- `resolveRepoStatus` (linha 551)
- `prepareTargets` (linha 1630)
- `resolveParallels` (linha 1723)
- `createSummary` (linha 292)
- Bloco de filtragem inline (linhas 2282–2299)
- Importação direta de `parallelSync` (linha 44)

### Resultado esperado

| Métrica | Antes | Depois |
|---|---|---|
| `gitCommand.ts` | ~2 844 linhas | ~900 linhas (só apresentação) |
| `gitSyncService.ts` | ~762 linhas | ~900 linhas (lógica completa) |
| Lógica duplicada | 12+ funções | 0 |
| Testes cobrem código real | Parcialmente | Sim |
