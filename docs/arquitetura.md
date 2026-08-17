# Arquitetura do PAJÉ

## Visão geral

O PAJÉ é uma plataforma CLI/TUI escrita em TypeScript (Node.js) que automatiza tarefas
de ambiente para engenharia, com integrações GitLab (gitlab.com e self-hosted) e
GitHub (github.com e GitHub Enterprise Server).

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
│  VSCode → vscode-extension/ (TreeView/comandos) │
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
│  gitlabApi.ts, githubApi.ts, parallelSync.ts    │
│  persistence.ts, gitRepoScanner.ts,             │
│  sshManager.ts, treeBuilder.ts, logger.ts       │
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
- Chamadas HTTP ao GitLab (`gitlabApi.ts`) e ao GitHub (`githubApi.ts`).
- Leitura de estado local de repositórios (`gitRepoScanner.ts`).
- Persistência em `~/.paje` (`persistence.ts`) — servidores, tokens, cache da árvore e env.yaml.
- Escrita de log em arquivo (`logger.ts` — pino).

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
      tui/                     # Componentes Ink reutilizáveis (Layout, modais, painéis)
      gitlabApi.ts             # Infraestrutura — API GitLab
      githubApi.ts             # Infraestrutura — API GitHub (orgs→grupos, repos→projetos)
      parallelSync.ts          # Infraestrutura — execução paralela de git
      gitRepoScanner.ts        # Infraestrutura — leitura de estado local
      persistence.ts           # Infraestrutura — persistência em ~/.paje (servidores, cache, env.yaml)
      envTemplate.ts           # Infraestrutura — modelo comentado do env.yaml, espelha env-template.yaml
      sshManager.ts            # Infraestrutura — SSH e autenticação
      treeBuilder.ts           # Infraestrutura — construção de árvore de grupos/projetos
      patternFilter.ts         # Infraestrutura — filtros Ant/Glob
      logger.ts                # Infraestrutura — PajeLogger (pino, arquivo diário)
      types.ts                 # Tipos do domínio (compartilhados por todas as camadas)
```

---

## Ciclo de testes obrigatório

Após **toda** modificação de código:

```bash
npm run build   # deve terminar sem erros de TypeScript
npm test        # nenhum teste existente pode quebrar
```

- O runner (`tests/run-all.ts`) é tolerante a falhas: um teste que quebra não
  impede os demais de rodar. Verifique sempre a linha final da execução
  ("Todos os arquivos de teste passaram." ou a lista de falhas).
- Testes de TUI usam `tests/tui_test_utils.ts`: TTY simulado (`createFakeTTY`),
  bytes reais de teclado (`KEYS.ctrlP`, `KEYS.ctrlE`, ...), `press()` com espera
  de renderização e `getLastFrame()` para asserções sobre o frame atual.
- Testes de chave SSH requerem `ssh-keygen` (`apt-get install -y openssh-client`
  em containers que não o tenham).

---

## Persistência e configuração

- Configurações e logs locais ficam em `~/.paje/`.
- Servidores são gravados em `~/.paje/git-servers.json`.
- Tokens são gravados em `~/.paje/git-servers.json` (`GitServerEntry.token`) — **único segredo persistido**. Não há campo `password`/`useBasicAuth` no esquema: a senha é usada só em memória para gerar um token ou chave SSH novos (uma vez, no cadastro, ou automaticamente na próxima sincronização de um servidor sem credencial ainda — ver *Fluxo de autenticação por tipo de servidor*) e nunca é gravada em lugar nenhum, nem em `git-servers.json` nem em `env.yaml`.
- A árvore de grupos/projetos é cacheada em `~/.paje/git-tree-cache.json` (ver seção *Cache da árvore*). Tokens **não** são gravados no cache — URLs autenticadas são reidratadas a partir da configuração atual do servidor.
- Parâmetros de sessão podem vir de `~/.paje/env.yaml` ou de `--env-file <caminho>`.
- O editor da TUI (`Ctrl+E`) grava alterações no `env.yaml` via `writeEnvYamlUpdates()` (`persistence.ts`), preservando comentários e convertendo chaves para kebab-case.
- Nenhum dado sensível é persistido no repositório.

### Criação automática do `env.yaml` na primeira execução

`loadEnvConfig()` (`sshManager.ts`) é o único ponto de leitura do arquivo de
ambiente e é chamado por toda camada de apresentação (CLI, TUI, extensão
VSCode) — tanto para resolver `GitSyncConfig` (`git-sync`) quanto para exibir
os parâmetros carregados de `git-server-store`. Ao ser chamado com o caminho
padrão (`~/.paje/env.yaml` — sem `--env-file` explícito), ele garante a
existência do arquivo antes de ler:

```typescript
export const loadEnvConfig = (options: { envFile?: string } = {}): EnvConfig => {
  const defaultPath = resolveDefaultEnvYamlPath();   // computado a cada chamada
  const targetPath = options.envFile ?? defaultPath;

  if (targetPath === defaultPath) {
    ensureEnvYamlExists(targetPath);   // cria a partir do template, se ausente
  }
  // ... lê e faz parse de targetPath
};
```

- `ensureEnvYamlExists()` (`persistence.ts`) só escreve se o arquivo **não existir**
  — idempotente; nunca sobrescreve edições do usuário em chamadas subsequentes.
- O conteúdo escrito é `ENV_TEMPLATE_CONTENT` (`envTemplate.ts`), uma constante
  TypeScript com o texto **idêntico** a [`env-template.yaml`](../env-template.yaml)
  (raiz do repositório) — comentários incluídos. O template é embutido como
  string (não lido do disco em runtime) porque o núcleo roda em contextos onde
  o caminho da raiz do repositório não é resolvível de forma confiável (bundle
  da extensão VSCode via esbuild, `tsx` executado fora do diretório do
  projeto). Um teste (`env_yaml_write_test.ts`) garante que os dois arquivos
  nunca divirjam.
- **Escopo restrito ao caminho padrão**: um `--env-file <caminho>` explícito
  apontando para um arquivo inexistente **não** aciona a criação automática —
  preserva o comportamento anterior (retorna config vazia), usado por testes e
  configurações avançadas que dependem de um arquivo ausente/mínimo.
- `resolveDefaultEnvYamlPath()` (e o array de fallback de `loadGitCredentials`)
  são computados **a cada chamada** via `os.homedir()`, não em uma constante
  fixada no carregamento do módulo — necessário para que a detecção de
  primeira execução funcione corretamente independente de quando o módulo foi
  importado pela primeira vez no processo. `gitCommand.ts` importa
  `resolveEnvFileFromCli` de `core/envResolver.ts` pelo mesmo motivo — uma
  cópia local com o caminho padrão fixado em constante de módulo já existiu
  ali e foi removida (violava a regra de não duplicar funções do core, além de
  poder resolver para um `HOME` desatualizado).
- `writeEnvYamlUpdates()` (usado pelo editor `Ctrl+E`) segue a mesma regra na
  direção inversa: se o arquivo alvo de uma atualização não existir no momento
  da gravação, a gravação parte do template completo em vez de um arquivo em
  branco — nenhuma atualização, mesmo a primeira, pode produzir um arquivo sem
  comentários.

---

## Cache da árvore (`git-tree-cache.json`)

O `loadTree()` (`gitSyncService.ts`) implementa carga instantânea:

1. Calcula `configHash` a partir dos servidores configurados (nome, URL normalizada, filtros).
2. **Cache hit** (hash igual): a árvore é montada imediatamente a partir do cache (`fromCache: true`) e um refresh de status é agendado com `setImmediate`:
   - o status local de cada repositório é recalculado com **concorrência limitada a 4** (um subprocesso git por repositório — sem limite, dezenas de processos simultâneos saturariam a máquina e travariam a TUI);
   - cada status é entregue **incrementalmente** via callback `onStatusRefreshed(projectId, status)` — a TUI atualiza linha a linha;
   - ao final, o cache é regravado com o `statusMap` atualizado.
3. **Cache miss** (hash diferente ou sem cache): carga completa via API; ao final o cache é gravado (sem `pajeHttpUrl`, que contém token).

O cache **não tem TTL** — é invalidado apenas por mudança de configuração de servidores.

Na camada de apresentação (`gitCommand.ts`), statuses que chegam antes de a TUI montar
são bufferizados e aplicados no `onReady` da árvore.

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
| Tipo do servidor (`git-server-store`) | `--server-type` | — | auto-detectado pela URL |
| PAT do GitHub (`git-server-store`) | `--token` | — | `""` |
| Bootstrap de token via senha, sem chave SSH (`git-server-store`) | `--use-basic-auth` | `useBasicAuth` | `false` |
| Usuário GitLab | `--username` | `username` | `""` |
| E-mail Git | `--user-email` | `userEmail` | `""` |
| Senha (bootstrap único de token/chave SSH) | `--password` | — (nunca lida de `env.yaml`) | `""` |
| Nome da chave SSH | `--key-label` | `keyLabel` | `""` |
| Passphrase da chave SSH | `--passphrase` | `passphrase` | `""` |
| Caminho da chave pública existente | `--public-key-path` | `publicKeyPath` | `""` |
| Ocultar repos públicos | `--no-public-repos` | `noPublicRepos` | `false` |
| Ocultar repos arquivados | `--no-archived-repos` | `noArchivedRepos` | `false` |
| Filtro Ant/Glob de path (allow-list) | `--filter` | `filter` | `""` |
| Filtro Ant/Glob de exclusão (deny-list) | `--exclude-filter` | `excludeFilter` | `""` |
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
| `type` | `"gitlab" \| "github"?` | Tipo do servidor; ausente = `gitlab`. Detectado pela URL no registro (`github.com` → `github`) ou forçado com `--server-type` |
| `baseUrl` | `string` | URL base do servidor |
| `username` | `string?` | Usuário GitLab — usado só para reautenticar (bootstrap de token) quando necessário, nunca para autenticação corrente |
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
| `tokenOrigin` | `"personal-access-token" \| "oauth-device-flow"?` | De onde o token salvo veio — indica ao usuário onde revogá-lo/gerá-lo de novo (ex.: PAT de um lugar, autorização OAuth de outro). Ausente = tratado como `"personal-access-token"`. Todo ponto que grava/renova um token deve passar por `withToken()` (`core/gitSyncService.ts`) em vez de um spread manual, para nunca deixar este campo esquecido. |

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

### `excludeFilter` — lista de exclusão (deny-list)

Ao contrário de `filter` (allow-list, com variante por servidor), `excludeFilter`
existe **só** como parâmetro global de sessão (`env.yaml`/`--exclude-filter`) —
não há campo equivalente em `GitServerEntry`. Um projeto é excluído se qualquer
um dos mesmos candidatos usados por `filter` (`path_with_namespace`,
`pajeOriginalPathWithNamespace`, `namespace.full_path`, `namespace.full_path/name`)
casar com algum padrão; `matchesAntPatterns` trata lista de padrões vazia como
"casa tudo" (comportamento certo para `filter`, onde ausência de filtro mostra
tudo) — `filterProjects()` guarda esse caso explicitamente para `excludeFilter`
vazio nunca excluir nada.

`filterProjects()` só filtra projetos; `filterGroups()` (mesmo arquivo) faz o
equivalente para grupos, comparando `group.full_path`, e é aplicado junto de
`filterProjects()` nos dois pontos globais de `loadTree()` (cache-hit e
fresh-fetch), nunca nos filtros por servidor. Um padrão terminado em `/**`
(ex.: `grupo/**`) casa tanto o `full_path` do próprio grupo quanto qualquer
descendente em qualquer profundidade — por isso excluir uma pasta cascateia
para todos os subgrupos e projetos dentro dela sem lógica extra de recursão.
Esse é o único formato de padrão que cascateia de verdade: um padrão exato de
grupo (sem `/**`) só remove aquele grupo, e os filhos dele "sobem" para a raiz
da árvore (mesmo comportamento que `buildGitLabTree` já tem para qualquer
grupo sem pai presente na lista). A ação `Ctrl+D` na TUI sempre gera o padrão
com `/**` para grupos — esse caso só é relevante para quem edita `env.yaml` à
mão.

Na TUI, `Ctrl+D` no item destacado (`tui.app.tsx`) abre um modal de confirmação
(`ExcludeModal`) com o padrão exato que será adicionado — `path_with_namespace`
para um projeto, `full_path + "/**"` para um grupo, ambos pré-computados por
`buildGitLabTree()` em `GitLabTreeNode.excludePattern`. Ao confirmar: o padrão é
mesclado ao valor atual de `excludeFilter` e gravado via `writeEnvYamlUpdates()`
(mesmo precedente de `EditParamsModal.tsx` — presentation chamando
`persistence.ts` direto para essa gravação pontual de uma chave), e o nó (e
toda a subárvore, se for grupo) é removido da árvore em memória via
`removeTreeNodes()` (`treeBuilder.ts`) para feedback instantâneo, sem esperar
recarregar — quem garante que o item não volta nas próximas sincronizações é o
valor já persistido em `env.yaml`.

### Operações de branch em massa e renomear (`gitBranchService.ts`)

Além do fluxo por repositório já existente (`Ctrl+B`: trocar/criar branch),
`core/gitBranchService.ts` expõe operações que atuam sobre **todos os
repositórios marcados com checkbox** de uma vez (nunca com fallback implícito
para o item destacado se nada estiver marcado — mutar várias working trees a
partir de "0 marcados" viraria "1 alvo arbitrário" silenciosamente, então
`Ctrl+K`/`Ctrl+R` só avisam e não abrem nada nesse caso):

- **`Ctrl+K` — checkout em massa, com opção de criar.** Pede o nome da branch
  (`TextInputModal`), faz uma checagem só de leitura (`checkBranchAvailability`,
  via `hasRef` — nunca dispara um checkout sozinho) pra saber em quais
  repositórios a branch já existe. Se existir em todos, troca direto. Se faltar
  em algum, um `ConfirmModal` nomeia os que faltam e explica os dois caminhos
  antes de perguntar — `Enter` cria e envia ao remoto nesses também,
  `Esc` troca só onde já existe e pula o resto — antes de rodar
  `checkoutOrCreateBranchBulk`.
- **`Ctrl+R` — voltar em massa para a branch padrão** de cada repositório
  marcado (`project.default_branch`, que é opcional — `checkoutDefaultBranchBulk`
  pula, sem travar o lote, quem não tiver essa informação). Confirmação direta,
  sem passo de nome.
- **Renomear** (dentro do `Ctrl+B` já existente, opção "✎ Renomear branch
  atual" — não é operação em massa, atua só no repositório destacado):
  `renameBranch()` faz `git branch -m` local sempre, e só mexe no remoto se o
  clone tiver um (`readLocalRepoInfo(targetPath).remoteUrl` — o mesmo sinal que
  `resolveRepoStatus` já usa, não metadado da API). Empurra o nome novo com
  `git push -u origin <novo>` (fixa o tracking em um passo, já que `git branch -m`
  preserva o upstream antigo apontando pro remoto que está prestes a sumir)
  **antes** de apagar o antigo do remoto, pra nunca deixar a branch com zero
  cópias no remoto se algo falhar no meio. Se só o `--delete` falhar, a
  renomeação em si já terminou — vira aviso, não erro.

As operações em massa rodam sequencialmente (nunca em paralelo — mexem em
working tree, então paralelizar arriscaria colidir com uma sincronização em
andamento) e capturam erro por item: um repositório falhando (ex.: mudanças
não commitadas que o próprio git recusa sobrescrever) não derruba o lote
inteiro, só aparece como `"failed"` no resultado daquele item. Nenhuma dessas
funções constrói texto pro usuário — devolvem só dados estruturados
(status/motivo em código, texto bruto do erro do git), a apresentação
(`tui.app.tsx`) que monta a mensagem certa por `t()`. Um novo
`branchOpInProgressRef` (irmão do `syncInProgressRef` já existente) impede
essas operações de rodar ao mesmo tempo entre si ou junto de uma sincronização.

### Tag ARQUIVADO na árvore

`GitLabProject.archived?: boolean` já era populado de ponta a ponta pelas
APIs do GitLab/GitHub e usado para filtrar (`noArchivedRepos` em
`gitSyncService.ts`), mas nunca era exibido. `tui.app.tsx` passa esse campo
adiante em `FlatTreeItem`/`flattenTree` e `TreeRowComponent` renderiza uma
tag `ARQUIVADO`/`ARCHIVED` (cor cinza, distinta de toda cor já usada pra
servidor/branch/estado de sync) dentro do mesmo grupo de colchetes já usado
pra servidor/branch/status, antes desses — qualifica a linha inteira, não
compete por um segundo espaço à direita. `hasInfo` (o que decide se o grupo
de colchetes aparece) passa a considerar `item.archived` também, senão um
projeto arquivado ainda sem `status` resolvido não mostraria nada.

### Sair no diretório do repositório destacado (`Ctrl+Q`)

Como o `Ctrl+B` de renomear, esta é uma operação de **um repositório só**
(o destacado pelo cursor, não os marcados com checkbox) — o pedido original
não foi "em massa". Exige um nó `type: "project"` com `localPath` que já
seja um clone git real em disco (`hasGitDir`, o mesmo já usado por
`resolveRepoStatus`); nó de grupo, sem clone, ou path inexistente só loga um
aviso e não abre nada — mesma regra de "sem fallback pro item destacado"
que rege `Ctrl+K`/`Ctrl+R`, agora ao contrário (aqui o destacado É o alvo,
mas ainda precisa ser válido antes de mexer em qualquer coisa). Como é uma
ação surpreendente e não reversível no meio da sessão (encerra o app
inteiro), passa por um `ConfirmModal` antes.

**Por que isso precisa de mais que `cd`:** um processo filho nunca consegue
mudar o diretório do shell que o chamou — limitação do sistema operacional,
não do PAJÉ. `paje` (Linux/macOS/WSL) é um symlink pra `paje.sh`; rodar
qualquer script por nome sempre cria um processo bash/zsh novo. No Windows,
`paje` resolve pra `paje.cmd`, que sempre chama
`powershell -File paje.ps1` como processo novo — e mesmo um `.cmd` rodando
direto no cmd.exe não escapa disso (cmd.exe executa um `.cmd` como processo
filho igual a qualquer executável; só comando digitado direto no prompt
persiste `cd`). Ou seja, não existe solução "de graça" em nenhuma das
plataformas.

A solução adotada — **cd persistente via função de shell**, escolhida
explicitamente pelo usuário ao ser perguntado sobre as opções — é: `Ctrl+Q`
grava o path absoluto em `~/.paje/cd-target` (`writeCdTarget`, texto puro,
em `persistence.ts`, mesmo padrão de `writeGitServers`/`writeGitTreeCache`)
e resolve a tela da árvore com `TuiSelectionResult.exitToDirectory` setado
(reaproveitando exatamente a limpeza de `commitResolve` — mesmo
`resolvedRef`, mesmo `session.releaseScreen`, só resolvendo com um campo a
mais). `gitCommand.ts` (o único lugar que chama `renderRepositoryTree` e,
até aqui, descartava o retorno) captura esse resultado e, se
`exitToDirectory` estiver setado, chama `process.exit(0)` — a única exceção
deliberada a "sem `process.exit` neste código", e por isso só existe ali:
não em `tui.app.tsx` (que continua sendo um componente Ink puro, sem
controlar o ciclo de vida do processo) nem em `cli.ts` (cujo `while(true)`
genérico também atende `git-server-store`, que não tem nada a ver com isso).

O `~/.paje/cd-target` só é escrito pelo Node; quem lê e apaga é sempre uma
**função de shell**, instalada pelo instalador: `ensure_paje_shell_function`
em `install-paje.sh` acrescenta uma função `paje()` ao `.bashrc`/`.zshrc`/
`.profile` (mesmo padrão idempotente — marcador exato via `grep -Fxq` — de
`ensure_paje_on_path`), e `Confirm-PajeShellFunction` em `install-paje.ps1`
faz o equivalente no `$PROFILE` do PowerShell. Em ambos os casos, a função
sombreia o comando `paje` do PATH (`command paje "$@"` no bash/zsh; a
resolução de comando do PowerShell já prioriza função sobre executável
externo), chama o binário de verdade, e só depois lê+apaga o arquivo
incondicionalmente (tolerante a arquivo ausente — sem erro, sem `cd`).
Único leitor, único momento de apagar — não há dois consumidores disputando
o mesmo arquivo. **cmd.exe puro (sem a função do PowerShell) não ganha essa
funcionalidade** — decisão deliberada, já que este projeto trata PowerShell
como shell principal no Windows e uma solução via `doskey`/registro
`AutoRun` seria superfície nova desproporcional ao tamanho desta evolução;
`paje.cmd` não é tocado.

**O outro lado dessa mesma volta** (`RF-10`): quando a árvore do git-sync
abre, ela tenta posicionar o cursor no repositório correspondente ao
diretório de onde o `paje` foi chamado — mas `paje.sh`/`paje.ps1` fazem
`cd`/`Set-Location` para o diretório de instalação do PAJÉ **antes** de
iniciar o processo Node (necessário pra rodar `npm run dev` a partir da
raiz do projeto), o que apagava o diretório original do
`process.cwd()` visto pelo código — o cursor sempre "via" o próprio
diretório do PAJÉ, nunca o do usuário. Os dois scripts agora capturam o
diretório de invocação **antes** desse `cd` e exportam em
`PAJE_INVOKED_FROM`; `gitCommand.ts` lê essa variável (caindo em
`process.cwd()` só quando ausente, ex.: `npm run dev` chamado direto em
desenvolvimento) e passa como `cwd` explícito pro
`git rev-parse --show-toplevel` que resolve o repositório atual — sem
precisar `cd` o processo Node em si. Isso fecha o ciclo com o `Ctrl+Q`: sair
num diretório e chamar `paje` de novo de lá deve reabrir a árvore já
destacando aquele mesmo repositório.

### Fluxo de autenticação por tipo de servidor

Modelo *token-first*: todo servidor registrado termina com um token (único
segredo persistido) e/ou uma chave SSH associada ao host em `~/.ssh/config` —
nunca com uma senha, e nunca preso num estado intermediário sem nenhuma
credencial persistente.

| Servidor | Modo | Operações git usam |
|---|---|---|
| GitLab, com chave SSH associada ao host | SSH + token | URL `ssh_url_to_repo` via `~/.ssh/config` para clone/push; token para a API (listar grupos/projetos) — as duas credenciais são usadas juntas, cada uma para sua finalidade |
| GitLab, só token (sem chave SSH) | HTTPS + PAT | `pajeHttpUrl` com `oauth2:<token>@host` embutido |
| GitHub (`type: "github"`) | HTTPS + PAT ou OAuth (device flow) | `pajeHttpUrl` com `x-access-token:<token>@host` embutido — a origem do token (`tokenOrigin`) não muda como ele é usado depois |

O cadastro (`git-server-store`, TUI) pergunta o método de autenticação antes
de pedir a URL do servidor (para não obrigar a digitar a URL só para
descobrir que a única opção válida para GitHub é colar um token), então a
primeira opção da lista é um atalho dedicado ao GitHub; as outras 3 opções
seguintes assumem GitLab e terminam todas no modelo acima:
0. **Quero me autenticar ao github.com** — roda o **device flow OAuth** do
   GitHub (`githubDeviceFlow.ts`, infraestrutura): pede um código de
   dispositivo (`POST /login/device/code`), tenta abrir o navegador sozinho
   nessa URL (`openInBrowser` — melhor esforço via `open`/`xdg-open`/`start`
   conforme o SO; se falhar, o código e a URL de verificação continuam
   visíveis para o usuário abrir manualmente), e faz polling em
   `POST /login/oauth/access_token` até o usuário autorizar (respeitando
   `authorization_pending`/`slow_down`) ou o código expirar/ser negado. O
   token resultante é validado e persistido exatamente como um token colado
   (`storeGitHubServer`), só que com `tokenOrigin: "oauth-device-flow"` em
   vez de `"personal-access-token"` — não existe uma 4ª forma de guardar o
   token, só uma 2ª forma de obtê-lo, sem digitar URL, usuário, senha nem
   token nenhum. O Client ID usado (`GITHUB_OAUTH_CLIENT_ID`) é de um OAuth
   App do próprio PAJÉ com "Device Flow" habilitado — não é segredo (Client
   IDs de device flow são públicos por definição) e por isso fica embutido
   no código, sem precisar de configuração por usuário. Restrito a
   `github.com`; GitHub Enterprise Server continua exigindo colar um token.
1. **Tenho acesso SSH (recomendado)** — o fluxo SSH tradicional; o PAJÉ verifica
   proativamente se a porta 22 está acessível antes de tentar o setup (se
   bloqueada, orienta a escolher uma das outras opções). Gera a chave **e** um
   token — nunca só a chave.
2. **Não tenho SSH, mas tenho usuário e senha** — a senha é usada uma única vez
   para gerar um token via login web no GitLab; nunca é persistida.
3. **Já tenho um token pessoal** — cola o token diretamente; validado antes de
   ser persistido. Nenhuma senha é pedida.

Para GitHub não há opção de senha (o GitHub não suporta esse fluxo): o registro
sempre detecta um token existente ou pede para colar um, valida via `GET /user`
e persiste o servidor com o login retornado. Se a URL informada já for
reconhecida como GitHub (`type` do servidor existente, ou uma URL passada via
`--base-url`) a pergunta de método de autenticação nem aparece — vai direto
para o fluxo de token.

Um servidor já cadastrado sem token e sem chave SSH (ex.: de uma versão
anterior do PAJÉ, ou um cadastro interrompido) não fica travado: na próxima
`git-sync`, o bootstrap roda automaticamente — pede a senha uma única vez,
gera e persiste o token, e a sincronização continua sem precisar reiniciar
(`GitSyncLoadOptions.onMissingCredentials` em `core/gitSyncService.ts`).

Para GitHub não há fluxo SSH: o registro valida o PAT via `GET /user` e persiste o
servidor com o login retornado. Em `loadTree()`, o `GitHubApi` mapeia organizações
para `GitLabGroup[]` (o login do usuário também vira um grupo pessoal) e repositórios
para `GitLabProject[]`, de modo que todo o restante do pipeline (árvore, filtros,
sincronização) é agnóstico do provedor. Em GitHub Enterprise Server a API é resolvida
como `<baseUrl>/api/v3`; em github.com, `https://api.github.com`.

### Garantia de `known_hosts` antes de qualquer operação git

`ensureKnownHost`/`hasValidSshAssociation` (`core/gitSyncService.ts`) já
rodavam por servidor dentro do laço de busca na API (via `ensureSshKey`),
mas **só no caminho sem cache** — quando `loadTree()` responde a partir de
`~/.paje/git-tree-cache.json` (`cached.configHash === configHash`), esse
laço inteiro é pulado, e com ele a checagem de `known_hosts`. Numa máquina
onde `~/.paje` existe (config + cache) mas `~/.ssh` está incompleto (ex.:
copiado parcialmente, ou uma instalação nova que nunca rodou
`git-server-store` nesta máquina), isso significa que a primeira operação
SSH de verdade só acontecia dentro do `syncSelected()` — com N clones/fetches
em paralelo, cada um preso numa pergunta interativa do SSH
(`Are you sure you want to continue connecting...`) que nenhum processo em
segundo plano tem como responder, travando a sincronização inteira sem
mensagem de erro nenhuma.

`ensureKnownHostsForServers(servers, logger, verbose)` corrige isso rodando
**uma vez, incondicionalmente**, logo depois que `listServers()` resolve a
lista de servidores em `loadTree()` — antes até da checagem de cache. Para
cada host com associação SSH válida (`hasValidSshAssociation`, a mesma
checagem já usada em `ensureSshKey`), verifica `isHostInKnownHosts` e, se
faltar, chama `addHostToKnownHosts` (`ssh-keyscan`) automaticamente — sem
pedir confirmação (diferente do fluxo de cadastro em `gitCommand.ts`, que
pergunta antes de adicionar; aqui o servidor já foi explicitamente
registrado pelo usuário em algum momento, então adicionar o host ao
`known_hosts` desta máquina é apenas completar essa confiança já dada, não
concedê-la de novo). `ensureKnownHost` loga em `warn` quando detecta o host
ausente e em `info` quando adiciona com sucesso — sempre visível no log,
não só em modo `--verbose`.

### Detecção reativa de token inválido/expirado

Um token salvo pode parar de funcionar a qualquer momento (expiração, revogação
manual, política de expiração do servidor). O PAJÉ não valida o token
proativamente a cada `git-sync` (custo extra de API mesmo quando o token está
ok); em vez disso, reage quando `listGroups`/`listUserProjects` já falharam com
401/403 (`loadTree()`, `core/gitSyncService.ts`) — tanto `GitLabApi` quanto
`GitHubApi` anexam `status`/`error.details.status` ao erro lançado, o que
permite ao core distinguir essa falha de um erro de rede genérico de forma
uniforme para os dois tipos de servidor.

A cura possível depende do que o servidor suporta:

- **GitLab** — cadeia de cura em 3 passos, cada um só tentado se o anterior
  falhar: (1) `rotatePersonalAccessToken` (`sshManager.ts`) — não precisa de
  senha nem de interação do usuário, já que usa o próprio token (ainda válido
  para rotação mesmo se rejeitado para listagem) via
  `POST /api/v4/personal_access_tokens/self/rotate`; (2) se a rotação também
  falhar (token de fato revogado, não só expirado), `onMissingCredentials(server,
  "invalid")` — mesmo gancho já usado para "nunca teve token", pedindo a senha
  uma única vez e gerando um novo via login web; (3) se ambos falharem, loga
  `cli.sync.tokenExpired` e pula o servidor. Qualquer cura bem-sucedida persiste
  o novo token (`withToken` + `mergeServer` + `writeGitServers`) e repete a
  listagem antes de seguir em frente — a sincronização continua na mesma
  execução, sem precisar reiniciar.
- **GitHub** — não há rotação silenciosa nem bootstrap por senha (o GitHub não
  suporta nenhum dos dois fluxos hoje); a única cura possível é uma mensagem
  clara (`cli.sync.githubTokenExpired`) orientando a rodar `git-server-store` e
  colar um token novo. A cura automática de verdade para GitHub é o device flow
  OAuth (funcionalidade futura), que poderá plugar em `onMissingCredentials` do
  mesmo jeito que o GitLab já faz.

`onMissingCredentials` recebe um `reason: "missing" | "invalid"` — `"missing"`
é o caso pré-existente (nunca houve token nem chave SSH associada); `"invalid"`
é este caso novo (havia um token, mas ele foi rejeitado e a rotação não
resolveu). A camada de apresentação (`gitCommand.ts`, `vscode-extension`) usa o
motivo só para ajustar a mensagem do prompt — a lógica de bootstrap em si
(pedir senha, `ensureGitLabPersonalAccessToken`, persistir) é a mesma.

## Componentes de TUI

O layout padrão em Ink é composto por:

- Barra de título (`TitleBar`) — 1 linha no topo.
- Área de trabalho (`Workspace`) — árvore de repositórios.
- Barra de orientação (`OrientationBar`) — atalhos e comandos.
- Painel de log (`LoggerPanel`) — ocupa 15% da tela, na parte inferior; colorização
  por nível com ANSI manual (chalk desabilita cores fora de TTY real) e truncamento
  em uma linha física por entrada.

Modais sobrepostos ao layout (`layout.tsx`):

- `ParametersModal` (`Ctrl+P`) — parâmetros carregados, somente leitura.
- `EditParamsModal` (`Ctrl+E`) — edição do `env.yaml` com pendências e `Ctrl+S` para gravar.
- `HelpModal` (`Ctrl+H`) — atalhos por contexto, executáveis a partir do modal.
- `BranchModal` (`Ctrl+B`, na árvore) — seleção/criação/renomeação de branch.
- `ExcludeModal` (`Ctrl+D`, na árvore) — confirmação de exclusão da árvore (ver
  seção `excludeFilter` acima).
- `ConfirmModal` (`modalType: "confirm"`) — confirmação genérica (título + mensagem
  + detalhe opcional), reaproveitada por qualquer fluxo que só precise de um
  Enter/Esc simples — hoje usada pelos dois passos de confirmação do checkout
  em massa e voltar ao padrão (`Ctrl+K`/`Ctrl+R`, ver seção de branch abaixo).
- `TextInputModal` (`modalType: "text-input"`) — campo de texto único genérico
  (mesmo input caractere-a-caractere que o `BranchModal` já usava para criar
  branch, isolado como modal próprio); hoje usado só pelo nome da branch do
  checkout em massa.

**Regra de posse do teclado:** modais de workflow (`edit-params` e `branch`) são donos
do teclado enquanto abertos — o `Layout` não processa `Esc`/`Ctrl+P`/`Ctrl+H`/`Ctrl+E`
nesses estados (trocar de modal descartaria estado pendente). Os demais modais
(`exclude`, `confirm`, `text-input`) não precisam dessa regra: não têm sub-estado
que valha a pena preservar contra um `Esc` genérico do `Layout` — fechar e cancelar
dão no mesmo. `Ctrl+C` funciona sempre, inclusive com modal aberto.

**Atalhos e bytes de terminal:** o terminal envia o mesmo byte para `Ctrl+M` e `Enter`
(`0x0d`) e o byte de backspace para `Ctrl+H` (`0x08`; a tecla Backspace física envia
`0x7f`). Por isso a pesquisa por nome na árvore usa `Ctrl+F` (que precisa ser pressionado
para entrar no modo de pesquisa antes de digitar) e o filtro de itens marcados usa
`Ctrl+X`; o `Layout` aceita `key.backspace` como abertura da ajuda apenas em telas sem
campo de texto ativo (prop `helpOnBackspace`).

## Extensão VSCode (`vscode-extension/`)

Terceira camada de apresentação sobre o mesmo core:

- `extension.ts` — ativação: registra a TreeView, comandos (`paje.refreshTree`,
  `paje.syncSelected`, `paje.syncNode`, `paje.openRepository`, `paje.openEnvFile`)
  e um Output Channel "PAJÉ" ligado ao `LoggerBroker` via `createPanelTransport`.
- `pajeTreeProvider.ts` — `TreeDataProvider` com checkboxes
  (`toggleTreeNode`/`recomputeTreeSelection` do treeBuilder).
- `treeAdapter.ts` — mapeamento puro `GitLabTreeNode` → descritor de TreeItem,
  **sem importar o módulo `vscode`**, testável pela suíte principal
  (`vscode_tree_adapter_test`).
- Config e persistência idênticas à CLI/TUI: `resolveGitSyncConfig()` sem flags,
  `~/.paje/git-servers.json`, cache instantâneo da árvore.
- Bundle via esbuild (`npm run build:vscode`) → `dist/extension.cjs` (CJS único
  com o core embutido; `external: ["vscode"]`). O pacote da extensão é
  `"type": "module"` para os fontes; o runtime CJS fica explícito no `.cjs`.
- A regra de camadas vale aqui também: a extensão **não** importa Ink/React nem
  reimplementa lógica do core — o smoke test (`vscode_extension_smoke_test`)
  ativa o bundle real com um mock do módulo `vscode`.

## Logging (pino)

O pipeline de log usa [pino](https://getpino.io) como motor:

- `LoggerBroker` (`core/loggerBroker.ts`) — fachada com `debug/info/warn/error`;
  serializa via pino e distribui `LogEntry` aos transports registrados, com
  filtragem por `minLevel` por transport (`setTransportLevel`).
- `PajeLogger` (`logger.ts`) — escrita no arquivo diário `~/.paje/logs/git-sync-YYYY-MM-DD.log`
  via pino + pino-pretty (formato legível). Usa **instância compartilhada por arquivo**
  (singleton) — instâncias por componente vazariam fds e disparariam avisos de
  MaxListeners no stderr, corrompendo a TUI.
- Transports (`core/loggerTransports.ts`):
  - `createConsoleTransport` — **obrigatoriamente** via `console.log`/`console.error`:
    o Ink intercepta o console para desenhar acima da UI; escrever direto no fd 1
    corrompe o frame.
  - `createFileTransport` — delega ao `PajeLogger` (debug é prefixado `[DEBUG]`).
  - `createGlobalPanelTransport` — alimenta o `logStore` global do painel TUI.
- Níveis padrão: console `info`; painel TUI `info` (`debug` com `--verbose`);
  arquivo `info` (`debug` com `--verbose`).

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
- Pino + pino-pretty para logging.
- Cheerio para fluxos web.
- Tough-cookie para sessões.

## Documentos relacionados

| Documento | Conteúdo |
|---|---|
| `auditoria-arquitetura.md` | 16 problemas arquiteturais conhecidos com localização exata |
| `auditoria-codigo.md` | Bugs, inconsistências e débitos técnicos — abertos e resolvidos |
| `requisitos-tui-git-sync.md` | Requisitos funcionais e de usabilidade da TUI git-sync |
