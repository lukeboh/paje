# Relatório de Auditoria — Projeto PAJE

Data: 2026-06-05

---

## 1. BUGS / COMPORTAMENTOS INCORRETOS

### ~~BUG-01~~ — `gitBranchService.ts:100` — DIVERGED exibido como AHEAD *(decisão de design — não é bug)*

> **Esclarecimento:** comportamento intencional documentado em `docs/requisitos-tui-git-sync.md` RF-03.
> Quando `ahead > 0` e `behind > 0`, o sistema exibe `state: "AHEAD"` para destacar a presença de commits locais não publicados — situação mais urgente do que commits remotos pendentes. O delta `+N/-M` ainda comunica a divergência. A cor azul (AHEAD) é preferida à magenta (DIVERGED) porque sinaliza a necessidade de `push` antes de qualquer pull.

---

### BUG-02 — `gitCommand.ts:890,981,1093` — Chaves i18n `cli.errors.gitlab.registerKey*` inexistentes
**Severidade: ALTO**

`t("cli.errors.gitlab.registerKeyDetails")` e `t("cli.errors.gitlab.registerKey")` chamadas em `ensureSshKey()` não existem em nenhum locale. Erros de registro de chave SSH exibirão a chave literal ao invés da mensagem.

---

### BUG-03 — `gitCommand.ts:1143` — Chave i18n `cli.prompt.verbose.title` inexistente
**Severidade: MÉDIO**

Título de modal exibirá `"cli.prompt.verbose.title"` literal.

---

### BUG-04 — `gitCommand.ts:2388` — Chave i18n `cli.log.syncNoMatch` inexistente
**Severidade: MÉDIO**

Deveria ser `cli.sync.noSyncMatches`. Mensagem de "nenhum repositório corresponde ao --sync-repos" exibe chave literal.

---

### BUG-05 — `gitCommand.ts:1692–1730` — Chaves `cli.prompt.parallel.*` inexistentes (12 chaves)
**Severidade: MÉDIO** (mitigado: função `resolveParallelOptions` é dead code — ver DC-01)

Chaves ausentes: `cli.prompt.parallel.title`, `level`, `auto`, `autoDesc`, `oneDesc`, `twoDesc`, `fourDesc`, `eightDesc`, `shallow`.

---

### BUG-06 — `gitCommand.ts:3175` — `useBasicAuth` padrão `true` em `git-server-store`
**Severidade: CRÍTICO**

```typescript
useBasicAuth: options.useBasicAuth ?? true,   // ← deveria ser ?? false
```

Executar `paje git-server-store` sem `--use-basic-auth` ativa autenticação básica por padrão, ignorando o fluxo SSH que é o comportamento esperado.

---

### BUG-07 — `gitCommand.ts` vs `gitSyncService.ts` — semântica invertida do campo `updated` em `mergeServer`
**Severidade: MÉDIO**

Em `gitCommand.ts`: novo servidor → `updated: false`, atualizado → `updated: true`.
Em `gitSyncService.ts`: ambos os casos → `updated: true`. Semânticas opostas para a mesma operação.

---

### BUG-08 — `gitCommand.ts` — `const resolvedPaths` redeclarado no mesmo bloco
**Severidade: BAIXO**

Duas declarações `const resolvedPaths` nas linhas 2333 e 2369 no mesmo escopo `if (!session)`.

---

### BUG-09 — `parallelSync.ts` — `ensureParentDir` usa binário `mkdir` externo
**Severidade: MÉDIO**

```typescript
await execFileAsync("mkdir", ["-p", path.dirname(targetPath)]);
```
Não portável. Deveria usar `fs.promises.mkdir(..., { recursive: true })` como o restante do código.

---

### BUG-10 — `gitCommand.ts:2927` — Chave i18n `cli.log.tuiUnavailable` inexistente
**Severidade: BAIXO** (código nunca alcançado em runtime)

---

### BUG-11 — `gitCommand.ts:1648` — `prepareTargets` ignora conflitos de caminho em multi-servidor
**Severidade: ALTO**

A função local usa `project.path_with_namespace` diretamente no `localPath`, ignorando `resolveLocalPathConflicts`. Em cenários multi-servidor com repos de mesmo nome, dois repositórios mapeiam para o mesmo diretório local. O `gitSyncService.ts` resolve corretamente.

---

## 2. INCONSISTÊNCIAS ENTRE ARQUIVOS

### INC-01 — Separador de branch em `syncRepos`: `#` no CLI vs `@` na TUI
**Severidade: ALTO**

`gitCommand.ts` (caminho CLI): `"grupo/repo.git#main"`.
`gitSyncService.ts` (caminho TUI): `"grupo/repo@main"`.
O README documenta `#`. Usuários que configuram via YAML não têm branch resolvida no caminho TUI.

---

### INC-02 — `GitServerEntry` declarado em dois arquivos sem relação entre si
**Severidade: MÉDIO**

Tipo duplicado em `gitCommand.ts:78` e `gitSyncService.ts:42`. Adições silenciosas em um não propagam para o outro.

---

### INC-03 — `buildSummary` em `gitSyncService.ts` usa estados inválidos
**Severidade: MÉDIO**

O tipo `RepoSyncState` define `"SYNCED"|"BEHIND"|"AHEAD"|"REMOTE"|"EMPTY"|"LOCAL"|"UNCOMMITTED"|"DIVERGED"`.
O `buildSummary` em `gitSyncService.ts` usa `UPDATED`, `UNPUSHED`, `CLONED`, `FAILED` (inexistentes no tipo) e omite `REMOTE`, `EMPTY`, `LOCAL`.

---

### INC-04 — `filterProjects` em `gitSyncService.ts` usa `includes()` em vez de Ant/Glob
**Severidade: ALTO**

```typescript
// gitSyncService.ts — busca simples por substring
normalizedPath.includes(normalizedFilter)

// gitCommand.ts — correto
compileAntPatterns / matchesAntPatterns  // suporta *, **, ?, múltiplos padrões
```

Usuário que define `filter: "grupo/**"` via YAML terá comportamento diferente entre CLI e TUI.

---

### INC-05 — `ensureLocalDirsIfNeeded`: cria diretório pai (TUI) vs diretório completo (CLI)
**Severidade: MÉDIO**

- `gitCommand.ts:485`: cria `targetPath` completo
- `gitSyncService.ts:338`: cria apenas `path.dirname(targetPath)`

Comportamento diferente para `--prepare-local-dirs`.

---

### INC-06 — `mergeServer` tem semântica de `updated` oposta entre os dois arquivos
**Severidade: MÉDIO**

Ver BUG-07. Em `gitSyncService.ts`, ambas as situações (novo ou existente) retornam `updated: true`.
Em `gitCommand.ts`, novo retorna `updated: false` e existente retorna `updated: true`.

---

### INC-07 — `gitSyncService.ts` não lista projetos públicos; o CLI lista
**Severidade: ALTO**

O caminho TUI omite completamente a chamada `api.listPublicProjects()`. Usuários via TUI não veem projetos públicos que não participam diretamente.

---

### INC-08 — `parallelSync`: parâmetro `onProgress` tem duas semânticas diferentes
**Severidade: BAIXO**

Terceiro parâmetro de `parallelSync` recebe `SyncResult` (resultado final), não progresso intermediário. Em `gitSyncService.ts` é chamado internamente de `onResult`. Nomenclatura enganosa.

---

## 3. CHAVES I18N FALTANDO / ÓRFÃS

### I18N-01 — Chaves usadas no código mas ausentes em ambos os locales

| Chave | Arquivo:Linha | Observação |
|---|---|---|
| `cli.errors.gitlab.registerKeyDetails` | `gitCommand.ts:890,981,1093` | Critica — exibida em erros de SSH |
| `cli.errors.gitlab.registerKey` | `gitCommand.ts:896,987,1099` | Critica — exibida em erros de SSH |
| `cli.prompt.verbose.title` | `gitCommand.ts:1143` | Título de modal |
| `cli.log.syncNoMatch` | `gitCommand.ts:2388` | Confusão com `cli.sync.noSyncMatches` |
| `cli.log.tuiUnavailable` | `gitCommand.ts:2927` | Dead code, mas ausente |
| `cli.prompt.parallel.title` | `gitCommand.ts:1692` | Dead code |
| `cli.prompt.parallel.level` | `gitCommand.ts:1693` | Dead code |
| `cli.prompt.parallel.auto` | `gitCommand.ts:1695` | Dead code |
| `cli.prompt.parallel.autoDesc` | `gitCommand.ts:1695` | Dead code |
| `cli.prompt.parallel.oneDesc` | `gitCommand.ts:1696` | Dead code |
| `cli.prompt.parallel.twoDesc` | `gitCommand.ts:1697` | Dead code |
| `cli.prompt.parallel.fourDesc` | `gitCommand.ts:1698` | Dead code |
| `cli.prompt.parallel.eightDesc` | `gitCommand.ts:1699` | Dead code |
| `cli.prompt.parallel.shallow` | `gitCommand.ts:1704` | Dead code |

---

### I18N-02 — Chave `cli.log.preselection` definida mas nunca usada no código
**Severidade: BAIXO**

Presente em `pt_BR.ts:181` e `en_US.ts:181`. Nenhuma ocorrência em `src/`. Chave órfã.

---

### I18N-03 — `en_US.ts` não é verificado pelo compilador
**Severidade: MÉDIO**

`types.ts` usa apenas `PtBrTranslations`. Chaves adicionadas a `pt_BR` e omitidas em `en_US` não causam erro de compilação. Recomendação: `export type LocaleTranslations = PtBrTranslations & EnUsTranslations` ou verificação estrutural explícita.

---

## 4. REQUISITOS vs CÓDIGO

### REQ-01 / UX-03 — Atalho "S" documentado; código usa "Enter" e "Ctrl+S" com semântica invertida
**Severidade: CRÍTICO**

Orientação exibida na TUI (`pt_BR.ts:92–93`):
```
"S para sincronizar tudo | Ctrl+S para sincronizar apenas o escopo destacado"
```

Código real (`tui.app.tsx`):
- `Enter` → sincroniza escopo destacado (single)
- `Ctrl+S` → sincroniza todos (all)
- `S` puro → **não faz nada**

O atalho `S` não existe na implementação. A descrição de `Ctrl+S` está invertida em relação ao comportamento real.

---

### REQ-02 — `docs/requisitos-tui-git-sync.md` RF-08: Modal de resumo final não implementada
**Severidade: ALTO**

Requisito pede modal com tempo total, contagem de ações e lista ordenada de repositórios com métricas. Código entrega apenas logs no painel de log.

---

### REQ-03 — `docs/requisitos-tui-git-sync.md` RF-06: Remoção de repositórios desmarcados inconsistente
**Severidade: ALTO**

Bug documentado em `docs/bugs-conhecidos.md` como aberto (BUG-004). Remoção não respeita escopo correto (linha vs grupo) nem as regras de exclusão segura para estados UNCOMMITTED/AHEAD/DIVERGED.

---

### REQ-04 — README cita `F12` para log em tela cheia; código usa `Ctrl+L`
**Severidade: MÉDIO**

`F12` não aparece em nenhum handler de input. O atalho real é `Ctrl+L` em `layout.tsx`.

---

### REQ-05 — `docs/requisitos-tui-git-sync.md` RF-01: Spinner de loading não disponível no caminho `gitSyncService`
**Severidade: BAIXO**

O spinner existe apenas no caminho `gitCommand.ts`. O `gitSyncService.loadTree()` não emite eventos de progresso HTTP para consumidores externos.

---

### REQ-06 — `docs/requisitos-tui-git-sync.md` RU-03: Painel de log deve iniciar em nível `warn`; inicia em `info`
**Severidade: MÉDIO**

```typescript
// logStore.ts:17
private minLevel: LogLevel = "info";  // deveria ser "warn" conforme RU-03
```

---

## 5. DEAD CODE / CÓDIGO NUNCA ALCANÇADO

### DC-01 — `resolveParallelOptions()` nunca é chamada (`gitCommand.ts:1689`)
**Severidade: BAIXO**

Função declarada mas não invocada em nenhum lugar do código. Carrega 12 chaves i18n inexistentes.

---

### DC-02 — `useTty = false` torna ~150 linhas de renderização TTY inacessíveis (`gitCommand.ts:2422`)
**Severidade: BAIXO**

```typescript
const useTty = false;  // todo o bloco if (useTty) é dead code
```

Inclui lógica de cursor save/restore, renderBlock, workerLines e progressBar avançado.

---

### DC-03 — `createGitSyncCore` (`gitSyncService.ts`) nunca é importado fora dos testes
**Severidade: MÉDIO**

O módulo `gitSyncService.ts` não é importado por nenhum arquivo em `src/`. Toda a lógica de sync da TUI passa por `gitCommand.ts`. Resultado: duas implementações paralelas divergentes, ambas incompletas, nenhuma sendo a canônica em produção.

---

### DC-04 — Funções declaradas duas vezes com implementações ligeiramente diferentes
**Severidade: MÉDIO**

`formatTransferDetail`, `parseMiB`, `formatObjects` e `formatRepoLabel` são declaradas como funções de módulo E redeclaradas como funções locais dentro do bloco `if (!session)` de `gitCommand.ts`, com implementações ligeiramente diferentes (ex.: `"?"` vs `"…"` no truncamento). As versões externas nunca são chamadas.

---

## 6. PROBLEMAS DE UX / FLUXO

### UX-01 — Orientação exibe "C para filtrar"; atalho real é `Ctrl+M`
**Severidade: CRÍTICO**

```
pt_BR.ts:92: "C para filtrar selecionados"
```
```typescript
// tui.app.tsx — atalho real
if (key.ctrl && lower === "m") { toggleSelectionFilter(); }
```

O usuário que pressionar `C` não verá nenhuma resposta.

---

### UX-02 — Orientação exibe "B para branch"; atalho real é `Ctrl+B`
**Severidade: ALTO**

```
pt_BR.ts:92: "B para branch"
```
```typescript
// tui.app.tsx — atalho real
if (key.ctrl && lower === "b") { openBranchModal(); }
```

---

### UX-03 — Ver REQ-01 acima.

---

### UX-04 — `HelpModal` não implementa scroll; hint promete `↑/↓ PgUp/PgDn`
**Severidade: ALTO**

```typescript
// HelpModal.tsx:235 — corta silenciosamente; sem scroll
const visibleLines = lines.slice(0, contentHeight);
```

O hint exibido diz `"↑/↓ PgUp/PgDn para rolar"` mas nenhum handler de teclado implementa scroll no componente. Em terminais com menos de ~20 linhas, shortcuts da seção "tree" ficam invisíveis.

---

### UX-05 — `toggleModal` fecha modal "help" ao pressionar `Ctrl+P`
**Severidade: BAIXO**

Se a modal "help" estiver aberta e o usuário pressionar `Ctrl+P`, `toggleModal()` fecha a help em vez de abrir a de parâmetros.

---

### UX-06 — BUG-001 documentado ainda aberto: senha ausente em `git-server-store`
**Severidade: ALTO**

Conforme `docs/bugs-conhecidos.md` BUG-001. O fluxo de `storeSshKeyOnly()` pode falhar dependendo da ausência de `cli.password` em determinados caminhos.

---

### UX-07 — Fluxo TUI: exceção inesperada em `serverResults` pode deixar estado indefinido
**Severidade: BAIXO**

Se `Promise.all(servers.map(...))` rejeitar por razão não coberta pelos try/catch internos, o `loadingHandle` é encerrado pelo `.finally()` mas a aplicação não trata a rejeição propagada.

---

### UX-08 — `gitSyncService.ts` tem ~15 strings hardcoded em português, ignorando i18n
**Severidade: MÉDIO**

Mensagens de erro SSH, log HTTP e warnings em `gitSyncService.ts` são strings literais em português. Não serão traduzidas para `en_US`.

Exemplos:
- `"A chave vinculada em ~/.ssh/config para ${server} não existe (${associatedIdentityPath})."`
- `"Nenhuma chave SSH configurada em ~/.ssh. Configure uma chave para continuar."`
- Mensagens de log HTTP nas linhas 548–556

---

### UX-09 — Default de `baseUrl` hardcoded para `"https://git.tse.jus.br"` (URL do TSE)
**Severidade: ALTO**

```typescript
// gitCommand.ts:1907
const baseUrlResolution = resolveEnvOrCliString(options.baseUrl?.trim(), "baseUrl", "base-url", "https://git.tse.jus.br");
```

Todo usuário que não seja do TSE verá esse URL como sugestão padrão no modal de parâmetros do `git-server-store`. Deveria ser `""` ou `"https://gitlab.com"`.

---

## Resumo por Severidade

| Severidade | Qtd | Itens |
|---|---|---|
| **CRÍTICO** | 4 | BUG-06, REQ-01/UX-03, UX-01 |
| **ALTO** | 11 | BUG-02, BUG-11, INC-01, INC-04, INC-07, REQ-02, REQ-03, UX-02, UX-04, UX-06, UX-09 |
| **MÉDIO** | 11 | BUG-03, BUG-04, BUG-07, BUG-09, INC-02, INC-03, INC-05, I18N-03, DC-03, DC-04, REQ-06, UX-08 |
| **BAIXO** | 9 | BUG-05, BUG-08, BUG-10, INC-08, I18N-02, DC-01, DC-02, REQ-04, REQ-05, UX-05, UX-07 |
