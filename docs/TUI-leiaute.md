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
- **Ctrl+F** (árvore): entra no modo de pesquisa por nome. Fora desse modo, digitar não filtra nada. (`Ctrl+M` não pode ser usado como atalho: o terminal envia o mesmo byte de Enter.)
- **Digitação em modo de pesquisa (árvore)**: caracteres imprimíveis filtram a árvore em tempo real por nome/caminho; um indicador com a consulta e a contagem aparece acima da lista assim que o modo é ativado; Backspace apaga o último caractere; Esc sai do modo de pesquisa e limpa o filtro (nesse estado, o Esc e o backspace-ajuda do Layout ficam suspensos).
- **Ctrl+X** (árvore): alterna filtro para exibir apenas itens marcados.
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
- **As notificações do log são agrupadas em janelas de ~80ms** ([`logStore.ts`](../src/modules/git/tui/logStore.ts:1)): uma rajada de entradas muito rápidas (ex.: saída crua de progresso do git durante um clone) forçava um redesenho de tela inteira por linha — como só o conteúdo do log muda entre um redesenho e outro nessa frequência, aquela região era percebida piscando. Nenhuma entrada é perdida (o snapshot sempre reflete tudo que já foi anexado); apenas a frequência de re-render é limitada. Uma entrada isolada após um período ocioso ainda notifica imediatamente. Coberto por `log_store_throttle_test`.

## Editor de parâmetros (`EditParamsModal`)

- Aberto com **Ctrl+E** em qualquer tela.
- `↑/↓` e `PgUp/PgDn` navegam; `Enter` inicia a edição inline do valor; `Esc` durante a edição cancela **apenas a edição** (o modal permanece aberto).
- Alterações confirmadas ficam **pendentes** (badge magenta) até **Ctrl+S**, que grava no `env.yaml` preservando comentários.
- Parâmetros com origem `cli` ou `resolved` são somente leitura, com rótulo explicativo.
- A descrição do parâmetro selecionado aparece em rodapé fixo (1 linha reservada — o conteúdo nunca excede a altura do modal).
- Enquanto aberto, o editor é dono do teclado: `Ctrl+P`/`Ctrl+H` não trocam de modal.

## Formulários (`promptForm`/`promptInput`/`promptPassword`)

- O valor de um campo nunca é exibido cortado sem indicação: usa `wrap="truncate-start"`,
  que oculta o início do texto atrás de reticências (`…`) e mantém o final sempre visível
  — é onde o cursor está enquanto o usuário digita. Aplica-se a `promptInput`,
  `promptPassword` (sobre o valor mascarado) e a cada campo de `promptForm`.
- `promptForm` reserva um **painel de ajuda** dedicado, sempre mostrando o rótulo e a
  descrição do campo com foco atual (título `t("session.form.helpTitle")`); campos sem
  descrição mostram um texto de fallback explícito (`t("session.form.noDescription")`)
  em vez de ficarem em branco. A barra de orientação deixa de carregar a descrição —
  mantém apenas os atalhos (e erros de validação, quando houver).
- Em terminais largos (`stdout.columns >= 70`), o painel de ajuda fica ao lado dos campos
  (`flexDirection="row"`, ~62%/36% de largura). Abaixo desse limiar, ele empilha após a
  lista de campos (`flexDirection="column"`, 100% de largura) para não espremer as caixas
  de entrada — a descrição continua visível em ambos os casos.
- A área de trabalho tem altura fixa (definida pelo `Layout`/`Workspace`, não pelo
  dimensionamento natural do Yoga); uma lista de campos mais alta que essa área seria
  espremida pelo Ink, fundindo o valor com a borda inferior da caixa. Por isso `promptForm`
  lê a altura real via `useLayoutMetrics()` (a mesma métrica usada pela árvore de
  repositórios e pelos modais com rolagem) e, quando os campos não cabem inteiros, exibe
  apenas uma janela deles — sempre mantendo o campo com foco visível — com um indicador
  `▲ N campo(s) acima` / `▼ N campo(s) abaixo` quando há mais campos fora da janela. Cada
  caixa visível sempre mantém suas 3 linhas completas (rótulo, borda superior, valor,
  borda inferior); nenhuma caixa é espremida.

## Observações de implementação

- O layout deve manter o título e a linha de orientação visíveis ao maximizar o log via **Ctrl+L**.
- A área de trabalho pode ser ocultada quando o log estiver maximizado.
- O log pode ser ocultado quando a área de trabalho estiver maximizada via **Ctrl+W**.
- Modais são sobrepostos ao layout e centralizados. Modais informativos (parâmetros, ajuda) bloqueiam os atalhos da tela; modais de workflow (editor de env.yaml, branch) são donos de todo o teclado enquanto abertos — exceto `Ctrl+C`, que sempre encerra.
- Na conta de altura interna dos modais, o `marginTop` do bloco de conteúdo deve ser contabilizado — sem isso o flexbox encolhe o cabeçalho e a primeira linha (título) é cortada.
- **O frame do Layout deve ficar pelo menos 1 linha abaixo da altura do terminal**: quando a saída atinge `stdout.rows`, o Ink abandona o redesenho incremental e limpa a tela inteira (ESC[2J) a cada frame — a TUI pisca a cada atualização, de forma acentuada via SSH. O teste `tui_no_flicker_test` garante que nenhum clear de tela inteira é emitido durante a interação.
- **Trocar de tela nunca desmonta a instância do Ink**: cada tela (prompt, loading, árvore, menu) costumava chamar `render()`/`unmount()` de forma independente — o Ink cacheia uma instância por `stdout` e descarta o estado de diff do frame ao desmontar, então a tela seguinte escrevia seu frame do zero, desconectado do anterior (reconstrução total percebida como piscada, distinta da anterior). [`ScreenHost`](../src/modules/git/tui/screenHost.tsx:1) mantém uma única chamada `render()` viva durante toda a sessão da TUI e troca apenas a subtree montada (via `useSyncExternalStore`); `TuiSession.mountScreen`/`releaseScreen` (usado por `tuiSession.tsx`, `renderRepositoryTree`, `renderLoadingScreen` e `renderMenu`) e o host compartilhado criado em `cli.ts` garantem que o menu e todo comando montem na mesma instância. `release()` de uma tela já substituída por outra é no-op. `destroy()` só desmonta o host se a sessão o criou — um host injetado (compartilhado) só é desmontado por quem o criou. Os testes `screen_host_test`, `tui_screen_transition_test` e `tui_render_menu_host_test` cobrem essa transição.
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
