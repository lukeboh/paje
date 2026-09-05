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
| Bug | Bloqueante | 0 |
| Bug | Crítico | 2 |
| Bug | Normal | 2 |
| Bug | Cosmético | 1 |
| Melhoria | — | 1 |

---

## 1. Bugs

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

### Itens resolvidos após a reorganização de 2026-08-25

#### ~~BUG-01~~ — Testes gravam dados fictícios em cima do `~/.paje` real no Windows (`git-servers.json`, cache, resumo)
**Status: RESOLVIDO**

`resolvePajePaths()` (`persistence.ts:18-19`) resolve o diretório base com
`os.homedir()`. No Windows, `os.homedir()` do Node lê a variável `USERPROFILE`
— nunca `HOME` — para descobrir o diretório do usuário. Quatro arquivos de
teste isolavam o ambiente setando só `process.env.HOME`, sem tocar em
`USERPROFILE` e sem sobrescrever `os.homedir` diretamente (ao contrário do
padrão correto já usado em `env_yaml_first_run_test.ts` e
`git_sync_auth_guard_test.ts`): `git_sync_cache_refresh_test.ts`,
`git_sync_stale_preselection_test.ts`, `git_sync_stale_statusmap_test.ts` e
`git_sync_summary_test.ts`. Em qualquer máquina Windows, rodar `npm test`
sobrescrevia silenciosamente o `%USERPROFILE%\.paje\git-servers.json` real do
usuário (e o `git-tree-cache.json`) com servidores e repositórios fictícios de
teste — exatamente o sintoma relatado de "instalação sobrescrevendo os
arquivos de configuração com repositórios de exemplo/teste".

Corrigido nos quatro arquivos setando também `process.env.USERPROFILE` para o
diretório temporário, restaurado junto com `HOME` no `finally`.

Uma segunda fonte de vazamento foi encontrada durante a verificação, específica
de `git_sync_stale_preselection_test.ts`: em cache-hit, `loadTree()`
(`gitSyncService.ts:740`) dispara um refresh de status em segundo plano via
`setImmediate` que, ao final, regrava `git-tree-cache.json`
(`gitSyncService.ts:770`) — sem esperar por esse job, o `finally` do teste
restaurava `HOME`/`USERPROFILE` para os valores reais ANTES dele terminar, e a
escrita assíncrona acabava pousando no `~/.paje` real. Corrigido fazendo o
teste esperar (`waitFor` por mudança de `mtime` do arquivo de cache) o
`writeGitTreeCache` do refresh terminar antes de restaurar o ambiente.

Verificado manualmente rodando os quatro testes de forma isolada (`npx tsx`)
com o `~/.paje` real monitorado antes/depois — nenhum arquivo real foi tocado,
inclusive em execuções repetidas. `npm run build` e `npm test` não introduziram
novas falhas (a suíte já tinha 11 arquivos falhando antes desta correção, por
causas não relacionadas — ver observação abaixo).

> **Observação:** a suíte de testes deste projeto, neste ambiente Windows,
> já tinha 11 arquivos falhando antes desta correção (`tui_prompt_form_layout_test`,
> `git_sync_auth_guard_test`, `git_sync_quick_register_bootstrap_test`,
> `git_sync_registration_incomplete_test`, `git_sync_missing_credentials_bootstrap_test`,
> `git_sync_token_rotate_healing_test`, `git_sync_token_invalid_bootstrap_test`,
> `git_sync_github_token_expired_test`, `env_yaml_first_run_test`,
> `git_sync_known_hosts_test`, `tui_exit_at_directory_test`) — confirmado
> comparando com `git stash`. Essas falhas são pré-existentes e não relacionadas
> a este bug; ainda não têm item próprio nesta auditoria.

---

#### ~~BUG-07~~ — `gitSyncService.ts` ignorava a associação SSH do host e sempre gerava `pajeHttpUrl` (HTTPS+token) quando havia token — clone/pull/push usavam HTTPS em vez de SSH mesmo com chave SSH válida
**Status: RESOLVIDO**

Relatado pelo usuário ao revisar o cadastro de servidores via SSH: a
expectativa (documentada em `docs/arquitetura.md`, tabela de autenticação, e
na própria mensagem exibida ao usuário após configurar SSH,
`cli.prompt.sshKey.dualCredentialInfo`) é que, quando o host de um servidor
tem uma chave SSH associada em `~/.ssh/config`, todas as operações git
(`clone`/`pull`/`push`) usem a URL SSH — o token deveria servir só para
chamadas à API REST (listar grupos/projetos). O código não respeitava isso.

`gitSyncService.ts` já calculava `hasValidSshAssociation(host)` (função
`hasValidSshAssociation`, então na linha ~424) e a usava para decidir se um
token era exigido e se `ensureSshKey` deveria rodar — mas **nunca** para
decidir se `pajeHttpUrl` (a URL HTTPS com o token embutido,
`oauth2:<token>@host` para GitLab ou `x-access-token:<token>@host` para
GitHub) deveria ser montada. `pajeHttpUrl` era preenchida sempre que um
token existisse, em três pontos distintos: rehidratação do caminho de
cache-hit, busca fresca de servidores GitHub (onde `hasSshAssociation` nem
chegava a ser calculada) e busca fresca de servidores GitLab. Como o próprio
fluxo de cadastro via SSH sempre termina gerando um token também (modelo
"token-first", ver `docs/funcionalidades/git-server-store.md`), praticamente
todo servidor "configurado via SSH" tinha `pajeHttpUrl` preenchida.

Essa URL fluía sem alteração para `GitRepositoryTarget.httpUrl`
(`resolveSyncTargets`/`prepareTargets`), e `parallelSync.ts` sempre preferia
`target.httpUrl` a `target.sshUrl` quando presente
(`const cloneUrl = target.httpUrl ?? target.sshUrl`) — inclusive
reescrevendo, a cada sincronização, um remote `git@`/`ssh://` já configurado
para a URL HTTPS+token via `git remote set-url` (`parallelSync.ts`, bloco
logo após a checagem de `!snapshot.hasRemote`). Ou seja: clone/pull/push
usavam HTTPS com o token embutido no lugar de SSH, e um remote SSH
existente era ativamente migrado para HTTPS+token na sincronização seguinte.

**Correção:** `gitSyncService.ts` ganhou um helper `buildPajeHttpUrl(url,
username, token, hasSshAssociation)` que só monta a URL quando
`!hasSshAssociation`, usado nos três pontos citados (o cálculo de
`serverHost`/`hasSshAssociation` foi movido para o topo do loop de
servidores, antes do branch GitHub, que passou a calculá-lo também).
`parallelSync.ts` não precisou mudar a escolha de URL em si (já estava
correta uma vez alimentada com os valores certos vindos do core) — apenas
ganhou o caso simétrico: quando `target.httpUrl` está ausente e o remote
atual já é uma URL HTTPS com prefixo `oauth2:`/`x-access-token:` (ou seja,
foi o próprio PAJÉ quem a configurou, nunca uma URL `https://` qualquer
definida manualmente pelo usuário), ele migra de volta para
`target.sshUrl` — corrigindo automaticamente, na sincronização seguinte,
repositórios já clonados via HTTPS+token antes desta correção.

Cobertura adicionada: `tests/git_sync_ssh_preferred_over_token_test.ts`
(gating de `pajeHttpUrl` nos caminhos de cache-hit e fresh-fetch, GitLab e
GitHub) e `tests/git_parallel_sync_remote_migration_test.ts` (migração de
remote nas duas direções, e não-migração de um remote HTTPS configurado
manualmente pelo usuário).

> **Observação:** durante a escrita do primeiro teste acima foi reproduzida
> uma variante da mesma condição de corrida documentada em `~~BUG-01~~`
> acima (o refresh de status em segundo plano do cache-hit, agendado via
> `setImmediate` em `loadTree()`, regrava `git-tree-cache.json` sem que
> nada aguardasse esse job) — desta vez não vazando para o `~/.paje` real,
> mas fazendo um teste subsequente que também exercita o cache-hit
> encontrar o arquivo de cache reescrito por outro arquivo de teste que já
> havia terminado. Contornado no novo teste com um flush do event loop
> antes de montar suas próprias fixtures; não é um problema em uso real
> (o `HOME` não muda no meio de uma execução do PAJÉ) e a causa raiz (o
> job em segundo plano não é aguardado por ninguém) permanece, então
> qualquer novo teste que combine cache-hit com verificação imediata do
> conteúdo do cache pode precisar do mesmo cuidado.

---

#### ~~BUG-08~~ — `gitCommand.ts` — editar um servidor GitHub (ex.: só o nome) reescrevia `tokenOrigin` para `"personal-access-token"`, mesmo quando o token era de OAuth device flow
**Status: RESOLVIDO**

Relatado pelo usuário: editou o nome de um servidor GitHub já cadastrado via
OAuth device flow (`tokenOrigin: "oauth-device-flow"`, token começando com
`gho_`) e, após salvar, suspeitou que o `tokenOrigin` tinha mudado.
Confirmado direto em `~/.paje/git-servers.json`: o token `gho_...` (formato
de token OAuth, não de PAT) estava com `tokenOrigin: "personal-access-token"`.

`promptAndPersistGitServer()` (fluxo de edição genérico, `gitCommand.ts`)
monta um `GitServerEntry` novo sem copiar `token`/`tokenOrigin` do servidor
existente, e chama `storeGitHubServer(server, session, cliOverrides)` — sem
o 5º parâmetro `tokenOrigin`, que por isso cai no valor default da função,
`"personal-access-token"`. Dentro de `storeGitHubServer`, o token em si é
corretamente reidratado de `existingServer.token` (busca por `baseUrl` em
`git-servers.json`) antes de validar contra a API do GitHub — por isso a
edição "funcionava" (token continuava válido) — mas o `serverWithToken`
gravado usava sempre o `tokenOrigin` do parâmetro da função, nunca o do
servidor já persistido.

**Impacto real:** nenhum na autenticação em si (o token salvo é o mesmo,
válido) — só no campo informativo que `tokenOrigin` alimenta (ver
`docs/arquitetura.md`, tabela de `GitServerEntry`): apontar o usuário para
o lugar certo de revogar/regenerar o token (PAT vs. autorização OAuth).

**Correção:** `storeGitHubServer` agora só usa o `tokenOrigin` do parâmetro
quando não há um token explícito vindo da CLI (`cli.token`) e não há
`existingServer.tokenOrigin` para herdar — ou seja, ao reaproveitar o token
já em disco (edição de nome, sem `--token`), a origem original é preservada.

---

#### ~~BUG-09~~ — `gitCommand.ts` — `~/.ssh/config` era gravado antes de confirmar que o servidor aceitou a chave, deixando o host preso em "Permission denied" sem cair para o token
**Status: RESOLVIDO**

Relatado pelo usuário: cadastrou `git.tse.jus.br` com "Tenho acesso SSH",
depois tentou clonar um repositório e recebeu `git@git.tse.jus.br:
Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password)` —
mesmo com um token GitLab válido (confirmado por `HTTP: GIT-TSE - list
groups/list user projects` bem-sucedidos no log) já salvo para o mesmo
servidor.

`storeSshKeyOnly()` chamava `upsertSshConfigHost(serverHost,
keyInfo.privateKeyPath)` — a escrita em `~/.ssh/config` que
`hasValidSshAssociation()` usa como única fonte de verdade — **antes** de
`ensureGitLabSshKey(...)` (login web + registro da chave no GitLab), sem
reverter nada se esse passo falhasse. Pior: `ensureGitLabSshKey` não estava
nem envolvida em `try/catch` ali, então uma falha subia sem tratamento.
Causa mais provável de falha nesse registro num servidor self-hosted como
este: `runWebFlowOnce` (`sshManager.ts`) só sabe autenticar contra o
formulário LDAP padrão do GitLab (`POST /users/auth/ldapmain/callback`) —
uma instância atrás de SSO/SAML/CAS (comum em ambientes corporativos/
governo) rejeita esse POST, e a validação final ("chave não encontrada")
acaba lançando erro de qualquer forma — mas por essa altura `~/.ssh/config`
já tinha sido escrito.

Antes da correção de `~~BUG-07~~` acima, esse `~/.ssh/config` órfão não
causava falha visível: `pajeHttpUrl` era montada de qualquer forma (sempre
que havia token, independente de SSH), então a sincronização usava HTTPS e
funcionava mesmo com a chave nunca aceita pelo servidor. Depois de
`~~BUG-07~~` fazer o app confiar corretamente na associação SSH local, essa
mesma situação virou uma falha dura: SSH configurado localmente, mas nunca
aceito pelo servidor, sem fallback para o token que já funcionava.

**Correção:** `ensureGitLabSshKey(...)` agora roda dentro de um `try/catch`
que reporta a falha (`cli.errors.gitlab.registerKeyFail`, chave já
existente) e retorna sem gravar nada; `upsertSshConfigHost` só é chamado
depois que esse passo confirma sucesso (ou explicitamente quando
`PAJE_SKIP_SSH_STORE=1`, que continua sendo tratado como "confie sem
verificar", uso interno/testes). `docs/funcionalidades/git-server-store.md`
atualizado para descrever a ordem correta.

**Workaround imediato para quem já ficou nesse estado**: remover o bloco
`Host <servidor>` de `~/.ssh/config` manualmente — a sincronização volta a
usar HTTPS+token automaticamente na próxima carga da árvore.

---

#### ~~BUG-10~~ — `git-server-store` (cadastro/edição de servidor, geração de chave SSH, criação de token) nunca escrevia no arquivo de log
**Status: RESOLVIDO**

Relatado pelo usuário ao investigar o `~~BUG-09~~` acima: o log
(`~/.paje/logs/git-sync-<data>.log`) mostrava a navegação do menu até
"git-server-store" e, ~2h30 depois, a próxima linha já era o retorno ao
menu — todo o cadastro do servidor (escolha do método de autenticação,
geração/reaproveitamento de chave, login web, registro da chave, criação do
token) não deixou nenhum rastro.

Causa: `configureSshKeyStoreCommand()` (comando `git-server-store`) nunca
criava um `LoggerBroker` com transport de arquivo — ao contrário de
`configureGitSyncCommand()` (comando `git-sync`), que sempre cria um logo
no início da action. `storeSshKeyOnly`/`storeGitHubServer` e todo o fluxo em
volta (`promptAndPersistGitServer`, `ensureServerHasCredentials`,
`registerNewGitServer`, `editGitServer`, `manageGitServersInteractively`,
`runGitHubDeviceFlowRegistration`) só recebiam `session`/`cli`, e seu
"logger" interno só chamava `session.showMessage(...)` (modal efêmero da
TUI, nunca persistido) ou `console.log`.

**Correção:** essas funções passaram a receber um `LoggerBroker` (criado em
`configureSshKeyStoreCommand`, com transport de arquivo sempre e painel da
TUI quando há sessão — mesmo padrão de `configureGitSyncCommand`; os dois
pontos em que `git-sync` já chama `ensureServerHasCredentials` passam o
`logBroker` que aquele comando já cria), encadeado por toda a cadeia de
chamadas. O `logger` interno de `storeSshKeyOnly`/`storeGitHubServer` agora
grava no `logBroker` além de mostrar o modal/console — nada mudou na
interface com o usuário, só passou a ficar registrado.

Cobertura adicionada: `tests/git_server_store_logs_to_file_test.ts`
(confirma que o arquivo de log do dia recebe as mensagens do fluxo de
`git-server-store`).

---

#### ~~BUG-11~~ — `storeSshKeyOnly()` tentava gerar/registrar chave SSH mesmo quando o host já tinha uma associação válida (chave já gerada e já cadastrada no servidor)
**Status: RESOLVIDO**

Correção de escopo apontada pelo usuário sobre o `~~BUG-09~~` acima: a
correção original só evitava gravar `~/.ssh/config` sem confirmação — mas o
fluxo inteiro (sondar porta 22, gerar/reaproveitar chave, pedir senha,
logar na web e tentar registrar a chave) continuava rodando **mesmo quando
o host já tinha uma associação SSH válida em `~/.ssh/config`**, isto é,
mesmo quando a chave já estava gerada e já cadastrada no servidor de
antemão (o cenário real do usuário: `git.tse.jus.br` já configurado por
fora do PAJÉ). Rodar esse fluxo de novo nesse caso é redundante na melhor
das hipóteses e, na pior, falha sempre — inclusive pedindo uma senha que
talvez nem exista numa conta autenticada via SSO/SAML/CAS.

**Correção:** `storeSshKeyOnly()` agora verifica `hasValidSshAssociation(host)`
antes de qualquer coisa; se verdadeiro, pula a sondagem de porta, a
geração/reaproveitamento de chave, o pedido de senha e o registro via login
web inteiramente, indo direto para a validação/rotação/criação do token
(a única credencial que ainda pode faltar, usada só pela API REST). O
pedido de senha em si virou preguiçoso (`ensurePassword()`, chamado só onde
ainda é necessário) em vez de incondicional no início do fluxo SSH, para
que esse atalho realmente não peça nada ao usuário quando já existe um
token válido reaproveitável.

Cobertura adicionada: `tests/git_server_store_ssh_already_configured_test.ts`
(host com `~/.ssh/config` pré-configurado e token já válido — confirma que
nenhum prompt interativo acontece e nenhuma chamada ao fluxo de
registro/login web é feita).

---

#### ~~BUG-12~~ — Windows: SSH embutido do Git podia rejeitar uma chave perfeitamente válida ("error in libcrypto: unsupported"), sem nenhum fallback
**Status: RESOLVIDO**

Relatado pelo usuário depois de resolver o `~~BUG-11~~` acima: mesmo com
`~/.ssh/config` correto e a chave já cadastrada no servidor (confirmado
rodando `ssh -T git@<servidor>` manualmente, com sucesso), o clone via PAJÉ
continuava falhando com `Permission denied (publickey,...)`, e o log
mostrava `Load key "...": error in libcrypto: unsupported`.

Causa raiz, isolada comparando os dois clientes SSH da máquina: o `git.exe`
do Git for Windows **não usa o SSH nativo do Windows** — ele sempre invoca
seu próprio `ssh.exe` embutido (`<raiz do Git>\usr\bin\ssh.exe`, build
MSYS2), que nesta versão está ligado a um OpenSSL 3.x que não suporta mais
por padrão certas combinações antigas de cifra/KDF de senha de chave. A
mesma chave, testada com o OpenSSH nativo do Windows
(`%WINDIR%\System32\OpenSSH\ssh.exe`, baseado em LibreSSL), funciona sem
nenhum problema. Ou seja: a chave nunca esteve errada — é uma incompatibilidade
conhecida e específica do binário SSH que o Git for Windows embute, alheia
ao PAJÉ, mas que o PAJÉ pode detectar e contornar sozinho.

**Correção:** `resolveGitSshCommandOverride()` (`sshManager.ts`, Windows
apenas) compara, sob demanda, se o `ssh-keygen` embutido do Git consegue ler
a identidade de um host; se não conseguir e o `ssh-keygen` nativo do Windows
conseguir, retorna o caminho do `ssh.exe` nativo. `ensureKnownHostsForServers`
(`gitSyncService.ts` — já rodava uma vez por host SSH distinto, antes de
qualquer operação git, cache-hit incluso) passou a chamar essa verificação e,
só quando confirmada, define `GIT_SSH_COMMAND` para o resto da execução do
PAJÉ — nunca mexe no `git config` global do usuário, e nunca sobrescreve um
`GIT_SSH_COMMAND` que o usuário já tenha definido. Sem essa comparação
positiva (chave falha no embutido **e** funciona no nativo), não faz nada —
nunca palpita.

Cobertura adicionada: `tests/ssh_manager_git_compat_test.ts` (nenhum
contorno fora do Windows; nenhum contorno quando nenhum dos dois clientes
consegue ler a identidade).

---

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
