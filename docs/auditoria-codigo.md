# Relatório de Auditoria — Projeto PAJE

Data: 2026-06-05 (revisada 2026-06-05 pós refatoração)

---

## 1. BUGS / COMPORTAMENTOS INCORRETOS

### ~~BUG-01~~ — `gitBranchService.ts:100` — DIVERGED exibido como AHEAD *(decisão de design — não é bug)*

> **Esclarecimento:** comportamento intencional documentado em `docs/requisitos-tui-git-sync.md` RF-03.
> Quando `ahead > 0` e `behind > 0`, o sistema exibe `state: "AHEAD"` para destacar a presença de commits locais não publicados. O delta `+N/-M` ainda comunica a divergência.

---

### BUG-02 — `gitCommand.ts:705,796,908` — Chaves i18n `cli.errors.gitlab.registerKey*` inexistentes
**Severidade: ALTO** | **Status: ABERTO**

`t("cli.errors.gitlab.registerKeyDetails")` e `t("cli.errors.gitlab.registerKey")` chamadas em `ensureSshKey()` não existem em nenhum locale. Erros de registro de chave SSH exibirão a chave literal ao invés da mensagem.

---

### BUG-03 — `gitCommand.ts:958` — Chave i18n `cli.prompt.verbose.title` inexistente
**Severidade: MÉDIO** | **Status: ABERTO**

Título de modal exibirá `"cli.prompt.verbose.title"` literal.

---

### BUG-04 — `gitCommand.ts` — Chave i18n `cli.log.syncNoMatch` inexistente
**Severidade: MÉDIO** | **Status: RESOLVIDO**

A chamada foi removida com a Fase 2. A lógica de "nenhum repositório corresponde" passou para o core, que usa `cli.sync.noSyncMatches`.

---

### BUG-05 — `gitCommand.ts:1487–1540` — Chaves `cli.prompt.parallel.*` inexistentes (9 chaves)
**Severidade: BAIXO** | **Status: ABERTO (mitigado)**

Função `resolveParallelOptions` continua dead code (ver DC-01). Enquanto não for chamada, o bug não se manifesta.

---

### ~~BUG-06~~ — `gitCommand.ts` — `useBasicAuth` padrão `true` em `git-server-store`
**Severidade: CRÍTICO** | **Status: RESOLVIDO**

Corrigido para `useBasicAuth: options.useBasicAuth ?? false`. O fluxo SSH é agora o padrão correto.

---

### BUG-07 — `gitCommand.ts` vs `gitSyncService.ts` — semântica invertida do campo `updated` em `mergeServer`
**Severidade: MÉDIO** | **Status: ABERTO**

Em `gitCommand.ts:542`: novo servidor → `updated: false`, atualizado → `updated: true`.
Em `gitSyncService.ts:142`: ambos os casos → `updated: true`. Semânticas opostas para a mesma operação.
Risco: código que testa `merge.updated` se comporta diferente dependendo do caminho chamado.

---

### ~~BUG-08~~ — `gitCommand.ts` — `const resolvedPaths` redeclarado no mesmo bloco
**Severidade: BAIXO** | **Status: RESOLVIDO**

As duas declarações (linhas 1979 e 2401) estão em escopos distintos após a refatoração.

---

### ~~BUG-09~~ — `parallelSync.ts` — `ensureParentDir` usa binário `mkdir` externo
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Corrigido em `parallelSync.ts:135–136`: usa `fs.promises.mkdir(..., { recursive: true })`.

---

### BUG-10 — `gitCommand.ts:2470` — Chave i18n `cli.log.tuiUnavailable` inexistente
**Severidade: BAIXO** | **Status: ABERTO** (código raramente alcançado em runtime)

---

### ~~BUG-11~~ — `gitCommand.ts` — `prepareTargets` ignorava conflitos de caminho em multi-servidor
**Severidade: ALTO** | **Status: RESOLVIDO**

`prepareTargets` removida da camada de apresentação. O core usa `resolveLocalPathConflicts` corretamente em todos os paths.

---

## 2. INCONSISTÊNCIAS ENTRE ARQUIVOS

### ~~INC-01~~ — Separador de branch em `syncRepos`: `#` no CLI vs `@` na TUI
**Severidade: ALTO** | **Status: RESOLVIDO**

Alinhado para `#` em todos os caminhos.

---

### ~~INC-02~~ — `GitServerEntry` declarado em dois arquivos sem relação entre si
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`gitCommand.ts` importa `GitServerEntry` de `gitSyncService.ts`. Único ponto canônico.

---

### ~~INC-03~~ — `buildSummary` em `gitSyncService.ts` usa estados inválidos
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`buildSummary` agora usa chaves de `RepoSyncState` válidas.

---

### ~~INC-04~~ — `filterProjects` em `gitSyncService.ts` usa `includes()` em vez de Ant/Glob
**Severidade: ALTO** | **Status: RESOLVIDO**

Core usa `compileAntPatterns` / `matchesAntPatterns` desde a Fase 1.

---

### INC-05 — `ensureLocalDirsIfNeeded`: cria diretório pai (core) vs diretório completo (CLI anterior)
**Severidade: BAIXO** | **Status: EFETIVAMENTE RESOLVIDO**

O CLI não chama mais `ensureLocalDirsIfNeeded` diretamente. Ambos os caminhos (CLI e TUI) passam pelo core, que cria apenas `path.dirname(targetPath)`. Comportamento unificado, embora a semântica (dirname vs targetPath completo) seja um ponto a revisar se `--prepare-local-dirs` for reutilizado.

---

### INC-06 — `mergeServer` tem semântica de `updated` oposta entre os dois arquivos
**Severidade: MÉDIO** | **Status: ABERTO**

Ver BUG-07. Dois `mergeServer` separados: `gitCommand.ts:527` e `gitSyncService.ts:133`.

---

### ~~INC-07~~ — `gitSyncService.ts` não listava projetos públicos; o CLI listava
**Severidade: ALTO** | **Status: RESOLVIDO**

`listPublicProjects()` removida do fluxo de `loadTree()`. Projetos públicos dos quais o usuário é membro já retornam via `listUserProjects()` (`membership=true`). O flag `noPublicRepos` filtra projetos públicos dentro dessa lista.

---

### INC-08 — `parallelSync`: parâmetro `onProgress` tem duas semânticas diferentes
**Severidade: BAIXO** | **Status: ABERTO**

Terceiro parâmetro de `parallelSync` recebe `SyncResult` (resultado final), não progresso intermediário. Em `gitSyncService.ts` é chamado internamente de `onResult`. Nomenclatura enganosa.

---

## 3. CHAVES I18N FALTANDO / ÓRFÃS

### I18N-01 — Chaves usadas no código mas ausentes em ambos os locales

| Chave | Arquivo:Linha | Status |
|---|---|---|
| `cli.errors.gitlab.registerKeyDetails` | `gitCommand.ts:705,796,908` | ABERTO |
| `cli.errors.gitlab.registerKey` | `gitCommand.ts:711,802,914` | ABERTO |
| `cli.prompt.verbose.title` | `gitCommand.ts:958` | ABERTO |
| `cli.log.tuiUnavailable` | `gitCommand.ts:2470` | ABERTO |
| `cli.prompt.parallel.title` | `gitCommand.ts:1492` | ABERTO (dead code) |
| `cli.prompt.parallel.level` | `gitCommand.ts:1493` | ABERTO (dead code) |
| `cli.prompt.parallel.auto` | `gitCommand.ts:1495` | ABERTO (dead code) |
| `cli.prompt.parallel.autoDesc` | `gitCommand.ts:1495` | ABERTO (dead code) |
| `cli.prompt.parallel.oneDesc` | `gitCommand.ts:1496` | ABERTO (dead code) |
| `cli.prompt.parallel.twoDesc` | `gitCommand.ts:1497` | ABERTO (dead code) |
| `cli.prompt.parallel.fourDesc` | `gitCommand.ts:1498` | ABERTO (dead code) |
| `cli.prompt.parallel.eightDesc` | `gitCommand.ts:1499` | ABERTO (dead code) |
| `cli.prompt.parallel.shallow` | `gitCommand.ts:1504` | ABERTO (dead code) |

---

### I18N-02 — Chave `cli.log.preselection` definida mas nunca usada no código
**Severidade: BAIXO** | **Status: ABERTO**

Presente em `pt_BR.ts:181` e `en_US.ts:181`. Nenhuma ocorrência em `src/`. Chave órfã.

---

### I18N-03 — `en_US.ts` não é verificado pelo compilador
**Severidade: MÉDIO** | **Status: ABERTO**

`types.ts` usa apenas `PtBrTranslations`. Chaves adicionadas a `pt_BR` e omitidas em `en_US` não causam erro de compilação.

---

### ~~I18N-04~~ — Texto de orientação na TUI mostra atalhos errados após Issue #6
**Severidade: ALTO** | **Status: RESOLVIDO**

Textos de orientação corrigidos em `pt_BR.ts` e `en_US.ts` para `menu.orientation`,
`tui.tree.orientationDefault`, `tui.tree.orientationConfirm` e `tui.loading.orientation`.
Todos os atalhos agora refletem as combinações com Ctrl (`Ctrl+S`, `Ctrl+M`, `Ctrl+B`, etc.).

---

## 4. REQUISITOS vs CÓDIGO

### ~~REQ-01 / UX-03~~ — Atalho "S" documentado; código usa "Ctrl+S"
**Severidade: ALTO** | **Status: RESOLVIDO**

Textos de orientação atualizados. `Ctrl+S` para sincronizar tudo, `Enter` para sincronizar apenas o escopo destacado.

---

### REQ-02 — `docs/requisitos-tui-git-sync.md` RF-08: Modal de resumo final não implementada
**Severidade: ALTO** | **Status: ABERTO**

Requisito pede modal com tempo total, contagem de ações e lista ordenada de repositórios com métricas. Código entrega apenas logs no painel de log.

---

### REQ-03 — `docs/requisitos-tui-git-sync.md` RF-06: Remoção de repositórios desmarcados inconsistente
**Severidade: ALTO** | **Status: ABERTO**

Bug documentado em `docs/bugs-conhecidos.md` como aberto (BUG-004). Remoção não respeita escopo correto (linha vs grupo) nem as regras de exclusão segura para estados UNCOMMITTED/AHEAD/DIVERGED.

---

### ~~REQ-04~~ — README cita `F12` para log em tela cheia; código usa `Ctrl+L`
**Severidade: MÉDIO** | **Status: RESOLVIDO**

README, `TUI-leiaute.md` e `requisitos-tui-git-sync.md` atualizados com `Ctrl+L`. Todos os atalhos agora refletem o código.

---

### REQ-05 — `docs/requisitos-tui-git-sync.md` RF-01: Spinner de loading não disponível no caminho `gitSyncService`
**Severidade: BAIXO** | **Status: ABERTO**

O spinner existe apenas no caminho `gitCommand.ts`. O `gitSyncService.loadTree()` não emite eventos de progresso HTTP para consumidores externos.

---

### REQ-06 — `docs/requisitos-tui-git-sync.md` RU-03: Painel de log deve iniciar em nível `warn`; inicia em `info`
**Severidade: MÉDIO** | **Status: ABERTO**

```typescript
// logStore.ts:17
private minLevel: LogLevel = "info";  // deveria ser "warn" conforme RU-03
```

---

## 5. DEAD CODE / CÓDIGO NUNCA ALCANÇADO

### DC-01 — `resolveParallelOptions()` nunca é chamada (`gitCommand.ts:1487`)
**Severidade: BAIXO** | **Status: ABERTO**

Função declarada mas não invocada. Carrega 9 chaves i18n inexistentes. Pode ser removida junto com as chaves de `cli.prompt.parallel.*`.

---

### DC-02 — `useTty = false` torna ~150 linhas de renderização TTY inacessíveis (`gitCommand.ts:2031`)
**Severidade: BAIXO** | **Status: ABERTO**

```typescript
const useTty = false;  // todo o bloco if (useTty) é dead code
```

---

### ~~DC-03~~ — `createGitSyncCore` nunca importado fora dos testes
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`createGitSyncCore` é importado e usado em `gitCommand.ts:1957`. A lógica de sync de produção passa pelo core.

---

### DC-04 — Funções declaradas duas vezes com implementações ligeiramente diferentes
**Severidade: MÉDIO** | **Status: ABERTO**

`formatTransferDetail`, `parseMiB`, `formatObjects` e `formatRepoLabel` são declaradas como funções de módulo (linhas 1566, 1601, 1621, 1634) E redeclaradas como funções locais dentro do bloco `if (!session)` (linhas 2077, 2105, 2118, 2124). As versões de módulo externas só são usadas dentro do bloco TUI; as internas só dentro do bloco CLI. Consolidar em uma única declaração.

---

## 6. PROBLEMAS DE UX / FLUXO

### ~~UX-01~~ — Orientação exibe "C para filtrar"; atalho real é `Ctrl+M`
**Severidade: CRÍTICO** | **Status: RESOLVIDO**

Handler e textos de orientação alinhados. `Ctrl+M` para filtrar selecionados.

---

### ~~UX-02~~ — Orientação exibe "B para branch"; atalho real é `Ctrl+B`
**Severidade: ALTO** | **Status: RESOLVIDO**

Handler e textos de orientação alinhados. `Ctrl+B` para abrir branch modal.

---

### UX-04 — `HelpModal` não implementa scroll; hint promete `↑/↓ PgUp/PgDn`
**Severidade: ALTO** | **Status: ABERTO**

```typescript
// HelpModal.tsx:235 — corta silenciosamente; sem scroll
const visibleLines = lines.slice(0, contentHeight);
```

---

### UX-05 — `toggleModal` fecha modal "help" ao pressionar `Ctrl+P`
**Severidade: BAIXO** | **Status: ABERTO**

---

### ~~UX-06~~ — BUG-001 documentado ainda aberto: senha ausente em `git-server-store`
**Severidade: ALTO** | **Status: RESOLVIDO**

Resolvido com a correção do BUG-06 e atualização do teste. Ver `docs/bugs-conhecidos.md` BUG-001.

---

### UX-07 — Fluxo TUI: exceção em `serverResults` pode deixar estado indefinido
**Severidade: BAIXO** | **Status: ABERTO**

---

### UX-08 — `gitSyncService.ts` tem ~15 strings hardcoded em português, ignorando i18n
**Severidade: MÉDIO** | **Status: ABERTO**

Mensagens de erro SSH, log HTTP e warnings em `gitSyncService.ts` são strings literais em português. Não serão traduzidas para `en_US`.

---

### UX-09 — Default de `baseUrl` hardcoded para `"https://git.tse.jus.br"` (URL do TSE)
**Severidade: ALTO** | **Status: ABERTO**

```typescript
// gitCommand.ts:1687
resolveEnvOrCliString(options.baseUrl?.trim(), "baseUrl", "base-url", "https://git.tse.jus.br");
```

Todo usuário que não seja do TSE verá esse URL como sugestão padrão no modal de parâmetros do `git-server-store`. Deveria ser `""` ou `"https://gitlab.com"`.

---

## Resumo por Severidade

| Severidade | Qtd | Itens principais |
|---|---|---|
| **CRÍTICO** | 0 | — |
| **ALTO** | 5 | BUG-02, INC-06, REQ-02, REQ-03, UX-04, UX-09 |
| **MÉDIO** | 6 | BUG-03, BUG-07, I18N-03, DC-04, REQ-06, UX-08 |
| **BAIXO** | 9 | BUG-05, BUG-10, INC-05, INC-08, I18N-02, DC-01, DC-02, REQ-05, UX-05, UX-07 |

### Itens resolvidos desde a auditoria inicial

BUG-04, BUG-06, BUG-08, BUG-09, BUG-11, INC-01, INC-02, INC-03, INC-04, INC-07, DC-03, I18N-04, REQ-04, UX-01, UX-02, UX-06, REQ-01/UX-03 (17 itens)
