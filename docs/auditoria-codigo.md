# Relatório de Auditoria — Projeto PAJE

Data: 2026-06-05 (revisada 2026-06-05 pós refatoração; reorganizada em 2026-08-25 em bugs/melhorias)

Organização deste documento: **itens abertos** primeiro (bugs por gravidade, depois
melhorias), seguidos de um **histórico** com todo o material já resolvido, mantido
com os identificadores originais para preservar rastreabilidade com commits e outros
documentos.

---

## Itens abertos

### Resumo

| Tipo | Gravidade | Qtd |
|---|---|---|
| Bug | Bloqueante | 1 |
| Bug | Crítico | 2 |
| Bug | Normal | 2 |
| Bug | Cosmético | 1 |
| Melhoria | — | 1 |

---

## 1. Bugs

### BUG-01 — Testes gravam dados fictícios em cima do `~/.paje` real no Windows (`git-servers.json`, cache, resumo)
**Gravidade: BLOQUEANTE** | **Status: ABERTO**

`resolvePajePaths()` (`persistence.ts:18-19`) resolve o diretório base com
`os.homedir()`. No Windows, `os.homedir()` do Node lê a variável `USERPROFILE`
— **nunca** `HOME` — para descobrir o diretório do usuário. Quatro arquivos de
teste isolam o ambiente setando só `process.env.HOME` (sem tocar em
`USERPROFILE` e sem sobrescrever `os.homedir` diretamente, ao contrário do
padrão correto usado em outros testes, ex. `env_yaml_first_run_test.ts:17-20`
ou `git_sync_auth_guard_test.ts:13-14`):

- `tests/git_sync_cache_refresh_test.ts:16` seta só `HOME`; `:24` chama
  `resolvePajePaths()`; `:35` grava `paths.serversFile` com um servidor fictício
  (`git.exemplo.com`) e projetos `grupo/proj-a`/`grupo/proj-b`.
- `tests/git_sync_stale_preselection_test.ts:27` (`HOME` só) → `:35`
  `resolvePajePaths()` → `:41` grava `paths.serversFile`.
- `tests/git_sync_stale_statusmap_test.ts:30` (`HOME` só) → `:37`
  `resolvePajePaths()` → `:43` grava `paths.serversFile`.
- `tests/git_sync_summary_test.ts:120` (`HOME` só) → `:148` chama
  `writeGitServers([...])` diretamente.

Em qualquer máquina Windows, rodar `npm test` — passo obrigatório do fluxo de
todo desenvolvimento descrito na seção 3 deste `CLAUDE.md` do projeto, executado
após toda alteração de código — sobrescreve silenciosamente o
`%USERPROFILE%\.paje\git-servers.json` real do usuário com esses servidores e
repositórios de teste, e sujeita `git-tree-cache.json`/outros arquivos do
mesmo diretório à mesma contaminação. O ambiente de configuração real fica
substituído por dados fictícios sem nenhum aviso.

**Comportamento esperado:** a instalação/execução de testes nunca deve tocar
na configuração real do usuário, a menos que ele peça explicitamente uma
substituição. Se algum fluxo legítimo precisar substituir `env.yaml` e
`git-servers.json`, o resultado não pode conter repositórios de exemplo ou de
teste — os arquivos devem ficar vazios (`git-servers.json: []`) e os
parâmetros de `env.yaml` devem vir com os valores default documentados no
próprio template (`envTemplate.ts`), nunca com dados fabricados por teste.

**Correção:** nos quatro arquivos listados, seguir o mesmo padrão já usado em
`env_yaml_first_run_test.ts`/`git_sync_auth_guard_test.ts` — setar também
`process.env.USERPROFILE` (ou sobrescrever `os.homedir` diretamente) para o
diretório temporário, restaurando ambos no `finally`.

---

### BUG-02 — `docs/requisitos-tui-git-sync.md` RF-06: Remoção de repositórios desmarcados inconsistente
**Gravidade: CRÍTICO** | **Status: ABERTO**

Remoção não respeita escopo correto (linha vs grupo) nem as regras de exclusão segura para estados UNCOMMITTED/AHEAD/DIVERGED.

**Regras esperadas (referência do produto):**
1. A diferença entre **Ctrl+S** (escopo da linha/grupo destacado) e **S** (todas as linhas) é apenas a quantidade de repositórios afetados; as regras de seleção/remoção são idênticas.
2. Linha selecionada com **X**: clone se não existir diretório local; pull+push se já existir.
3. Linha não selecionada com diretório local e sem pendências de push (não AHEAD nem UNCOMMITTED): pode deletar o diretório local.
4. Linha não selecionada com status UNCOMMITTED ou AHEAD: pedir confirmação explícita antes de deletar.

**Impacto:** Risco de remoção de diretórios fora do escopo pretendido; possibilidade de perda de alterações locais.

**Workaround:** Evitar remover repositórios locais via TUI até correção; fazer limpeza manual com verificação de status.

*(anteriormente REQ-03)*

---

### BUG-03 — Escopos padrão do token gerado automaticamente podem não incluir permissão de push
**Gravidade: CRÍTICO (estimada — pendente confirmação)** | **Status: ABERTO** (registrado a partir de suspeita relatada pelo usuário — ainda não confirmado nem corrigido)

`DEFAULT_TOKEN_SCOPES` (`sshManager.ts:365`, espelhado em `envTemplate.ts:79` e em
três pontos de `gitCommand.ts`) é
`["read_repository", "read_api", "read_virtual_registry", "self_rotate"]` — os
quatro escopos são de **leitura**; nenhum inclui `write_repository` (o escopo
do GitLab que autoriza `git push` sobre HTTPS usando o próprio PAT). Se um
servidor estiver configurado com `useBasicAuth` (HTTPS + PAT, sem chave SSH), um
token criado com esses escopos padrão permitiria `clone`/`pull` mas rejeitaria
`push` — sem nenhum aviso no momento do cadastro, já que `hasUsableServerCredentials()`
só verifica se existe *algum* token/chave, não se os escopos
persistidos são suficientes para escrita. Ainda não confirmado experimentalmente
contra um GitLab real, nem se o fluxo recomendado (chave SSH, que não passa por
escopo de token nenhum) mitiga isso na prática para quem não usa
`useBasicAuth`. **Próximo passo, antes de qualquer correção**: reproduzir um
`git push` num repositório clonado via token com os escopos padrão e confirmar
se falha; se confirmado, avaliar se `write_repository` deveria entrar no
default, ou se o cadastro deveria avisar explicitamente que os escopos padrão
são somente leitura.

*(anteriormente BUG-21)*

---

### BUG-04 — `gitCommand.ts` vs `gitSyncService.ts` — semântica invertida do campo `updated` em `mergeServer`
**Gravidade: NORMAL** | **Status: ABERTO**

Em `gitCommand.ts:542`: novo servidor → `updated: false`, atualizado → `updated: true`.
Em `gitSyncService.ts:142`: ambos os casos → `updated: true`. Semânticas opostas para a mesma operação.
Risco: código que testa `merge.updated` se comporta diferente dependendo do caminho chamado.

Dois `mergeServer` separados: `gitCommand.ts:527` e `gitSyncService.ts:133`.

*(anteriormente BUG-07 / INC-06 — mesma causa, registrada duas vezes no documento original)*

---

### BUG-05 — `HelpModal` não implementa scroll; hint promete `↑/↓ PgUp/PgDn`
**Gravidade: NORMAL** | **Status: ABERTO**

```typescript
// HelpModal.tsx:235 — corta silenciosamente; sem scroll
const visibleLines = lines.slice(0, contentHeight);
```

*(anteriormente UX-04)*

---

### BUG-06 — `Key.home`/`Key.end` nunca são verdadeiros nesta versão do Ink — atalhos "Home/End" são código morto
**Gravidade: COSMÉTICO** | **Status: ABERTO**

Descoberto ao investigar o bug do `HelpModal` (histórico, `BUG-14`): `ink@5.2.1`'s `useInput` (`node_modules/ink/build/hooks/use-input.js`)
constrói o objeto `key` só com `upArrow`, `downArrow`, `leftArrow`, `rightArrow`,
`pageUp`, `pageDown`, `return`, `escape`, `ctrl`, `shift`, `tab`, `backspace`,
`delete`, `meta` — nunca `home`/`end`, mesmo quando `parse-keypress.js` já
reconhece as sequências ANSI correspondentes (`keypress.name === "home"/"end"`).
Qualquer código que checa `(key as Key & { home?: boolean; end?: boolean }).home`/`.end`
nunca é executado. Afeta pelo menos: `tui.app.tsx` (atalho "Home/End — ir ao
início/fim" da árvore, documentado em `docs/requisitos-tui-git-sync.md` RF-05
e no próprio `HelpModal`) e `resolveShortcutKey` em `HelpModal.tsx` (nunca
resolve "Home"/"End" para re-executar como atalho). Não corrigido por
estar fora do escopo da tarefa que o encontrou — precisa de uma forma
alternativa de detectar essas teclas (ex.: reconhecer a sequência bruta antes
do parse do Ink, ou atualizar o Ink) antes de poder corrigir.

*(anteriormente BUG-15)*

---

## 2. Melhorias

### MELHORIA-01 — `docs/requisitos-tui-git-sync.md` RF-08: Modal de resumo final não implementada
**Status: ABERTO**

Requisito pede modal com tempo total, contagem de ações e lista ordenada de repositórios com métricas. Código entrega apenas logs no painel de log.

*(anteriormente REQ-02)*

---

## Histórico (itens já resolvidos)

Conteúdo original das auditorias anteriores, preservado com os identificadores
com que foi registrado (`BUG-NN`, `INC-NN`, `I18N-NN`, `REQ-NN`, `DC-NN`,
`UX-NN`) para manter a rastreabilidade com commits e outros documentos. Os
itens que estavam abertos nessas seções foram movidos para "Itens abertos"
acima e aqui aparecem apenas como referência cruzada.

### 1. BUGS / COMPORTAMENTOS INCORRETOS

#### ~~BUG-01~~ — `gitBranchService.ts:100` — DIVERGED exibido como AHEAD *(decisão de design — não é bug)*

> **Esclarecimento:** comportamento intencional documentado em `docs/requisitos-tui-git-sync.md` RF-03.
> Quando `ahead > 0` e `behind > 0`, o sistema exibe `state: "AHEAD"` para destacar a presença de commits locais não publicados. O delta `+N/-M` ainda comunica a divergência.

---

#### ~~BUG-02~~ — `gitCommand.ts` — Chaves i18n `cli.errors.gitlab.registerKey*` inexistentes
**Status: RESOLVIDO**

A função `ensureSshKey()` que chamava `t("cli.errors.gitlab.registerKeyDetails")` e `t("cli.errors.gitlab.registerKey")` foi removida na refatoração para separação de camadas. O código atual usa `cli.errors.gitlab.registerKeyFail` (adicionado em UX-08), que existe em ambos os locales.

---

#### ~~BUG-03~~ — `gitCommand.ts` — Chave i18n `cli.prompt.verbose.title` inexistente
**Status: RESOLVIDO**

Chave adicionada a `pt_BR.ts` e `en_US.ts` como `cli.prompt.verbose.title` ("SSH - Detalhes" / "SSH - Details"). Usada como título do modal que exibe saída verbose do `addHostToKnownHosts` na TUI.

---

#### ~~BUG-04~~ — `gitCommand.ts` — Chave i18n `cli.log.syncNoMatch` inexistente
**Status: RESOLVIDO**

A chamada foi removida com a Fase 2. A lógica de "nenhum repositório corresponde" passou para o core, que usa `cli.sync.noSyncMatches`.

---

#### ~~BUG-05~~ — `gitCommand.ts` — Chaves `cli.prompt.parallel.*` inexistentes (9 chaves)
**Status: RESOLVIDO**

A função `resolveParallelOptions` (dead code) foi removida junto com as 9 chamadas a chaves inexistentes. Ver DC-01.

---

#### ~~BUG-06~~ — `gitCommand.ts` — `useBasicAuth` padrão `true` em `git-server-store`
**Status: RESOLVIDO**

O fluxo `storeSshKeyOnly()` podia deixar de exibir detalhes do token existente porque `useBasicAuth`
defaultava incorretamente para `true`. Corrigido para `useBasicAuth: options.useBasicAuth ?? false`.
O fluxo SSH é agora o padrão correto. Teste `ssh_key_store_command_test.ts` atualizado para incluir
`--use-basic-auth`. Ver também UX-06.

---

#### BUG-07 — `gitCommand.ts` vs `gitSyncService.ts` — semântica invertida do campo `updated` em `mergeServer`

**Movido para [BUG-04](#bug-04--gitcommandts-vs-gitsyncservicets--semântica-invertida-do-campo-updated-em-mergeserver) em "Itens abertos".**

---

#### ~~BUG-08~~ — `gitCommand.ts` — `const resolvedPaths` redeclarado no mesmo bloco
**Status: RESOLVIDO**

As duas declarações (linhas 1979 e 2401) estão em escopos distintos após a refatoração.

---

#### ~~BUG-09~~ — `parallelSync.ts` — `ensureParentDir` usa binário `mkdir` externo
**Status: RESOLVIDO**

Corrigido em `parallelSync.ts:135–136`: usa `fs.promises.mkdir(..., { recursive: true })`.

---

#### ~~BUG-10~~ — `gitCommand.ts` — Chave i18n `cli.log.tuiUnavailable` inexistente
**Status: RESOLVIDO**

Chave adicionada a `pt_BR.ts` e `en_US.ts` como `cli.log.tuiUnavailable` ("Sessão TUI indisponível." / "TUI session unavailable.").

---

#### ~~BUG-11~~ — `gitCommand.ts` — `prepareTargets` ignorava conflitos de caminho em multi-servidor
**Status: RESOLVIDO**

`prepareTargets` removida da camada de apresentação. O core usa `resolveLocalPathConflicts` corretamente em todos os paths.

---

#### ~~BUG-12~~ — `parallelSync.ts` — `hasGitDir` local chamava o binário POSIX `test`, quebrando no Windows
**Status: RESOLVIDO**

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

#### ~~BUG-13~~ — `sshManager.ts` — `ensurePajeKeyPair` quebrava ao sobrescrever a mesma chave duas vezes no Windows
**Status: RESOLVIDO**

Ao sobrescrever uma chave SSH existente, o código renomeava a chave antiga para
`.bak` via `fs.renameSync`. No POSIX, `rename()` sobrescreve silenciosamente um
destino já existente; no Windows, `fs.renameSync` lança `EEXIST` nesse caso — então
sobrescrever a mesma chave uma segunda vez (deixando um `.bak` da primeira vez)
falhava só nesse SO. Corrigido em `sshManager.ts` removendo qualquer `.bak`/`.pub.bak`
pré-existente antes de renomear. Teste de regressão em
`tests/ssh_key_overwrite_repeated_test.ts` (simula o `EEXIST` do Windows trocando
`fs.renameSync` por uma versão mais estrita, mesmo rodando em Linux).

---

#### ~~BUG-14~~ — `HelpModal.tsx` — modal de ajuda sem rolagem, com grupos inaplicáveis desperdiçando espaço
**Status: RESOLVIDO**

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

*(a regressão específica de scroll voltou a ser observada depois; ver BUG-05 em "Itens abertos")*

---

#### BUG-15 — `Key.home`/`Key.end` nunca são verdadeiros nesta versão do Ink — atalhos "Home/End" são código morto

**Movido para [BUG-06](#bug-06--keyhomekeyend-nunca-são-verdadeiros-nesta-versão-do-ink--atalhos-homeend-são-código-morto) em "Itens abertos".**

---

#### ~~BUG-16~~ — `loadTree()` pulava a checagem de `known_hosts` no caminho de cache-hit, travando sincronizações em paralelo
**Status: RESOLVIDO**

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

#### ~~BUG-17~~ — Cadastro de servidor incompleto (sem token/chave SSH) não bloqueava a sincronização
**Status: RESOLVIDO**

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

#### ~~BUG-18~~ — Remoção de repositório desmarcado usava um `statusMap` desatualizado no caminho de cache-hit
**Status: RESOLVIDO**

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

#### ~~BUG-19~~ — TUI do PAJÉ no Windows travava sem responder a nenhuma tecla após carregar a árvore
**Status: RESOLVIDO** *(correção necessária, mas insuficiente — o sintoma persistiu por causa distinta; ver BUG-23)*

No Windows, o executável `paje.cmd` invocava o script via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0paje.ps1" %*`. A execução de `powershell -File` a partir do `cmd.exe` ou PowerShell iniciava um processo PowerShell não-interativo que encapsulava os streams de `stdio` (`stdin`/`stdout`), impedindo que o Node.js e a biblioteca `Ink` assumissem o modo bruto TTY (`setRawMode(true)`). Com isso, os eventos de teclado via `useInput` não eram recebidos pela TUI e a tela ficava congelada. Corrigido reescrevendo `paje.cmd` como um script em lote batch nativo (`call npm run dev -- %*`) e atualizando `install-paje.ps1` para executar `paje.ps1` diretamente no `$PROFILE` do PowerShell.

---

#### ~~BUG-20~~ — Ao sair do PAJÉ no Windows, permanecia em uma tela em branco exigindo `Ctrl+C` e prompt "Deseja finalizar o arquivo em lotes (S/N)?"
**Status: RESOLVIDO**

Consequência direta da estrutura de processos intermediária descrita no BUG-19: o processo `cmd.exe` executava `paje.cmd` aguardando os handles do processo filho `powershell.exe -File`. Quando o Node.js finalizava a execução da TUI, o processo intermediário do PowerShell permanecia preso aguardando a finalização dos handles de stream, deixando a janela em branco até que o usuário pressionasse `Ctrl+C` — o que acionava a interrupção nativa do `cmd.exe` perguntando `Deseja finalizar o arquivo em lotes (S/N)?`. Eliminado ao remover a camada intermediária do `powershell -File` em `paje.cmd` e `install-paje.ps1`.

---

#### BUG-21 — Escopos padrão do token gerado automaticamente podem não incluir permissão de push

**Movido para [BUG-03](#bug-03--escopos-padrão-do-token-gerado-automaticamente-podem-não-incluir-permissão-de-push) em "Itens abertos".**

---

#### ~~BUG-22~~ — Pré-seleção no cache-hit vinha do `statusMap` do cache (uma sessão atrasado), clonando repositórios nunca marcados e removendo clones recém-feitos
**Status: RESOLVIDO**

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

#### ~~BUG-23~~ — TUI no Windows congela o teclado na transição loading → árvore: Ink desliga e religa o raw mode do console no gap sem tela
**Status: RESOLVIDO** (recorrência do sintoma do BUG-19 com causa distinta; análise e correção de 2026-08-24)

**Sintoma reportado (Windows):** ao carregar a árvore de repositórios, a interface
não reage a nenhuma tecla — nem navegação, nem Esc, nem Ctrl+C — obrigando a matar
o terminal inteiro. Não ocorre no Linux.

**Cadeia causal identificada (análise de código):**

1. Ao final do `loadTree()`, `loadingHandle.stop()` roda no `.finally`
   (`gitCommand.ts:1975`) → `screenHost.release()` zera `entry`
   (`screenHost.tsx:80–86`) e o `Root` do host passa a renderizar `null`.
2. Entre esse ponto e a montagem da árvore (`renderRepositoryTree`,
   `gitCommand.ts:2292`) existem **awaits de I/O reais e demorados**:
   `buildLocalStatusMap` (`gitCommand.ts:1990`/`2228`), que executa
   `resolveRepoStatus` — incluindo `git fetch --quiet` por repositório local
   fora da árvore (`core/gitSyncService.ts:355`) — e `runGit rev-parse`
   (`gitCommand.ts:2251`). O React, portanto, **comita o frame nulo**: todos os
   componentes com `useInput` desmontam.
3. Com o último `useInput` desmontado, o `rawModeEnabledCount` interno do Ink
   chega a 0 e o Ink executa `stdin.setRawMode(false)`,
   `removeListener('readable')` e `stdin.unref()`
   (`node_modules/ink/build/components/App.js:125–130`, ink@5.2.1). Quando a
   árvore monta, ele refaz tudo: `ref()`, `setRawMode(true)`,
   `addListener('readable')`.
4. No POSIX esse liga-desliga é um `ioctl` termios sem estado — inofensivo. No
   Windows, o TTY do libuv usa uma **thread leitora dedicada com chamadas
   bloqueantes de leitura do console**, que precisa ser cancelada e reiniciada
   a cada alternância de modo/parada de leitura. É exatamente esse caminho de
   cancelar-e-reiniciar que é historicamente frágil: a leitura antiga não é
   cancelada de forma confiável e a nova nunca recebe dados — teclado morto
   para sempre no processo.
5. O Ctrl+C morto é consistente com isso: a flag de raw mode **fica ligada**
   (o processamento de Ctrl+C do console fica desabilitado, então não gera
   sinal), mas o leitor do Ink nunca entrega os bytes — nenhum handler roda.
   Só resta matar o terminal, como o usuário descreve.

**Correção aplicada:** `RawModeKeeper` em `screenHost.tsx` — componente
keep-alive invisível renderizado permanentemente pelo `Root` (que fica montado
a sessão inteira), chamando `useStdin().setRawMode(true)` na montagem (usando
o contador interno do próprio Ink, não `process.stdin` direto) e liberando
apenas quando o host é destruído. Com isso `rawModeEnabledCount` nunca chega a
0 entre telas: o listener `'readable'` nunca é removido, o `stdin` nunca é
`unref`'d e o modo raw nunca alterna — em todas as plataformas, eliminando o
gatilho do congelamento no Windows. Regressão coberta por
`tests/screen_host_raw_mode_test.ts`.

---

### 2. INCONSISTÊNCIAS ENTRE ARQUIVOS

#### ~~INC-01~~ — Separador de branch em `syncRepos`: `#` no CLI vs `@` na TUI
**Status: RESOLVIDO**

Alinhado para `#` em todos os caminhos.

---

#### ~~INC-02~~ — `GitServerEntry` declarado em dois arquivos sem relação entre si
**Status: RESOLVIDO**

`gitCommand.ts` importa `GitServerEntry` de `gitSyncService.ts`. Único ponto canônico.

---

#### ~~INC-03~~ — `buildSummary` em `gitSyncService.ts` usa estados inválidos
**Status: RESOLVIDO**

`buildSummary` agora usa chaves de `RepoSyncState` válidas.

---

#### ~~INC-04~~ — `filterProjects` em `gitSyncService.ts` usa `includes()` em vez de Ant/Glob
**Status: RESOLVIDO**

Core usa `compileAntPatterns` / `matchesAntPatterns` desde a Fase 1.

---

#### INC-05 — `ensureLocalDirsIfNeeded`: cria diretório pai (core) vs diretório completo (CLI anterior)
**Status: EFETIVAMENTE RESOLVIDO**

O CLI não chama mais `ensureLocalDirsIfNeeded` diretamente. Ambos os caminhos (CLI e TUI) passam pelo core, que cria apenas `path.dirname(targetPath)`. Comportamento unificado, embora a semântica (dirname vs targetPath completo) seja um ponto a revisar se `--prepare-local-dirs` for reutilizado.

---

#### INC-06 — `mergeServer` tem semântica de `updated` oposta entre os dois arquivos

**Duplicata de BUG-07 — movido para [BUG-04](#bug-04--gitcommandts-vs-gitsyncservicets--semântica-invertida-do-campo-updated-em-mergeserver) em "Itens abertos".**

---

#### ~~INC-07~~ — `gitSyncService.ts` não listava projetos públicos; o CLI listava
**Status: RESOLVIDO**

`listPublicProjects()` removida do fluxo de `loadTree()`. Projetos públicos dos quais o usuário é membro já retornam via `listUserProjects()` (`membership=true`). O flag `noPublicRepos` filtra projetos públicos dentro dessa lista.

---

#### ~~INC-08~~ — `parallelSync`: parâmetro `onProgress` tem duas semânticas diferentes
**Status: RESOLVIDO**

Terceiro parâmetro renomeado de `onProgress` para `onResult` em `parallelSync.ts` e em todos os call sites. Nomenclatura agora reflete corretamente o recebimento de `SyncResult`.

---

### 3. CHAVES I18N FALTANDO / ÓRFÃS

#### I18N-01 — Chaves usadas no código mas ausentes em ambos os locales

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

#### ~~I18N-02~~ — Chave `cli.log.preselection` definida mas nunca usada
**Status: RESOLVIDO**

Chave órfã removida de `pt_BR.ts` e `en_US.ts`.

---

#### ~~I18N-03~~ — `en_US.ts` não era verificado pelo compilador
**Status: RESOLVIDO**

`en_US.ts` agora importa e usa `PtBrTranslations` como anotação de tipo (`const enUS: PtBrTranslations = {...}`). Qualquer chave adicionada a `pt_BR` e omitida em `en_US` passa a causar erro de compilação.

---

#### ~~I18N-04~~ — Texto de orientação na TUI mostra atalhos errados após Issue #6
**Status: RESOLVIDO**

Textos de orientação corrigidos em `pt_BR.ts` e `en_US.ts` para `menu.orientation`,
`tui.tree.orientationDefault`, `tui.tree.orientationConfirm` e `tui.loading.orientation`.
Todos os atalhos agora refletem as combinações com Ctrl (`Ctrl+S`, `Ctrl+M`, `Ctrl+B`, etc.).

---

### 4. REQUISITOS vs CÓDIGO

#### ~~REQ-01 / UX-03~~ — Atalho "S" documentado; código usa "Ctrl+S"
**Status: RESOLVIDO**

Textos de orientação atualizados. `Ctrl+S` para sincronizar tudo, `Enter` para sincronizar apenas o escopo destacado.

---

#### REQ-02 — `docs/requisitos-tui-git-sync.md` RF-08: Modal de resumo final não implementada

**Movido para [MELHORIA-01](#melhoria-01--docsrequisitos-tui-git-syncmd-rf-08-modal-de-resumo-final-não-implementada) em "Itens abertos".**

---

#### REQ-03 — `docs/requisitos-tui-git-sync.md` RF-06: Remoção de repositórios desmarcados inconsistente

**Movido para [BUG-02](#bug-02--docsrequisitos-tui-git-syncmd-rf-06-remoção-de-repositórios-desmarcados-inconsistente) em "Itens abertos".**

---

#### ~~REQ-04~~ — README cita `F12` para log em tela cheia; código usa `Ctrl+L`
**Status: RESOLVIDO**

README, `TUI-leiaute.md` e `requisitos-tui-git-sync.md` atualizados com `Ctrl+L`. Todos os atalhos agora refletem o código.

---

#### ~~REQ-05~~ — `docs/requisitos-tui-git-sync.md` RF-01: Spinner de loading não disponível no caminho `gitSyncService`
**Status: RESOLVIDO**

`GitSyncLoadOptions` expõe `onRequestStart?: (serverName, requestCount) => void`. A TUI usa esse callback para atualizar o spinner de carregamento (`gitSyncService.ts:74,558`).

---

#### ~~REQ-06~~ — `logStore.ts` — Painel de log iniciava em nível `info`; RU-03 exige `warn`
**Status: RESOLVIDO**

`logStore.ts:17` corrigido de `"info"` para `"warn"`. O painel TUI agora filtra mensagens de nível `info` por padrão, reduzindo o ruído visual e alinhando com RU-03.

---

### 5. DEAD CODE / CÓDIGO NUNCA ALCANÇADO

#### ~~DC-01~~ — `resolveParallelOptions()` nunca era chamada
**Status: RESOLVIDO**

Função removida de `gitCommand.ts`. Eliminadas as 9 chamadas a chaves `cli.prompt.parallel.*` inexistentes (resolve também BUG-05).

---

#### ~~DC-02~~ — `useTty = false` tornava ~150 linhas inacessíveis em `gitCommand.ts`
**Status: RESOLVIDO**

Removidos: `useTty`, `overallLine`, `blockLines`, `workerStates`, `completedTargets`, `lastPrinted`, `historyLines` e as funções `saveCursor`, `restoreCursor`, `renderBlock`, `appendHistoryLine`, `buildWorkerPlaceholder`. Todos os blocos `if (useTty)` foram removidos e os blocos `if (!useTty)` tiveram os guards eliminados. Comportamento em runtime preservado.

---

#### ~~DC-03~~ — `createGitSyncCore` nunca importado fora dos testes
**Status: RESOLVIDO**

`createGitSyncCore` é importado e usado em `gitCommand.ts:1957`. A lógica de sync de produção passa pelo core.

---

#### ~~DC-04~~ — Funções declaradas duas vezes com implementações ligeiramente diferentes
**Status: RESOLVIDO**

As redeclarações locais de `formatTransferDetail`, `parseMiB`, `formatObjects` e `formatRepoLabel` foram removidas. As versões de módulo são agora usadas por ambos os caminhos (TUI e CLI). Aproveitou-se para corrigir `formatRepoLabel` module-level: trocou `?` por `…` para alinhar com a versão local.

---

#### ~~DC-05~~ — `resolveEnvFileFromCli` duplicado em `gitCommand.ts` com caminho padrão fixado em constante de módulo
**Status: RESOLVIDO**

`gitCommand.ts` mantinha sua própria cópia local (não exportada) de `resolveEnvFileFromCli`, usada nos 4 pontos de resolução do arquivo de ambiente para `git-sync` e `git-server-store`, em vez de importar a versão já existente em `core/envResolver.ts`. Pior: o caminho padrão (`~/.paje/env.yaml`) era calculado uma única vez em `const defaultEnvPath = path.join(os.homedir(), ".paje", "env.yaml")` no carregamento do módulo — se `os.homedir()`/`HOME` mudasse depois (processos de teste de longa duração que reutilizam o mesmo módulo Node, ou uma falha anterior que deixasse `HOME` não restaurado), essa constante ficava presa ao valor antigo, podendo escrever `env.yaml`/`git-servers.json` fora do `~/.paje` esperado. Encontrado ao implementar a criação automática do `env.yaml` na primeira execução (ver `docs/arquitetura.md`), quando o mesmo padrão de constante-travada já havia sido corrigido em `sshManager.ts`. Removida a cópia local; `gitCommand.ts` agora importa `resolveEnvFileFromCli` de `core/envResolver.ts`, que recomputa `os.homedir()` a cada chamada.

---

### 6. PROBLEMAS DE UX / FLUXO

#### ~~UX-01~~ — Orientação exibe "C para filtrar"; atalho real é `Ctrl+M`
**Status: RESOLVIDO**

Handler e textos de orientação alinhados. `Ctrl+M` para filtrar selecionados.

---

#### ~~UX-02~~ — Orientação exibe "B para branch"; atalho real é `Ctrl+B`
**Status: RESOLVIDO**

Handler e textos de orientação alinhados. `Ctrl+B` para abrir branch modal.

---

#### UX-04 — `HelpModal` não implementa scroll; hint promete `↑/↓ PgUp/PgDn`

**Movido para [BUG-05](#bug-05--helpmodal-não-implementa-scroll-hint-promete-pgup-pgdn) em "Itens abertos".**

---

#### ~~UX-05~~ — `toggleModal` fecha modal "help" ao pressionar `Ctrl+P`
**Status: RESOLVIDO**

`layoutContext.ts`: ramo `if (current && modalType === "help")` removido de `toggleModal`. Pressionar `Ctrl+P` com qualquer modal aberta agora transiciona para a modal de parâmetros.

---

#### ~~UX-06~~ — Senha ausente no fluxo `git-server-store`
**Status: RESOLVIDO**

Resolvido com a correção do BUG-06 e atualização do teste. Ver BUG-06 acima.

---

#### ~~UX-07~~ — Fluxo TUI: exceção em `serverResults` pode deixar estado indefinido
**Status: RESOLVIDO**

`loadTree()` agora envolve as chamadas de API de cada servidor em `try/catch`, retornando `null` em caso de falha. O filtro `validServerResults.filter(result => result !== null)` já existia para lidar com nulls — agora é ativado de facto em falhas de rede, sem abortar o carregamento completo.

---

#### ~~UX-08~~ — `gitSyncService.ts` tem ~15 strings hardcoded em português, ignorando i18n
**Status: RESOLVIDO**

Todas as strings hardcoded substituídas por `t()`. 8 reaproveitam chaves existentes; 3 chaves novas criadas: `cli.prompt.sshKey.noKeyInSsh`, `cli.errors.gitlab.registerKeyFail`, `cli.sync.usernameMissingBasicAuth`. Regra adicionada ao `CLAUDE.md` para prevenir recorrência.

---

#### ~~UX-09~~ — Default de `baseUrl` hardcoded para `"https://git.tse.jus.br"` (URL do TSE)
**Status: RESOLVIDO**

Substituído por `"https://gitlab.com"` em `gitCommand.ts`.

---

#### ~~UX-10~~ — Comportamento do Esc inconsistente entre telas
**Status: RESOLVIDO**

O Esc deveria respeitar a hierarquia: (1) fechar modal ativa; (2) restaurar painel maximizado; (3) voltar para a tela anterior; (4) sair da aplicação se já no menu principal. O handler foi centralizado no layout para aplicar exatamente essa ordem de prioridade.

---

#### ~~UX-11~~ — Mensagens de log da sincronização fora do padrão
**Status: RESOLVIDO**

Ao selecionar S para sincronizar, a mensagem genérica exibida no painel de log e o texto estático na área de trabalho ("Acessando servidores e carregando repositórios - requisições: N") não espelhavam os logs do CLI nem transmitiam progresso real. Corrigido: logs de carregamento HTTP e progresso do sync agora são direcionados ao painel TUI com o mesmo texto e ordem do CLI; mensagens genéricas removidas; logs verbose da API passam a aparecer no painel TUI.

---

### Correções da revisão de 2026-07-11 (atalhos, modais e infraestrutura de teste)

Bugs identificados e corrigidos na revisão completa de funcionalidades (branch `refactor/pino-logger`), todos cobertos por testes automatizados:

#### ~~UX-12~~ — Atalho `Ctrl+H` inacessível em terminais reais
**Status: RESOLVIDO**

Terminais enviam o byte `0x08` (backspace) para `Ctrl+H`; o Ink o reporta como `key.backspace`, nunca como `ctrl+h` — a ajuda documentada era inalcançável pelo teclado. O `Layout` passou a aceitar `key.backspace` como abertura da ajuda em telas sem campo de texto (prop `helpOnBackspace`; a tecla Backspace física envia `0x7f` = `key.delete` e não conflita).

#### ~~UX-13~~ — Atalho `Ctrl+M` colidia com Enter e disparava sincronização
**Status: RESOLVIDO**

Terminais enviam o mesmo byte (`0x0d`) para `Ctrl+M` e `Enter` — o filtro de selecionados era inalcançável e a tentativa disparava a ação de Enter (sincronizar escopo). Filtro remapeado para `Ctrl+F` (código, modal de ajuda, i18n, README e docs).

#### ~~UX-14~~ — Letra `p` impossível de digitar em qualquer prompt de texto
**Status: RESOLVIDO**

Os 5 prompts do `tuiSession` engoliam `p`/`P` (resquício do antigo atalho "p" para o modal de parâmetros, hoje `Ctrl+P`) — impossível digitar usuário, senha ou caminho contendo "p". Blocos removidos.

#### ~~UX-15~~ — `Ctrl+C` não encerrava com modal aberto
**Status: RESOLVIDO**

O gate de modal aberto no `Layout` vinha antes do handler de `Ctrl+C`. Handler movido para antes do gate — encerrar sempre funciona.

#### ~~UX-16~~ — Títulos dos modais de Parâmetros e Ajuda nunca renderizavam
**Status: RESOLVIDO**

Off-by-one no cálculo de altura (`marginTop` do conteúdo não contabilizado) fazia o flexbox encolher o cabeçalho e cortar a linha do título. Corrigido em `ParametersModal` e `HelpModal`.

#### ~~UX-17~~ — Painel de log estourava a altura com linhas longas
**Status: RESOLVIDO**

Entradas mais largas que o terminal quebravam em múltiplas linhas físicas, empurrando o layout. Cada entrada agora é truncada em uma única linha (`wrap="truncate-end"`), com colorização por nível via ANSI manual (independente de detecção de TTY).

#### ~~INC-09~~ — Suíte de testes morria na primeira exceção e ocultava regressões
**Status: RESOLVIDO**

`tests/run-all.ts` abortava no primeiro arquivo com exceção (ex.: `ssh-keygen` ausente) e os arquivos seguintes — incluindo todos os de TUI — nunca executavam, mascarando testes quebrados havia meses (`tui_render_test` pressionava atalhos sem Ctrl; `git_sync_auth_guard_test` e `git_sync_summary_test` com expectativas defasadas). Runner reescrito: tolerante a falhas, resumo final e exit code correto. Testes defasados corrigidos; novos testes de regressão adicionados (`tui_edit_params_modal_test`, `logger_panel_color_test`, `env_yaml_write_test`, `git_sync_cache_refresh_test`) com utilitários compartilhados (`tests/tui_test_utils.ts`).

---

## Como registrar novos itens

1. Escolha o tipo: **Bug** (comportamento incorreto/divergente do esperado) ou **Melhoria** (funcionalidade ainda não implementada, sem comportamento incorreto associado).
2. Se for **Bug**, atribua uma gravidade:
   - **Bloqueante** — perda de dados/configuração, comportamento destrutivo, ou impede o uso normal da ferramenta sem que o usuário tenha pedido a ação.
   - **Crítico** — quebra uma funcionalidade central (sync, autenticação, navegação principal), com ou sem workaround.
   - **Normal** — comportamento incorreto de impacto limitado, sem risco de perda de dados.
   - **Cosmético** — problema visual/UX ou atalho secundário sem efeito sobre dados ou fluxo principal.
   Atribua o próximo número sequencial `BUG-NN` (numeração única entre todos os bugs abertos, independente da gravidade).
3. Se for **Melhoria**, atribua o próximo número sequencial `MELHORIA-NN`.
4. Descreva o comportamento esperado e o comportamento atual, com referências `arquivo:linha` sempre que possível.
5. Inclua passos de reprodução, impacto e workaround (se existir).
6. Ao resolver um item aberto, mova-o para a seção "Histórico", mantendo o identificador (`BUG-NN`/`MELHORIA-NN`), atualize seu status para RESOLVIDO e descreva a solução aplicada. Atualize a tabela de Resumo no topo do documento.
7. Execute `npm run build && npm test` antes de fechar o item.
