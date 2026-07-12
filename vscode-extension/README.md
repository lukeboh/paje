# PAJÉ — Extensão VSCode

A árvore de repositórios do PAJÉ dentro do VSCode, consumindo **o mesmo core**
da CLI/TUI (`createGitSyncCore()`): mesma configuração (`~/.paje/env.yaml`,
`~/.paje/git-servers.json`), mesmo cache instantâneo da árvore, mesmos
servidores GitLab e GitHub. A CLI e a TUI continuam funcionando normalmente —
a extensão é apenas uma terceira camada de apresentação.

## Funcionalidades

- **Árvore de repositórios** na barra de atividades, agrupada por grupo/organização,
  com status por repositório (branch · estado, ícone e cor por estado).
- **Checkboxes** para selecionar repositórios/grupos (pré-seleção automática dos
  clones existentes, como na TUI).
- **Sincronizar selecionados** (botão da view) ou **um item específico**
  (menu de contexto), com progresso em notificação.
- **Abertura instantânea**: o cache da árvore (`~/.paje/git-tree-cache.json`) é
  compartilhado com a CLI/TUI; o status é atualizado em segundo plano.
- **Abrir repositório** clonado em nova janela.
- **Abrir env.yaml** para editar os parâmetros.
- **Log** no Output Channel "PAJÉ" (mesmo pipeline pino da CLI).
- Interface em português ou inglês conforme o idioma do VSCode.

## Pré-requisitos

Servidores registrados via `paje git-server-store` (CLI/TUI). A extensão lê a
mesma configuração local — não há configuração duplicada.

## Desenvolvimento

```bash
# na raiz do repositório PAJÉ:
npm install
npm run build:vscode     # typecheck + bundle -> vscode-extension/dist/extension.cjs
```

## Instalação (.vsix)

```bash
# na raiz do repositório:
npm run build:vscode
cd vscode-extension
npx @vscode/vsce package --no-dependencies    # gera paje-vscode-<versão>.vsix
code --install-extension paje-vscode-*.vsix
```

O flag `--no-dependencies` é obrigatório: o bundle já embute o core e todas as
dependências. Alternativa pela interface: Extensões → `...` →
*Install from VSIX...*.

Para testar em desenvolvimento: abra a pasta `vscode-extension/` no VSCode e
pressione `F5` (Run Extension).

O bundle (esbuild) embute o core do PAJÉ (`../src/modules/git/...`) em um único
arquivo CJS — nenhuma dependência de runtime além do próprio VSCode.
