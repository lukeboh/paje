# Help e Shortcuts (TUI)

## Objetivo

Centralizar o comportamento da modal de **Help** e a tabela de atalhos do PAJÉ, garantindo que os comandos exibidos sejam sensíveis ao contexto e executáveis imediatamente.

## Comportamento

- O atalho **H** abre a modal de ajuda.
- A modal lista **todos** os atalhos conhecidos, mas desabilita (sombreia) aqueles que não se aplicam à tela atual.
- Ao pressionar um atalho dentro da modal, ela fecha imediatamente e delega a execução ao handler da tela atual.
- **Esc** fecha a modal sem executar nenhuma ação.

## Contextos suportados

- **Menu principal**: seleção de funcionalidades e navegação entre cartões.
- **Árvore de repositórios** (`git-sync`): seleção e ações sobre a árvore.
- **Loading**: tela de carregamento (apenas atalhos globais).

## Atalhos globais (sempre listados)

| Atalho | Ação | Estado contextual |
| --- | --- | --- |
| H | Abrir ajuda | habilitado em todas as telas |
| P | Abrir parâmetros carregados | habilitado em todas as telas |
| W | Alternar área de trabalho | estado exibe `padrão` ou `maximizado` |
| L | Alternar painel de log | estado exibe `padrão` ou `maximizado` |
| Esc | Voltar/fechar modal | habilitado em todas as telas |
| Ctrl+C | Encerrar aplicação | habilitado em todas as telas |

## Menu principal

| Atalho | Ação | Disponibilidade |
| --- | --- | --- |
| S | Selecionar `git-sync` | somente no menu |
| G | Selecionar `git-server-store` | somente no menu |
| ←/→ | Navegar entre cartões | somente no menu |
| ↑/↓ | Navegar entre cartões | somente no menu |
| Tab | Alternar seleção | somente no menu |
| Enter | Confirmar seleção | somente no menu |
| 1 | Selecionar 1º cartão | somente no menu |
| 2 | Selecionar 2º cartão | somente no menu |

## Árvore de repositórios (git-sync)

| Atalho | Ação | Disponibilidade |
| --- | --- | --- |
| ↑/↓ | Navegar na lista | somente na árvore |
| PgUp/PgDn | Rolar página | somente na árvore |
| Home/End | Ir ao início/fim | somente na árvore |
| Espaço | Marcar/desmarcar repositório | somente na árvore |
| S | Sincronizar seleção | somente na árvore |
| Ctrl+S | Sincronizar apenas o repositório selecionado | somente na árvore |
| C | Filtrar selecionados | somente na árvore |
| B | Selecionar branch | somente na árvore |

## Atualizações obrigatórias

Sempre que um novo atalho for criado ou alterado:

1. Atualize os textos de orientação (`i18n`) e a modal de Help.
2. Atualize este documento.
3. Revise [`docs/TUI-leiaute.md`](../TUI-leiaute.md:1) e [`README.md`](../../README.md:1).

## Arquivos relacionados

- [`Layout`](../../src/modules/git/tui/layout.tsx:1)
- [`HelpModal`](../../src/modules/git/tui/components/HelpModal.tsx:1)
- [`Menu`](../../src/modules/git/tui/menu.app.tsx:1)
- [`Árvore`](../../src/modules/git/tui.app.tsx:1)
