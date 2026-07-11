# Leiaute TUI — Ink (PAJÉ)

Este documento descreve o layout obrigatório da TUI do PAJÉ, implementado em Ink + React.

## Objetivo

Padronizar a experiência de navegação e mensagens da TUI em um layout de 4 painéis, com comportamento consistente entre funcionalidades.

## Estrutura (4 painéis)

1. **Barra de título** (1 linha)
   - Exibe o nome da funcionalidade e breadcrumbs quando aplicável.

2. **Área de trabalho** (central)
   - Exibe listas, formulários e árvores de repositórios.
   - Deve ocupar o espaço principal disponível (após título e rodapé).

3. **Barra de orientação** (1 linha)
   - Apresenta instruções contextuais do que o usuário pode fazer.
   - Deve refletir o item com foco ou a etapa atual.

4. **Painel de log** (parte inferior)
   - Ocupa aproximadamente **15%** da altura da tela quando em modo padrão.
   - Exibe mensagens de execução e eventos importantes.

## Atalhos globais

- **Esc**: fecha a modal aberta (nos modais de workflow — editor de env.yaml e branch — o Esc é tratado pelo próprio modal); se algum painel estiver maximizado, restaura o layout; caso contrário, volta para a tela anterior (sem confirmação adicional) e, no menu principal, encerra a aplicação.
- **Ctrl+H**: abre/fecha a modal de ajuda (shortcuts). O terminal envia o byte de backspace (`0x08`) para Ctrl+H; o layout o reconhece como ajuda apenas em telas sem campo de texto (menu, árvore, loading — prop `helpOnBackspace`).
- **Ctrl+P**: abre/fecha a modal de parâmetros carregados na execução atual.
- **Ctrl+E**: abre/fecha o editor de parâmetros do `env.yaml`.
- **Ctrl+C**: encerra a TUI imediatamente — **inclusive com modal aberto**.
- **Ctrl+F**: alterna filtro para exibir apenas itens marcados na árvore (quando aplicável). (`Ctrl+M` não pode ser usado: o terminal envia o mesmo byte de Enter.)
- **Digitação (árvore)**: caracteres imprimíveis filtram a árvore em tempo real por nome/caminho; um indicador com a consulta e a contagem aparece acima da lista; Backspace apaga o último caractere; Esc limpa o filtro (com filtro ativo, o Esc e o backspace-ajuda do Layout ficam suspensos).
- **Ctrl+S**: confirma a seleção e sincroniza todos os repositórios marcados na árvore (contexto: menu → seleciona git-sync; contexto: árvore → sincroniza tudo).
- **Enter**: confirma seleção e sincroniza apenas o escopo destacado (linha/grupo) na árvore.
- **Ctrl+G**: seleciona git-server-store no menu.
- **Ctrl+B**: abre a modal de seleção de branch (na árvore).
- **Ctrl+W**: alterna a área de trabalho entre modo padrão e tela cheia.
- **Ctrl+L**: alterna o painel de log entre modo padrão e tela cheia.

## Log

- Cada linha deve conter timestamp no formato **YYYY-MM-DD HH:mm:ss**.
- Colorização por nível: **debug** em cinza (dim), **info** na cor padrão, **warn** em amarelo, **erro** em vermelho.
- As cores usam códigos ANSI aplicados manualmente (chalk desabilita cores quando não detecta TTY real, o que apagaria a colorização em testes e pipes).
- Cada entrada ocupa **exatamente uma linha física**: entradas mais largas que o terminal são truncadas (`wrap="truncate-end"`) — quebra de linha estouraria a altura do painel.
- O log deve manter auto-scroll, exibindo sempre as últimas linhas.
- Ao sincronizar repositórios, o log deve registrar o início e o fim de cada repositório sincronizado.
- Nível padrão do painel: `info`; com `--verbose`, `debug`.

## Editor de parâmetros (`EditParamsModal`)

- Aberto com **Ctrl+E** em qualquer tela.
- `↑/↓` e `PgUp/PgDn` navegam; `Enter` inicia a edição inline do valor; `Esc` durante a edição cancela **apenas a edição** (o modal permanece aberto).
- Alterações confirmadas ficam **pendentes** (badge magenta) até **Ctrl+S**, que grava no `env.yaml` preservando comentários.
- Parâmetros com origem `cli` ou `resolved` são somente leitura, com rótulo explicativo.
- A descrição do parâmetro selecionado aparece em rodapé fixo (1 linha reservada — o conteúdo nunca excede a altura do modal).
- Enquanto aberto, o editor é dono do teclado: `Ctrl+P`/`Ctrl+H` não trocam de modal.

## Observações de implementação

- O layout deve manter o título e a linha de orientação visíveis ao maximizar o log via **Ctrl+L**.
- A área de trabalho pode ser ocultada quando o log estiver maximizado.
- O log pode ser ocultado quando a área de trabalho estiver maximizada via **Ctrl+W**.
- Modais são sobrepostos ao layout e centralizados. Modais informativos (parâmetros, ajuda) bloqueiam os atalhos da tela; modais de workflow (editor de env.yaml, branch) são donos de todo o teclado enquanto abertos — exceto `Ctrl+C`, que sempre encerra.
- Na conta de altura interna dos modais, o `marginTop` do bloco de conteúdo deve ser contabilizado — sem isso o flexbox encolhe o cabeçalho e a primeira linha (título) é cortada.
- **O frame do Layout deve ficar pelo menos 1 linha abaixo da altura do terminal**: quando a saída atinge `stdout.rows`, o Ink abandona o redesenho incremental e limpa a tela inteira (ESC[2J) a cada frame — a TUI pisca a cada atualização, de forma acentuada via SSH. O teste `tui_no_flicker_test` garante que nenhum clear de tela inteira é emitido durante a interação.
- Componentes reutilizáveis devem ser usados para título, orientação, workspace e log.

## Componentes atuais

- [`Layout`](../src/modules/git/tui/layout.tsx:1)
- [`TitleBar`](../src/modules/git/tui/components/TitleBar.tsx:1)
- [`OrientationBar`](../src/modules/git/tui/components/OrientationBar.tsx:1)
- [`Workspace`](../src/modules/git/tui/components/Workspace.tsx:1)
- [`LoggerPanel`](../src/modules/git/tui/components/LoggerPanel.tsx:1)
- [`ParametersModal`](../src/modules/git/tui/components/ParametersModal.tsx:1)
- [`EditParamsModal`](../src/modules/git/tui/components/EditParamsModal.tsx:1)
- [`HelpModal`](../src/modules/git/tui/components/HelpModal.tsx:1)
- [`BranchModal`](../src/modules/git/tui/components/BranchModal.tsx:1)
