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

### ~~BUG-12~~ — `parallelSync.ts` — `hasGitDir` local chamava o binário POSIX `test`, quebrando no Windows
**Severidade: ALTO** | **Status: RESOLVIDO**

`parallelSync.ts` tinha sua própria cópia de `hasGitDir` que detectava um repositório
já clonado via `execFile("test", ["-d", gitDir])` — `test` é um binário/builtin do
shell POSIX inexistente no Windows. A chamada falhava silenciosamente lá (erro
engolido por `.then(() => true, () => false)`), então todo repositório era tratado
como "não clonado ainda", mesmo os já existentes, quebrando a detecção de status.
Além do bug de portabilidade, era uma duplicata: `gitRepoScanner.ts` já exportava um
`hasGitDir` correto e portátil (via `fs.promises.stat`). Corrigido removendo a cópia
local e importando a versão de `gitRepoScanner.ts` (`parallelSync.ts:8`). Teste de
regressão em `tests/git_has_git_dir_portable_test.ts`.

---

### ~~BUG-13~~ — `sshManager.ts` — `ensurePajeKeyPair` quebrava ao sobrescrever a mesma chave duas vezes no Windows
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Ao sobrescrever uma chave SSH existente, o código renomeava a chave antiga para
`.bak` via `fs.renameSync`. No POSIX, `rename()` sobrescreve silenciosamente um
destino já existente; no Windows, `fs.renameSync` lança `EEXIST` nesse caso — então
sobrescrever a mesma chave uma segunda vez (deixando um `.bak` da primeira vez)
falhava só nesse SO. Corrigido em `sshManager.ts` removendo qualquer `.bak`/`.pub.bak`
pré-existente antes de renomear. Teste de regressão em
`tests/ssh_key_overwrite_repeated_test.ts` (simula o `EEXIST` do Windows trocando
`fs.renameSync` por uma versão mais estrita, mesmo rodando em Linux).

---

### ~~BUG-14~~ — `HelpModal.tsx` — modal de ajuda sem rolagem, com grupos inaplicáveis desperdiçando espaço
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Duas causas somadas podiam deixar atalhos de verdade impossíveis de ver: (1)
`buildLines` sempre renderizava TODOS os grupos de atalhos (global, menu,
árvore), mesmo os que não se aplicam à tela atual — só ficavam "apagados"
(`dimColor`), mas ainda ocupavam linhas; (2) o modal tinha altura fixa
(`lines.slice(0, contentHeight)`) e nenhuma forma de rolar — `↑`/`↓` eram
tratados como tentativas de executar o atalho `tree-nav-vertical` (que usa
essas mesmas teclas), fechando a ajuda e movendo o cursor da árvore por trás
dela, em vez de navegar dentro do próprio modal. Corrigido: `buildLines` só
inclui grupos com pelo menos um atalho aplicável ao contexto atual, e
`↑`/`↓`/`PgUp`/`PgDn` agora rolam a lista (mesmo padrão de
`scrollOffset`/`maxOffset` já usado em `ParametersModal.tsx`) antes de
qualquer tentativa de re-executar o atalho. Teste de regressão em
`tests/tui_help_modal_context_test.ts`.

---

### BUG-15 — `Key.home`/`Key.end` nunca são verdadeiros nesta versão do Ink — atalhos "Home/End" são código morto
**Severidade: BAIXO** | **Status: ABERTO**

Descoberto ao investigar BUG-14: `ink@5.2.1`'s `useInput` (`node_modules/ink/build/hooks/use-input.js`)
constrói o objeto `key` só com `upArrow`, `downArrow`, `leftArrow`, `rightArrow`,
`pageUp`, `pageDown`, `return`, `escape`, `ctrl`, `shift`, `tab`, `backspace`,
`delete`, `meta` — nunca `home`/`end`, mesmo quando `parse-keypress.js` já
reconhece as sequências ANSI correspondentes (`keypress.name === "home"/"end"`).
Qualquer código que checa `(key as Key & { home?: boolean; end?: boolean }).home`/`.end`
nunca é executado. Afeta pelo menos: `tui.app.tsx` (atalho "Home/End — ir ao
início/fim" da árvore, documentado em `docs/requisitos-tui-git-sync.md` RF-05
e no próprio `HelpModal`) e `resolveShortcutKey` em `HelpModal.tsx` (nunca
resolve "Home"/"End" para re-executar como atalho). Não corrigido agora por
estar fora do escopo da tarefa que o encontrou — precisa de uma forma
alternativa de detectar essas teclas (ex.: reconhecer a sequência bruta antes
do parse do Ink, ou atualizar o Ink) antes de poder corrigir.

---

### ~~BUG-16~~ — `loadTree()` pulava a checagem de `known_hosts` no caminho de cache-hit, travando sincronizações em paralelo
**Severidade: ALTO** | **Status: RESOLVIDO**

`ensureKnownHost`/`hasValidSshAssociation` só rodavam dentro do laço de
busca por servidor na API (via `ensureSshKey`) — pulado inteiramente quando
`loadTree()` responde a partir de `~/.paje/git-tree-cache.json`. Numa
máquina onde `~/.paje` existe mas `~/.ssh/known_hosts` está incompleto para
algum host, a primeira operação SSH real só acontecia dentro do
`syncSelected()`, com N clones/fetches em paralelo cada um preso numa
pergunta interativa do SSH que nenhum processo em segundo plano consegue
responder — travando a sincronização inteira sem nenhuma mensagem de erro.
Corrigido com `ensureKnownHostsForServers()`, chamada incondicionalmente
logo após `listServers()` em `loadTree()` (antes até da checagem de cache) —
ver "Garantia de `known_hosts` antes de qualquer operação git" em
`arquitetura.md`. Coberto por `tests/git_sync_known_hosts_test.ts`.

---

### ~~BUG-17~~ — Cadastro de servidor incompleto (sem token/chave SSH) não bloqueava a sincronização
**Severidade: ALTO** | **Status: RESOLVIDO**

Nos dois pontos de `gitCommand.ts` que registram um servidor na hora
(`--server-name`/`--base-url` via CLI, e o cadastro interativo quando
nenhum servidor existe ainda), o código já gravava a entrada em
`~/.paje/git-servers.json` assim que nome/URL eram informados e rodava
`ensureServerHasCredentials` — mas nunca verificava se esse bootstrap
realmente terminou com uma credencial usável antes de seguir adiante. Se o
bootstrap fosse cancelado/falhasse (ex.: senha vazia), o fluxo caía direto
em `core.loadTree()`, que tentava o MESMO bootstrap de novo por dentro do
`onMissingCredentials` (pedindo a senha uma segunda vez) e, se também
falhasse ali, só avisava de forma genérica (`cli.sync.noAuthConfigured`) e
pulava o servidor — em vez de deixar claro, logo no cadastro, que ele não
ficou pronto pra sincronizar. Corrigido com `hasUsableServerCredentials()`
(token ou chave SSH válida), verificada logo após cada um dos dois
bootstraps; se ainda faltar credencial, avisa com uma mensagem específica
(`cli.prompt.gitlab.registrationIncomplete`) e retorna sem chegar a
`loadTree()`. O servidor incompleto continua persistido (pro bootstrap
automático de sempre tentar de novo na próxima execução), só a
sincronização desta execução é que é barrada. Coberto por
`tests/git_sync_registration_incomplete_test.ts` (prova a diferença via
contagem de prompts de senha: 1 com a correção, 2 sem ela).

---

### ~~BUG-18~~ — Remoção de repositório desmarcado usava um `statusMap` desatualizado no caminho de cache-hit
**Severidade: ALTO** | **Status: RESOLVIDO**

`gitCommand.ts`'s `onConfirm` decidia se removia a cópia local de um
repositório desmarcado lendo `statusMap[project.id]` — um retrato tirado
uma única vez, no exato momento em que `loadTree()` respondeu. No caminho
de cache-hit (`core/gitSyncService.ts`), esse retrato É o `statusMap` da
execução ANTERIOR (`cached.statusMap`); o status de verdade só é
recalculado depois, em segundo plano (`setImmediate`), e entregue
incrementalmente via `onStatusRefreshed` — que atualiza `node.status` de
cada nó da própria árvore (o mesmo objeto que `loadTree()` devolveu), não
esse `statusMap` separado, que nunca mais é tocado no resto da sessão. Um
repositório que estava `EMPTY` no cache anterior mas foi clonado
manualmente desde então continuava aparecendo como `EMPTY` no `statusMap`
indefinidamente — e a remoção era pulada em silêncio, mesmo com a árvore
mostrando o status correto na tela. Corrigido lendo `node.status` (o valor
ao vivo) em vez de `statusMap[project.id]` (o retrato antigo) — a
divergência entre os dois é coberta isoladamente por
`tests/git_sync_stale_statusmap_test.ts`, provando que `statusMap` fica
estagnado enquanto `node.status` reflete o estado real assim que o refresh
em segundo plano termina.

---

### ~~BUG-19~~ — TUI do PAJÉ no Windows travava sem responder a nenhuma tecla após carregar a árvore
**Severidade: CRÍTICO** | **Status: RESOLVIDO**

No Windows, o executável `paje.cmd` invocava o script via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0paje.ps1" %*`. A execução de `powershell -File` a partir do `cmd.exe` ou PowerShell iniciava um processo PowerShell não-interativo que encapsulava os streams de `stdio` (`stdin`/`stdout`), impedindo que o Node.js e a biblioteca `Ink` assumissem o modo bruto TTY (`setRawMode(true)`). Com isso, os eventos de teclado via `useInput` não eram recebidos pela TUI e a tela ficava congelada. Corrigido reescrevendo `paje.cmd` como um script em lote batch nativo (`call npm run dev -- %*`) e atualizando `install-paje.ps1` para executar `paje.ps1` diretamente no `$PROFILE` do PowerShell.

---

### ~~BUG-20~~ — Ao sair do PAJÉ no Windows, permanecia em uma tela em branco exigindo `Ctrl+C` e prompt "Deseja finalizar o arquivo em lotes (S/N)?"
**Severidade: ALTO** | **Status: RESOLVIDO**

Consequência direta da estrutura de processos intermediária descrita no BUG-19: o processo `cmd.exe` executava `paje.cmd` aguardando os handles do processo filho `powershell.exe -File`. Quando o Node.js finalizava a execução da TUI, o processo intermediário do PowerShell permanecia preso aguardando a finalização dos handles de stream, deixando a janela em branco até que o usuário pressionasse `Ctrl+C` — o que acionava a interrupção nativa do `cmd.exe` perguntando `Deseja finalizar o arquivo em lotes (S/N)?`. Eliminado ao remover a camada intermediária do `powershell -File` em `paje.cmd` e `install-paje.ps1`.

---

### BUG-21 — Escopos padrão do token gerado automaticamente podem não incluir permissão de push
**Severidade: A INVESTIGAR** | **Status: ABERTO** (registrado a partir de suspeita relatada pelo usuário — ainda não confirmado nem corrigido)

`DEFAULT_TOKEN_SCOPES` (`sshManager.ts:365`, espelhado em `envTemplate.ts:79` e em
três pontos de `gitCommand.ts`) é
`["read_repository", "read_api", "read_virtual_registry", "self_rotate"]` — os
quatro escopos são de **leitura**; nenhum inclui `write_repository` (o escopo
do GitLab que autoriza `git push` sobre HTTPS usando o próprio PAT). Se um
servidor estiver configurado com `useBasicAuth` (HTTPS + PAT, sem chave SSH), um
token criado com esses escopos padrão permitiria `clone`/`pull` mas rejeitaria
`push` — sem nenhum aviso no momento do cadastro, já que `hasUsableServerCredentials()`
(ver BUG-17) só verifica se existe *algum* token/chave, não se os escopos
persistidos são suficientes para escrita. Ainda não confirmado experimentalmente
contra um GitLab real, nem se o fluxo recomendado (chave SSH, que não passa por
escopo de token nenhum) mitiga isso na prática para quem não usa
`useBasicAuth`. **Próximo passo, antes de qualquer correção**: reproduzir um
`git push` num repositório clonado via token com os escopos padrão e confirmar
se falha; se confirmado, avaliar se `write_repository` deveria entrar no
default, ou se o cadastro deveria avisar explicitamente que os escopos padrão
são somente leitura.

---

### ~~BUG-22~~ — Pré-seleção no cache-hit vinha do `statusMap` do cache (uma sessão atrasado), clonando repositórios nunca marcados e removendo clones recém-feitos
**Severidade: CRÍTICO** | **Status: RESOLVIDO**

No caminho de cache-hit de `loadTree()` (`core/gitSyncService.ts`), a
pré-seleção dos checkboxes (`applyInitialSelectionFromStatusMap`) usava
`cached.statusMap` — o retrato gravado no **load da sessão anterior**, ou
seja, **antes** do sync/remoções daquela sessão e de qualquer exclusão manual
feita no disco desde então. Duas consequências, relatadas pelo usuário como
"o Ctrl+S sincroniza todos os repositórios, mesmo os não marcados com x":

- **(a)** um repositório cujo clone local não existia mais (apagado
  manualmente, ou removido pelo próprio PAJÉ na sessão anterior) constava
  como `SYNCED` no cache → entrava **pré-selecionado `[x]`** → o `Ctrl+S` o
  **clonava de volta** sem o usuário jamais tê-lo marcado — e depois era
  preciso apagar tudo na mão;
- **(b)** um repositório clonado durante a sessão anterior constava como
  `EMPTY` no cache → entrava **desmarcado `[ ]`** apesar de clonado → virava
  candidato a remoção no `Ctrl+S` e, para estados limpos
  (`shouldConfirmRemoval` só pergunta em `UNCOMMITTED`/`AHEAD`/`DIVERGED`),
  era **removido silenciosamente**; na sessão seguinte, o cache (já
  atualizado pelo refresh) o pré-selecionava e o `Ctrl+S` o re-clonava —
  oscilação remove/clona entre sessões.

O item (b) ficou visível justamente após a correção do BUG-18 (`c346f36`):
antes dela, o loop de remoção lia o mesmo `statusMap` velho (que dizia
`EMPTY`) e pulava a remoção — dois retratos igualmente atrasados se
cancelavam; ao corrigir a leitura para `node.status` (ao vivo), a
pré-seleção atrasada ficou sozinha como fonte de divergência. A correção do
BUG-18 permanece — o erro estava na pré-seleção, não nela.

Regra confirmada com o usuário: para repositórios **desmarcados**, a única
ação possível do `Ctrl+S` é a tentativa de remoção **se o clone local
existir**; se não existir, nada deve ser feito — jamais cloná-los.

Corrigido: no cache-hit, a seleção inicial agora vem do **disco real** —
novo `applyInitialSelectionFromLocalClones` (`treeBuilder.ts`), que recebe o
verificador (`hasGitDir(node.localPath)`) injetado pelo core e marca cada
projeto conforme o clone de fato existe naquele momento. O caminho de carga
completa (sem cache) continua com `applyInitialSelectionFromStatusMap`, pois
ali o `statusMap` acabou de ser computado do disco. Regressão coberta por
`tests/git_sync_stale_preselection_test.ts` (cache fabricado com as duas
divergências: `SYNCED` sem clone → não pode selecionar; `EMPTY` com clone →
deve selecionar), verificado também ponta-a-ponta com três execuções reais
consecutivas (fresh → cache velho → cache atualizado) via TUI simulada.

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

### ~~DC-05~~ — `resolveEnvFileFromCli` duplicado em `gitCommand.ts` com caminho padrão fixado em constante de módulo
**Severidade: MÉDIO** | **Status: RESOLVIDO**

`gitCommand.ts` mantinha sua própria cópia local (não exportada) de `resolveEnvFileFromCli`, usada nos 4 pontos de resolução do arquivo de ambiente para `git-sync` e `git-server-store`, em vez de importar a versão já existente em `core/envResolver.ts`. Pior: o caminho padrão (`~/.paje/env.yaml`) era calculado uma única vez em `const defaultEnvPath = path.join(os.homedir(), ".paje", "env.yaml")` no carregamento do módulo — se `os.homedir()`/`HOME` mudasse depois (processos de teste de longa duração que reutilizam o mesmo módulo Node, ou uma falha anterior que deixasse `HOME` não restaurado), essa constante ficava presa ao valor antigo, podendo escrever `env.yaml`/`git-servers.json` fora do `~/.paje` esperado. Encontrado ao implementar a criação automática do `env.yaml` na primeira execução (ver `docs/arquitetura.md`), quando o mesmo padrão de constante-travada já havia sido corrigido em `sshManager.ts`. Removida a cópia local; `gitCommand.ts` agora importa `resolveEnvFileFromCli` de `core/envResolver.ts`, que recomputa `os.homedir()` a cada chamada.

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

## Correções da revisão de 2026-07-11 (atalhos, modais e infraestrutura de teste)

Bugs identificados e corrigidos na revisão completa de funcionalidades (branch `refactor/pino-logger`), todos cobertos por testes automatizados:

### ~~UX-12~~ — Atalho `Ctrl+H` inacessível em terminais reais
**Severidade: ALTO** | **Status: RESOLVIDO**

Terminais enviam o byte `0x08` (backspace) para `Ctrl+H`; o Ink o reporta como `key.backspace`, nunca como `ctrl+h` — a ajuda documentada era inalcançável pelo teclado. O `Layout` passou a aceitar `key.backspace` como abertura da ajuda em telas sem campo de texto (prop `helpOnBackspace`; a tecla Backspace física envia `0x7f` = `key.delete` e não conflita).

### ~~UX-13~~ — Atalho `Ctrl+M` colidia com Enter e disparava sincronização
**Severidade: ALTO** | **Status: RESOLVIDO**

Terminais enviam o mesmo byte (`0x0d`) para `Ctrl+M` e `Enter` — o filtro de selecionados era inalcançável e a tentativa disparava a ação de Enter (sincronizar escopo). Filtro remapeado para `Ctrl+F` (código, modal de ajuda, i18n, README e docs).

### ~~UX-14~~ — Letra `p` impossível de digitar em qualquer prompt de texto
**Severidade: ALTO** | **Status: RESOLVIDO**

Os 5 prompts do `tuiSession` engoliam `p`/`P` (resquício do antigo atalho "p" para o modal de parâmetros, hoje `Ctrl+P`) — impossível digitar usuário, senha ou caminho contendo "p". Blocos removidos.

### ~~UX-15~~ — `Ctrl+C` não encerrava com modal aberto
**Severidade: MÉDIO** | **Status: RESOLVIDO**

O gate de modal aberto no `Layout` vinha antes do handler de `Ctrl+C`. Handler movido para antes do gate — encerrar sempre funciona.

### ~~UX-16~~ — Títulos dos modais de Parâmetros e Ajuda nunca renderizavam
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Off-by-one no cálculo de altura (`marginTop` do conteúdo não contabilizado) fazia o flexbox encolher o cabeçalho e cortar a linha do título. Corrigido em `ParametersModal` e `HelpModal`.

### ~~UX-17~~ — Painel de log estourava a altura com linhas longas
**Severidade: MÉDIO** | **Status: RESOLVIDO**

Entradas mais largas que o terminal quebravam em múltiplas linhas físicas, empurrando o layout. Cada entrada agora é truncada em uma única linha (`wrap="truncate-end"`), com colorização por nível via ANSI manual (independente de detecção de TTY).

### ~~INC-09~~ — Suíte de testes morria na primeira exceção e ocultava regressões
**Severidade: ALTO** | **Status: RESOLVIDO**

`tests/run-all.ts` abortava no primeiro arquivo com exceção (ex.: `ssh-keygen` ausente) e os arquivos seguintes — incluindo todos os de TUI — nunca executavam, mascarando testes quebrados havia meses (`tui_render_test` pressionava atalhos sem Ctrl; `git_sync_auth_guard_test` e `git_sync_summary_test` com expectativas defasadas). Runner reescrito: tolerante a falhas, resumo final e exit code correto. Testes defasados corrigidos; novos testes de regressão adicionados (`tui_edit_params_modal_test`, `logger_panel_color_test`, `env_yaml_write_test`, `git_sync_cache_refresh_test`) com utilitários compartilhados (`tests/tui_test_utils.ts`).

---

## Resumo por Severidade

| Severidade | Qtd | Itens principais |
|---|---|---|
| **CRÍTICO** | 0 | — |
| **ALTO** | 4 | INC-06, REQ-02, REQ-03, UX-04 |
| **MÉDIO** | 1 | BUG-07 |
| **BAIXO** | 0 | — |

### Itens resolvidos desde a auditoria inicial

BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-08, BUG-09, BUG-10, BUG-11, INC-01, INC-02, INC-03, INC-04, INC-07, INC-08, INC-09, DC-01, DC-02, DC-03, DC-04, DC-05, I18N-02, I18N-03, I18N-04, REQ-04, REQ-05, REQ-06, UX-01, UX-02, UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-13, UX-14, UX-15, UX-16, UX-17, REQ-01/UX-03 (43 itens)

---

## Como registrar novos itens

1. Escolha a seção adequada (BUGS, INCONSISTÊNCIAS, I18N, REQUISITOS, DEAD CODE ou UX/FLUXO) e atribua o próximo número sequencial dentro da seção (ex.: BUG-12, UX-12).
2. Indique severidade (CRÍTICO / ALTO / MÉDIO / BAIXO) e status (ABERTO / RESOLVIDO).
3. Descreva o comportamento esperado e o comportamento atual.
4. Inclua passos de reprodução, impacto e workaround (se existir).
5. Ao resolver, atualize o status, registre a solução aplicada e mova o identificador para a lista de itens resolvidos no Resumo.
6. Execute `npm run build && npm test` antes de fechar o item.
