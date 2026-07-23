# Help e Shortcuts (TUI)

## Objetivo

Centralizar o comportamento da modal de **Help** e a tabela de atalhos do PAJÉ, garantindo que os comandos exibidos sejam sensíveis ao contexto e executáveis imediatamente.

## Comportamento

- O atalho **Ctrl+H** abre a modal de ajuda.
- A modal lista **todos** os atalhos conhecidos, mas desabilita (sombreia) aqueles que não se aplicam à tela atual.
- Ao pressionar um atalho dentro da modal, ela fecha imediatamente e delega a execução ao handler da tela atual.
- **Esc** fecha a modal sem executar nenhuma ação.

## Restrições de bytes de terminal

Os atalhos são recebidos como bytes de controle; alguns colidem com teclas comuns:

| Combinação | Byte enviado pelo terminal | Consequência |
| --- | --- | --- |
| `Ctrl+M` | `0x0d` — o mesmo de `Enter` | **Inutilizável** como atalho distinto |
| `Ctrl+H` | `0x08` — reportado como backspace | Reconhecido como ajuda apenas em telas sem campo de texto (`helpOnBackspace`); a tecla Backspace física envia `0x7f` e não conflita |

## Atalhos globais (sempre listados)

| Atalho | Ação | Estado contextual |
| --- | --- | --- |
| Ctrl+H | Abrir ajuda | habilitado em todas as telas |
| Ctrl+P | Abrir parâmetros carregados | habilitado em todas as telas |
| Ctrl+E | Abrir editor de parâmetros do env.yaml | habilitado na árvore (listado por contexto) |
| Ctrl+W | Alternar área de trabalho | estado exibe `padrão` ou `maximizado` |
| Ctrl+L | Alternar painel de log | estado exibe `padrão` ou `maximizado` |
| Esc | Voltar/fechar modal | habilitado em todas as telas |
| Ctrl+C | Encerrar aplicação | habilitado em todas as telas, **inclusive com modal aberto** |

## Menu principal

| Atalho | Ação | Disponibilidade |
| --- | --- | --- |
| Ctrl+S | Selecionar `git-sync` | somente no menu |
| Ctrl+G | Selecionar `git-server-store` | somente no menu |
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
| Ctrl+F | Entrar no modo de pesquisa por nome | somente na árvore |
| *digitar texto (no modo de pesquisa)* | Filtrar a árvore em tempo real (Backspace apaga; Esc sai do modo e limpa) | somente na árvore, após `Ctrl+F` |
| Ctrl+S | Sincronizar seleção (todos os repositórios marcados) | somente na árvore |
| Enter | Sincronizar apenas o escopo destacado (linha/grupo) | somente na árvore |
| Ctrl+X | Filtrar selecionados | somente na árvore |
| Ctrl+B | Selecionar branch | somente na árvore |

## Editor de parâmetros (`Ctrl+E`)

| Atalho | Ação |
| --- | --- |
| ↑/↓, PgUp/PgDn | Navegar entre parâmetros |
| Enter | Editar o valor do parâmetro selecionado |
| Esc (editando) | Cancelar apenas a edição — o modal permanece aberto |
| Esc (navegando) | Fechar o editor |
| Ctrl+S | Gravar alterações pendentes no `env.yaml` |
| Ctrl+E | Fechar o editor |

Enquanto o editor está aberto, `Ctrl+P` e `Ctrl+H` são bloqueados (não descartam
alterações pendentes). `Ctrl+C` continua encerrando a aplicação.

## Atualizações obrigatórias

Sempre que um novo atalho for criado ou alterado:

1. Atualize os textos de orientação (`i18n`) e a modal de Help.
2. Atualize este documento.
3. Revise [`docs/TUI-leiaute.md`](../TUI-leiaute.md:1) e [`README.md`](../../README.md:1).
4. Adicione o byte correspondente em `tests/tui_test_utils.ts` (`KEYS`) e cubra o atalho com teste.

## Arquivos relacionados

- [`Layout`](../../src/modules/git/tui/layout.tsx:1)
- [`HelpModal`](../../src/modules/git/tui/components/HelpModal.tsx:1)
- [`EditParamsModal`](../../src/modules/git/tui/components/EditParamsModal.tsx:1)
- [`Menu`](../../src/modules/git/tui/menu.app.tsx:1)
- [`Árvore`](../../src/modules/git/tui.app.tsx:1)
- [`Utilitários de teste`](../../tests/tui_test_utils.ts:1)
