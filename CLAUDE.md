# CLAUDE.md — Regras obrigatórias para agentes

Este arquivo é lido automaticamente a cada sessão. Todas as regras abaixo são
**obrigatórias**. Nenhuma evolução pode ser iniciada sem respeitar estas regras.

---

## 1. Arquitetura em camadas — REGRA FUNDAMENTAL

O PAJÉ é organizado em três camadas. **Cada camada tem responsabilidades exclusivas.**
Violar essa separação é o erro arquitetural mais grave registrado no projeto
(ver `docs/auditoria-arquitetura.md`).

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
│  gitlabApi.ts, githubApi.ts, parallelSync.ts    │
│  persistence.ts, gitRepoScanner.ts,             │
│  sshManager.ts, treeBuilder.ts, logger.ts       │
└─────────────────────────────────────────────────┘
```

### O que pertence a cada camada

| Camada | Permitido | Proibido |
|---|---|---|
| **Apresentação (CLI/TUI)** | Ler parâmetros do usuário; chamar métodos do core; formatar e exibir resultados; callbacks de progresso/log | Chamar `GitLabApi` diretamente; implementar lógica de filtragem, resolução de paths ou sincronização; importar `parallelSync` diretamente; duplicar funções do core |
| **Core** | Toda lógica de negócio: filtrar projetos, resolver paths, preparar alvos, orquestrar sincronização, construir sumário | Saber como o resultado será exibido; depender de tipos de apresentação (Ink, Commander) |
| **Infraestrutura** | Execução de comandos git, chamadas HTTP ao GitLab, leitura/escrita em disco, SSH | Conter lógica de negócio; conhecer detalhes da apresentação |

### Regras de chamada — o que é PROIBIDO na camada de apresentação

- **Nunca** chamar `GitLabApi`/`GitHubApi` (ex.: `listUserProjects()`) ou qualquer método de API fora do core.
- **Nunca** chamar `parallelSync()` diretamente — use `core.syncSelected()`.
- **Nunca** reimplementar `filterProjects`, `prepareTargets`, `resolveLocalPathConflicts`,
  `resolveSyncTargets`, `resolveRepoStatus`, `resolveSyncReposSpecs` ou `buildSummary`.
  Se precisar dessas operações, exporte-as do core e importe de lá.
- **Nunca** duplicar uma função que já existe no core ou na infraestrutura.

### Ponto de entrada obrigatório para git-sync

```typescript
// CORRETO — tanto CLI quanto TUI devem seguir este padrão
const core = createGitSyncCore();
const { header, tree, statusMap } = await core.loadTree({ config, logger });
// ... apresentar a árvore (CLI imprime / TUI renderiza)
const { summary } = await core.syncSelected({ config, logger, tree, handlers });
// ... apresentar o sumário
```

---

## 2. Antes de qualquer evolução — checklist obrigatório

Antes de escrever ou modificar qualquer código:

1. **Leia** `docs/arquitetura.md` — entenda a camada que será alterada.
2. **Leia** `docs/auditoria-arquitetura.md` — verifique se o ponto que você vai tocar
   já é um problema conhecido. Se for, corrija no sentido da arquitetura correta,
   não no sentido do código atual.
3. **Leia** `docs/requisitos-tui-git-sync.md` — para qualquer mudança no fluxo
   git-sync (CLI ou TUI).
4. **Leia** `docs/auditoria-codigo.md` — para não reintroduzir bugs já identificados.
5. **Identifique a camada** — a mudança pertence à apresentação, ao core ou à
   infraestrutura? Se a lógica for de negócio, ela vai no core.

---

## 3. Ciclo de testes — obrigatório após toda modificação

Após qualquer alteração de código:

```bash
npm run build   # compilação TypeScript — deve terminar sem erros
npm test        # suite completa — nenhum teste existente pode quebrar
```

- Se `npm run build` falhar, **não faça commit**.
- Se `npm test` introduzir novas falhas, **não faça commit**.
- O runner (`tests/run-all.ts`) é tolerante a falhas: um teste que quebra não
  impede os demais de rodar; ao final é impresso um resumo e o exit code
  reflete o resultado. **Nunca confie em uma execução parcial** — verifique a
  linha final ("Todos os arquivos de teste passaram." ou a lista de falhas).
- Se o container não tiver `ssh-keygen`, instale com
  `apt-get install -y openssh-client` (necessário para os testes de chave SSH).

---

## 4. Commits e branches

- Branch de correções gerais: `claude/paje-issues-Rr4np`
- Branch de refatoração TUI/CLI/core: `refactor/tui-cli-core-separation`
- Branch de issue #5 (config por servidor): `feature/issue-5-server-config`
- Mensagens de commit em inglês, formato `tipo(escopo): descrição`.
- **Nunca** incluir identificadores de modelo nos commits, PRs ou comentários de código.

---

## 5. i18n — toda string visível ao usuário

- Todo texto exibido ao usuário deve usar `t("chave")` do sistema i18n.
- Adicionar a chave em `src/i18n/pt_BR.ts` **e** `src/i18n/en_US.ts`.
- Nunca usar string literal hardcoded em mensagens de log, orientações ou erros.
- **Esta regra vale para todas as camadas, inclusive o core** (`src/modules/git/core/`).
  Erros, warnings e mensagens de progresso em `gitSyncService.ts`, `gitSyncConfig.ts` e
  demais arquivos do core devem usar `t()` — nunca strings em português ou qualquer outro
  idioma embutidas diretamente no código.
- Antes de criar uma nova chave, verifique se uma chave semanticamente equivalente já
  existe. Reuse sempre que possível; crie apenas quando não houver correspondência.

---

## 6. Tipos — usar os tipos canônicos

- Estado de repositório: sempre `RepoSyncState` de `types.ts`.
- Entrada de servidor: sempre `GitServerEntry` de `core/gitSyncService.ts`.
- Configuração de sync: sempre `GitSyncConfig` de `core/gitSyncConfig.ts`.
- Não redeclarar tipos que já existem em outro arquivo.

---

## Referências

| Documento | Conteúdo |
|---|---|
| `docs/arquitetura.md` | Visão geral e regras de camadas para desenvolvedores |
| `docs/auditoria-arquitetura.md` | 16 problemas arquiteturais conhecidos com arquivo:linha |
| `docs/auditoria-codigo.md` | Bugs, inconsistências e itens de UX conhecidos (abertos e resolvidos) |
| `docs/requisitos-tui-git-sync.md` | Requisitos funcionais e de usabilidade da TUI git-sync |
