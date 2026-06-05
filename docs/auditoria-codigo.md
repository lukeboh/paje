# Relatório de Auditoria — Projeto PAJE

Data: 2026-06-05 (revisada 2026-06-05 pós refatoração)

---

## 1. BUGS / COMPORTAMENTOS INCORRETOS

### ~~BUG-01~~ — `gitBranchService.ts:100` — DIVERGED exibido como AHEAD *(decisão de design — não é bug)*

> **Esclarecimento:** comportamento intencional documentado em `docs/requisitos-tui-git-sync.md` RF-03.
> Quando `ahead > 0` e `behind > 0`, o sistema exibe `state: "AHEAD"` para destacar a presença de commits locais não publicados. O delta `+N/-M` ainda comunica a divergência.

---

### ~~BUG-02~~ — `gitCommand.ts` — Chaves i18n `cli.errors.gitlab.registerKey*` inexistentes
**Severidade: ALTO** | **Status: RESOLVIDO**

A função `ensureSshKey()` que chamava `t("cli.errors.gitlab.registerKeyDetails")` e `t("cli.errors.gitlab.registerKey")` foi removida na refatoração para separação de camadas. O código atual usa `cli.errors.gitlab.registerKeyFail` (adicionado em UX-08), que existe em ambos os locales.

---

### ~~BUG-03~~ — `gitCommand.ts` — Chave i18n `cli.prompt.verbose.title` inexistente
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Chave adicionada a `pt_BR.ts` e `en_US.ts` como `cli.prompt.verbose.title` ("SSH - Detalhes" / "SSH - Details"). Usada como título do modal que exibe saída verbose do `addHostToKnownHosts` na TUI.

---

### BUG-04 — `gitCommand.ts` — Chave i18n `cli.log.syncNoMatch` inexistente
**Severidade: MÉDIO** | **Status: RESOLVIDO**

A chamada foi removida com a Fase 2. A lógica de "nenhum repositório corresponde" passou para o core, que usa `cli.sync.noSyncMatches`.

---

### ~~BUG-05~~ — `gitCommand.ts` — Chaves `cli.prompt.parallel.*` inexistentes (9 chaves)
**Severidade: BAIXO** | **Status: RESOLVIDO**

A função `resolveParallelOptions` (dead code) foi removida junto com as 9 chamadas a chaves inexistentes. Ver DC-01.

---

### ~~BUG-06~~ — `gitCommand.ts` — `useBasicAuth` padrão `true` em `git-server-store`
**Severidade: CRÍTICO** | **Status: RESOLVIDO**

O fluxo `storeSshKeyOnly()` podia deixar de exibir detalhes do token existente porque `useBasicAuth`
defaultava incorretamente para `true`. Corrigido para `useBasicAuth: options.useBasicAuth ?? false`.
O fluxo SSH é agora o padrão correto. Teste `ssh_key_store_command_test.ts` atualizado para incluir
`--use-basic-auth`. Ver também UX-06.

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

### ~~BUG-10~~ — `gitCommand.ts` — Chave i18n `cli.log.tuiUnavailable` inexistente
**Severidade: BAIXO** | **Status: RESOLVIDO**

Chave adicionada a `pt_BR.ts` e `en_US.ts` como `cli.log.tuiUnavailable` ("Sessão TUI indisponível." / "TUI session unavailable.").

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

### ~~INC-08~~ — `parallelSync`: parâmetro `onProgress` tem duas semânticas diferentes
**Severidade: BAIXO** | **Status: RESOLVIDO**

Terceiro parâmetro renomeado de `onProgress` para `onResult` em `parallelSync.ts` e em todos os call sites. Nomenclatura agora reflete corretamente o recebimento de `SyncResult`.

---

## 3. CHAVES I18N FALTANDO / ÓRFÃS

### I18N-01 — Chaves usadas no código mas ausentes em ambos os locales

| Chave | Arquivo:Linha | Status |
|---|---|---|
| `cli.errors.gitlab.registerKeyDetails` | `gitCommand.ts:705,796,908` | RESOLVIDO — código removido |
| `cli.errors.gitlab.registerKey` | `gitCommand.ts:711,802,914` | RESOLVIDO — código removido |
| `cli.prompt.verbose.title` | `gitCommand.ts:958` | RESOLVIDO — chave adicionada |
| `cli.log.tuiUnavailable` | `gitCommand.ts:2470` | RESOLVIDO — chave adicionada |
| `cli.prompt.parallel.title` | `gitCommand.ts:1492` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.level` | `gitCommand.ts:1493` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.auto` | `gitCommand.ts:1495` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.autoDesc` | `gitCommand.ts:1495` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.oneDesc` | `gitCommand.ts:1496` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.twoDesc` | `gitCommand.ts:1497` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.fourDesc` | `gitCommand.ts:1498` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.eightDesc` | `gitCommand.ts:1499` | RESOLVIDO — função removida (DC-01) |
| `cli.prompt.parallel.shallow` | `gitCommand.ts:1504` | RESOLVIDO — função removida (DC-01) |

---

### ~~I18N-02~~ — Chave `cli.log.preselection` definida mas nunca usada
**Severidade: BAIXO** | **Status: RESOLVIDO**

Chave órfã removida de `pt_BR.ts` e `en_US.ts`.

---

### ~~I18N-03~~ — `en_US.ts` não era verificado pelo compilador
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`en_US.ts` agora importa e usa `PtBrTranslations` como anotação de tipo (`const enUS: PtBrTranslations = {...}`). Qualquer chave adicionada a `pt_BR` e omitida em `en_US` passa a causar erro de compilação.

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

Remoção não respeita escopo correto (linha vs grupo) nem as regras de exclusão segura para estados UNCOMMITTED/AHEAD/DIVERGED.

**Regras esperadas (referência do produto):**
1. A diferença entre **Ctrl+S** (escopo da linha/grupo destacado) e **S** (todas as linhas) é apenas a quantidade de repositórios afetados; as regras de seleção/remoção são idênticas.
2. Linha selecionada com **X**: clone se não existir diretório local; pull+push se já existir.
3. Linha não selecionada com diretório local e sem pendências de push (não AHEAD nem UNCOMMITTED): pode deletar o diretório local.
4. Linha não selecionada com status UNCOMMITTED ou AHEAD: pedir confirmação explícita antes de deletar.

**Impacto:** Risco de remoção de diretórios fora do escopo pretendido; possibilidade de perda de alterações locais.

**Workaround:** Evitar remover repositórios locais via TUI até correção; fazer limpeza manual com verificação de status.

---

### ~~REQ-04~~ — README cita `F12` para log em tela cheia; código usa `Ctrl+L`
**Severidade: MÉDIO** | **Status: RESOLVIDO**

README, `TUI-leiaute.md` e `requisitos-tui-git-sync.md` atualizados com `Ctrl+L`. Todos os atalhos agora refletem o código.

---

### ~~REQ-05~~ — `docs/requisitos-tui-git-sync.md` RF-01: Spinner de loading não disponível no caminho `gitSyncService`
**Severidade: BAIXO** | **Status: RESOLVIDO**

`GitSyncLoadOptions` expõe `onRequestStart?: (serverName, requestCount) => void`. A TUI usa esse callback para atualizar o spinner de carregamento (`gitSyncService.ts:74,558`).

---

### ~~REQ-06~~ — `logStore.ts` — Painel de log iniciava em nível `info`; RU-03 exige `warn`
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`logStore.ts:17` corrigido de `"info"` para `"warn"`. O painel TUI agora filtra mensagens de nível `info` por padrão, reduzindo o ruído visual e alinhando com RU-03.

---

## 5. DEAD CODE / CÓDIGO NUNCA ALCANÇADO

### ~~DC-01~~ — `resolveParallelOptions()` nunca era chamada
**Severidade: BAIXO** | **Status: RESOLVIDO**

Função removida de `gitCommand.ts`. Eliminadas as 9 chamadas a chaves `cli.prompt.parallel.*` inexistentes (resolve também BUG-05).

---

### ~~DC-02~~ — `useTty = false` tornava ~150 linhas inacessíveis em `gitCommand.ts`
**Severidade: BAIXO** | **Status: RESOLVIDO**

Removidos: `useTty`, `overallLine`, `blockLines`, `workerStates`, `completedTargets`, `lastPrinted`, `historyLines` e as funções `saveCursor`, `restoreCursor`, `renderBlock`, `appendHistoryLine`, `buildWorkerPlaceholder`. Todos os blocos `if (useTty)` foram removidos e os blocos `if (!useTty)` tiveram os guards eliminados. Comportamento em runtime preservado.

---

### ~~DC-03~~ — `createGitSyncCore` nunca importado fora dos testes
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`createGitSyncCore` é importado e usado em `gitCommand.ts:1957`. A lógica de sync de produção passa pelo core.

---

### ~~DC-04~~ — Funções declaradas duas vezes com implementações ligeiramente diferentes
**Severidade: MÉDIO** | **Status: RESOLVIDO**

As redeclarações locais de `formatTransferDetail`, `parseMiB`, `formatObjects` e `formatRepoLabel` foram removidas. As versões de módulo são agora usadas por ambos os caminhos (TUI e CLI). Aproveitou-se para corrigir `formatRepoLabel` module-level: trocou `?` por `…` para alinhar com a versão local.

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

### ~~UX-05~~ — `toggleModal` fecha modal "help" ao pressionar `Ctrl+P`
**Severidade: BAIXO** | **Status: RESOLVIDO**

`layoutContext.ts`: ramo `if (current && modalType === "help")` removido de `toggleModal`. Pressionar `Ctrl+P` com qualquer modal aberta agora transiciona para a modal de parâmetros.

---

### ~~UX-06~~ — Senha ausente no fluxo `git-server-store`
**Severidade: ALTO** | **Status: RESOLVIDO**

Resolvido com a correção do BUG-06 e atualização do teste. Ver BUG-06 acima.

---

### ~~UX-07~~ — Fluxo TUI: exceção em `serverResults` pode deixar estado indefinido
**Severidade: BAIXO** | **Status: RESOLVIDO**

`loadTree()` agora envolve as chamadas de API de cada servidor em `try/catch`, retornando `null` em caso de falha. O filtro `validServerResults.filter(result => result !== null)` já existia para lidar com nulls — agora é ativado de facto em falhas de rede, sem abortar o carregamento completo.

---

### ~~UX-08~~ — `gitSyncService.ts` tem ~15 strings hardcoded em português, ignorando i18n
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Todas as strings hardcoded substituídas por `t()`. 8 reaproveitam chaves existentes; 3 chaves novas criadas: `cli.prompt.sshKey.noKeyInSsh`, `cli.errors.gitlab.registerKeyFail`, `cli.sync.usernameMissingBasicAuth`. Regra adicionada ao `CLAUDE.md` para prevenir recorrência.

---

### ~~UX-09~~ — Default de `baseUrl` hardcoded para `"https://git.tse.jus.br"` (URL do TSE)
**Severidade: ALTO** | **Status: RESOLVIDO**

Substituído por `"https://gitlab.com"` em `gitCommand.ts`.

---

### ~~UX-10~~ — Comportamento do Esc inconsistente entre telas
**Severidade: ALTO** | **Status: RESOLVIDO**

O Esc deveria respeitar a hierarquia: (1) fechar modal ativa; (2) restaurar painel maximizado; (3) voltar para a tela anterior; (4) sair da aplicação se já no menu principal. O handler foi centralizado no layout para aplicar exatamente essa ordem de prioridade.

---

### ~~UX-11~~ — Mensagens de log da sincronização fora do padrão
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Ao selecionar S para sincronizar, a mensagem genérica exibida no painel de log e o texto estático na área de trabalho ("Acessando servidores e carregando repositórios - requisições: N") não espelhavam os logs do CLI nem transmitiam progresso real. Corrigido: logs de carregamento HTTP e progresso do sync agora são direcionados ao painel TUI com o mesmo texto e ordem do CLI; mensagens genéricas removidas; logs verbose da API passam a aparecer no painel TUI.

---

## Resumo por Severidade

| Severidade | Qtd | Itens principais |
|---|---|---|
| **CRÍTICO** | 0 | — |
| **ALTO** | 4 | INC-06, REQ-02, REQ-03, UX-04 |
| **MÉDIO** | 1 | BUG-07 |
| **BAIXO** | 0 | — |

### Itens resolvidos desde a auditoria inicial

BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-08, BUG-09, BUG-10, BUG-11, INC-01, INC-02, INC-03, INC-04, INC-07, INC-08, DC-01, DC-02, DC-03, DC-04, I18N-02, I18N-03, I18N-04, REQ-04, REQ-05, REQ-06, UX-01, UX-02, UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, REQ-01/UX-03 (35 itens)

---

## Como registrar novos itens

1. Escolha a seção adequada (BUGS, INCONSISTÊNCIAS, I18N, REQUISITOS, DEAD CODE ou UX/FLUXO) e atribua o próximo número sequencial dentro da seção (ex.: BUG-12, UX-12).
2. Indique severidade (CRÍTICO / ALTO / MÉDIO / BAIXO) e status (ABERTO / RESOLVIDO).
3. Descreva o comportamento esperado e o comportamento atual.
4. Inclua passos de reprodução, impacto e workaround (se existir).
5. Ao resolver, atualize o status, registre a solução aplicada e mova o identificador para a lista de itens resolvidos no Resumo.
6. Execute `npm run build && npm test` antes de fechar o item.
