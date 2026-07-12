# Funcionalidade — Extensão VSCode

## Objetivo

Disponibilizar a árvore de repositórios do PAJÉ dentro do VSCode como uma
**terceira camada de apresentação** sobre o mesmo core da CLI/TUI
(`createGitSyncCore()`). A linha de comando e a TUI continuam funcionando
normalmente — a extensão é puramente aditiva e não duplica configuração nem
lógica de negócio.

## Instalação

### Pré-requisitos

- VSCode 1.85 ou superior.
- Servidores registrados via `paje git-server-store` (a extensão lê a mesma
  configuração local: `~/.paje/git-servers.json` e `~/.paje/env.yaml`).

### Gerar e instalar o pacote (.vsix)

Na raiz do repositório PAJÉ:

```bash
npm install
npm run build:vscode                                  # typecheck + bundle (dist/extension.cjs)
cd vscode-extension
npx @vscode/vsce package --no-dependencies            # gera paje-vscode-<versão>.vsix
code --install-extension paje-vscode-*.vsix           # instala no VSCode
```

> O flag `--no-dependencies` é obrigatório: o bundle esbuild já embute o core
> do PAJÉ e todas as dependências — o pacote não possui `node_modules`.

Alternativas de instalação do `.vsix`:

- Pela interface: aba **Extensões** → menu `...` → **Install from VSIX...**.
- Pela paleta (`Ctrl+Shift+P`): **Extensions: Install from VSIX...**.

### Modo desenvolvimento (F5)

1. `npm run build:vscode` na raiz.
2. Abra a pasta `vscode-extension/` no VSCode.
3. Pressione `F5` (**Run Extension**) — uma janela Extension Development Host
   abre com a extensão carregada.

## Interface

Ícone **PAJÉ** na barra de atividades → view **Repositórios**:

| Elemento | Comportamento |
| --- | --- |
| Árvore de grupos/projetos | Mesma consolidação multi-servidor da TUI (GitLab e GitHub); descrição do grupo mostra a contagem de projetos |
| Status por repositório | `branch · estado [delta]` com ícone e cor por estado (synced=verde, behind/diverged/local/uncommitted=vermelho, ahead=azul, remote=amarelo, empty=roxo) |
| Checkboxes | Seleção de repositórios/grupos; pré-marcados nos clones existentes; marcar grupo propaga aos filhos |
| Cabeçalho da view | Sumário agregado dos servidores (ex.: `GitLab (2 servidores): ...`) |

## Comandos

| Comando | Onde | Ação |
| --- | --- | --- |
| `PAJÉ: Sincronizar repositórios selecionados` | botão da view / paleta | `core.syncSelected()` sobre os itens marcados, com progresso em notificação (`N/M — grupo/repo`) e resumo ao final |
| `PAJÉ: Sincronizar este item` | menu de contexto do item | Sincroniza apenas o repositório (ou grupo) clicado |
| `PAJÉ: Recarregar árvore de repositórios` | botão da view | Recarrega via `core.loadTree()` (cache torna instantâneo) |
| `PAJÉ: Abrir repositório em nova janela` | menu de contexto do projeto | Abre o clone local em nova janela do VSCode |
| `PAJÉ: Abrir env.yaml` | botão da view | Abre `~/.paje/env.yaml` no editor |

## Comportamentos importantes

- **Cache compartilhado**: usa o mesmo `~/.paje/git-tree-cache.json` da CLI/TUI —
  abertura instantânea, com refresh de status em segundo plano (entrega
  incremental via `onStatusRefreshed`).
- **Log**: Output Channel "PAJÉ" recebe o mesmo pipeline do LoggerBroker
  (motor pino); o arquivo diário `~/.paje/logs/` também é alimentado.
- **Autenticação básica**: quando um servidor GitLab exige senha, a extensão
  solicita via `showInputBox` (mascarado).
- **Idioma**: pt-BR ou inglês conforme `vscode.env.language`; títulos de
  comandos localizados via `package.nls[.pt-br].json`.
- **Registro de servidores** permanece na CLI/TUI (`paje git-server-store`) —
  a extensão não duplica esse fluxo.

## Arquitetura e testes

- `vscode-extension/src/extension.ts` — ativação, comandos, Output Channel.
- `vscode-extension/src/pajeTreeProvider.ts` — `TreeDataProvider` com checkboxes
  (`toggleTreeNode`/`recomputeTreeSelection` do treeBuilder).
- `vscode-extension/src/treeAdapter.ts` — mapeamento puro nó → TreeItem, sem
  importar o módulo `vscode` (testável pela suíte principal).
- Bundle: esbuild → `dist/extension.cjs` (CJS único, `external: ["vscode"]`);
  o sourcemap comprova que Ink/React não entram no bundle.
- Testes na suíte principal (`npm test`):
  - `vscode_tree_adapter_test` — mapeamento de descritores (status, seleção,
    ícones, tooltips, contagens).
  - `vscode_extension_smoke_test` — carrega o **bundle real** com mock do
    módulo `vscode`, ativa a extensão com HOME temporário e verifica árvore
    carregada do cache, comandos registrados e recarga.

## Regras para evolução

Valem as mesmas regras de camadas do `CLAUDE.md`: a extensão **não** chama
`GitLabApi`/`GitHubApi` nem `parallelSync()` diretamente, não reimplementa
lógica do core e não importa componentes Ink. Strings visíveis usam `t()`
(chaves `vscodeExt.*`) ou os arquivos `package.nls*.json` para o manifesto.
