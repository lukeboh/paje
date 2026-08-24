# Auditoria Arquitetural — PAJÉ

**Data:** 2026-06-05 (revisada 2026-06-05 pós refatoração)
**Escopo:** Separação CLI / TUI / Core no fluxo `git-sync`

---

## Status geral

A refatoração em três fases concluída no branch `refactor/tui-cli-core-separation`
resolveu os pontos críticos da auditoria original. CLI e TUI agora delegam
toda a lógica de negócio ao core via `createGitSyncCore()`.

---

## 1. Mapeamento dos arquivos (estado atual)

| Arquivo | Papel real |
|---|---|
| `src/modules/git/core/gitSyncService.ts` | Core canônico — factory `createGitSyncCore()`. Agora efetivamente usado por CLI e TUI. |
| `src/modules/git/core/gitSyncConfig.ts` | Resolve opções do Commander → `GitSyncConfig`. |
| `src/modules/git/core/gitBranchService.ts` | Resolução de status de branch local. |
| `src/modules/git/core/envResolver.ts` | Leitura de variáveis de ambiente. |
| `src/modules/git/core/loggerBroker.ts` / `loggerTransports.ts` | Intermediário de log. |
| `src/modules/git/gitPathUtils.ts` | `resolveProjectLocalPath` e `resolveLocalPathConflicts` — único ponto canônico. |
| `src/modules/git/gitCommand.ts` | CLI/TUI — ~2 712 linhas (era 2 844). Agora delega ao core. |
| `src/modules/git/parallelSync.ts` | Execução paralela de git. Chamado internamente pelo core; CLI usa apenas tipos e `runGit`/`resolveConcurrency`. |
| `src/modules/git/treeBuilder.ts` | Construção da árvore GitLab. |
| `src/modules/git/gitRepoScanner.ts` | Scanning de repositórios locais. |
| `src/modules/git/gitlabApi.ts` | API do GitLab. |
| `src/modules/git/persistence.ts` | Persistência de servidores. |
| `src/modules/git/patternFilter.ts` | Filtros Ant/Glob. |

---

## 2. Fluxo de execução atual (estado correto)

### CLI e TUI

```
gitCommand.ts
  ↓ resolveGitSyncConfig()         ✅ resolve parâmetros
  ↓ core.loadTree()                ✅ carrega tudo: servidores, projetos, status
  ↓ [TUI renderiza / CLI imprime árvore]
  ↓ core.syncSelected()            ✅ sincroniza, retorna summary
  ↓ [TUI ou CLI formata e exibe summary]
```

---

## 3. Problemas classificados (status pós-refatoração)

| ID | Descrição | Status |
|---|---|---|
| ARQ-01 | `core.loadTree()` nunca chamado pela CLI | ✅ RESOLVIDO — Fase 2 |
| ARQ-02 | `core.syncSelected()` nunca chamado pela CLI | ✅ RESOLVIDO — Fase 2 |
| ARQ-03 | `core.loadTree()` nunca chamado pela TUI | ✅ RESOLVIDO — Fase 2 |
| ARQ-04 | `core.syncSelected()` nunca chamado pela TUI | ✅ RESOLVIDO — Fase 2 |
| ARQ-05 | `filterProjects` duplicada com lógica divergente | ✅ RESOLVIDO — Fase 1: core usa `matchesAntPatterns` |
| ARQ-06 | `resolveRepoStatus` duplicada | ✅ RESOLVIDO — Fase 3: importada do core |
| ARQ-07 | `resolveLocalPathConflicts` duplicada | ✅ RESOLVIDO — Fase 1: movida para `gitPathUtils.ts` |
| ARQ-08 | `resolveSyncReposSpecs` duplicada | ✅ RESOLVIDO — Fase 3: removida (dead code) |
| ARQ-09 | `resolveSyncTargets` duplicada | ✅ RESOLVIDO — Fase 3: removida (dead code) |
| ARQ-10 | `prepareTargets` duplicada | ✅ RESOLVIDO — Fase 3: removida |
| ARQ-11 | `resolveParallels` duplicada | ✅ RESOLVIDO — Fase 3: importada do core |
| ARQ-12 | `ensureLocalDirsIfNeeded` duplicada | ✅ RESOLVIDO — Fase 3: removida |
| ARQ-13 | `buildSummary`/`createSummary` duplicadas | ✅ RESOLVIDO — `RepoSummary` removida. `createSummary()` agora retorna `GitSyncSummary` importado do core. |
| ARQ-14 | `parallelSync` importado diretamente pela CLI/TUI | ✅ EFETIVAMENTE RESOLVIDO — `parallelSync()` não é mais chamado diretamente. O import permanece para `runGit`, `resolveConcurrency`, `ProgressEvent` e `SyncResult` — tipos e utilitários de infra que a camada de apresentação ainda consome legitimamente. |
| ARQ-15 | `ensureSshKey` divergente: core incompleto | ✅ RESOLVIDO — A versão local em `gitCommand.ts` era dead code (nunca chamada). Removida. O core mantém a versão canônica não-interativa chamada por `loadTree()`. |
| ARQ-16 | `resolveProjectLocalPath` duplicada | ✅ RESOLVIDO — Fase 1: movida para `gitPathUtils.ts` |
| ARQ-17 | Default `"repos"` de `--base-dir` duplicado 3× fora do core (`gitCommand.ts:1681,1981,2219`) em vez de importado de `DEFAULT_BASE_DIR` (`gitSyncConfig.ts:51`) | ⚠️ ABERTO |

---

## 4. Resumo do progresso

| Métrica | Antes | Depois |
|---|---|---|
| `gitCommand.ts` | ~2 844 linhas | ~2 440 linhas |
| Funções duplicadas | 12 | 0 |
| `parallelSync()` chamado diretamente | Sim | Não |
| `createGitSyncCore()` usado em produção | Não | Sim |
| Tipo `RepoSummary` local | Sim | Removido — usa `GitSyncSummary` do core |
| `ensureSshKey` dead code no CLI | Sim | Removido |
| Lógica de sync centralizada no core | Não | Sim |
| Testes cobrem código de produção | Parcialmente | Sim |

**Dos 17 itens ARQ, 16 estão resolvidos; ARQ-17 está aberto.**
