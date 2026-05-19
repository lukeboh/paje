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

- **Esc**: fecha a modal de parâmetros/ajuda quando aberta; se algum painel estiver maximizado, restaura o layout; caso contrário, volta para a tela anterior (sem confirmação adicional) e, no menu principal, encerra a aplicação.
- **H**: abre/fecha a modal de ajuda (shortcuts).
- **P**: abre/fecha a modal de parâmetros carregados na execução atual.
- **Ctrl+C**: encerra a TUI imediatamente.
- **C**: alterna filtro para exibir apenas itens marcados na árvore (quando aplicável).
- **S**: confirma a seleção e sincroniza todos os repositórios marcados na árvore.
- **Ctrl+S**: confirma a seleção e sincroniza apenas o escopo destacado (linha/grupo).
- **W**: alterna a área de trabalho entre modo padrão e tela cheia.
- **L**: alterna o painel de log entre modo padrão e tela cheia.

## Log

- Cada linha deve conter timestamp no formato **YYYY-MM-DD HH:mm:ss**.
- Mensagens de erro devem aparecer em vermelho.
- O log deve manter auto-scroll, exibindo sempre as últimas linhas.
- Ao sincronizar repositórios, o log deve registrar o início e o fim de cada repositório sincronizado.

## Observações de implementação

- O layout deve manter o título e a linha de orientação visíveis ao maximizar o log via F12.
- A área de trabalho pode ser ocultada quando o log estiver maximizado.
- O log pode ser ocultado quando a área de trabalho estiver maximizada via W.
- A modal de parâmetros e a modal de ajuda devem ser sobrepostas ao layout, centralizadas e bloquear atalhos globais enquanto estiverem abertas.
- Componentes reutilizáveis devem ser usados para título, orientação, workspace e log.

## Componentes atuais

- [`Layout`](../src/modules/git/tui/layout.tsx:1)
- [`TitleBar`](../src/modules/git/tui/components/TitleBar.tsx:1)
- [`OrientationBar`](../src/modules/git/tui/components/OrientationBar.tsx:1)
- [`Workspace`](../src/modules/git/tui/components/Workspace.tsx:1)
- [`LoggerPanel`](../src/modules/git/tui/components/LoggerPanel.tsx:1)
- [`ParametersModal`](../src/modules/git/tui/components/ParametersModal.tsx:1)
- [`HelpModal`](../src/modules/git/tui/components/HelpModal.tsx:1)
