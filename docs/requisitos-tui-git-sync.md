# Requisitos — TUI Git Sync (PAJÉ)

Este documento define os requisitos da funcionalidade **Sincronizar repositórios GitLab (git-sync)** na TUI.

## Identificação

- **Código da tela:** `TUI-GIT-SYNC`
- **Título:** PAJÉ - Sincronização Git

## Fluxo principal

1. Usuário seleciona `git-sync` no menu principal.
2. Sistema carrega servidores persistidos e aplica filtros (`serverName`/`baseUrl`) quando informados.
3. Sistema apresenta feedback de acesso **aos servidores** e inicia a listagem de repositórios em todos os servidores válidos.
4. Cabeçalho consolidado é exibido com contagem de servidores (ex.: `GitLab (2 servidores)`), seguido da árvore agrupada por servidor.
5. Árvore de repositórios é exibida com estados, branchs e caminhos consolidados (um único `base-dir`).
6. Usuário seleciona itens (grupos/projetos) via checkbox.
7. Usuário confirma com **S** para sincronizar.
8. Sistema remove diretórios recém desmarcados (com confirmação quando houver alterações locais).
9. Sistema sincroniza respeitando paralelismo configurado.
10. Progresso aparece na linha de cada repositório.
11. Ao final, modal de resumo é exibido.

## Requisitos funcionais

### RF-01 — Feedback de acesso aos servidores

- Ao iniciar o `git-sync` na TUI, deve haver feedback imediato de acesso **aos servidores** configurados.
- A mensagem deve indicar **quantidade de requisições realizadas** (soma global).
- Deve exibir um **spinner textual** (sequência `/-\|`).
- Exemplo de mensagem:
  - `Acessando servidores e carregando repositórios / requisições: 1`
  - `Acessando servidores e carregando repositórios - requisições: 2`

### RF-02 — Filtros e parâmetros aplicados

- A árvore deve respeitar todos os filtros definidos por arquivo de configuração e CLI:
  - `filter` (Ant/Glob)
  - `noPublicRepos`
  - `noArchivedRepos`
  - `prepareLocalDirs`
  - `serverName`/`baseUrl` quando fornecidos para filtrar servidores
- Filtros de servidor devem ocultar servidores não correspondentes e atualizar o cabeçalho agregado com a nova contagem.
- Apenas projetos filtrados podem aparecer na árvore.

### RF-03 — Exibição de branch e status

- Cada repositório deve exibir **branch** e **status** à direita da linha.
- As cores devem seguir o mesmo padrão da CLI.
- Branchs conhecidas devem ter destaque (ex.: `main`, `master`, `develop`, `desenvolvimento`, `feature-*`).

#### Decisão de design — estado DIVERGED exibido como AHEAD

Quando um repositório está **divergido** (`ahead > 0` e `behind > 0`), o sistema exibe o estado como **AHEAD** (com delta `+N/-M`).

**Motivação:** a presença de commits locais não enviados ao servidor é a informação mais crítica para o usuário — commits não publicados podem ser perdidos. Exibir o estado como "adiantado" (AHEAD) destaca essa urgência de forma mais visível do que "divergido" (que pode ser interpretado como um estado neutro). O delta `+N/-M` ainda informa que há commits remotos a receber.

**Consequência intencional:** repositórios divergidos usam a cor azul (AHEAD) em vez do vermelho/magenta que seria aplicado ao estado DIVERGED.

### RF-04 — Seleção por checkbox

- Cada nó exibido deve ter checkbox (`[ ]`, `[~]`, `[x]`).
- Ao carregar a árvore, os projetos com clone local devem iniciar marcados `[x]`.
- Grupos/pastas devem iniciar em `[x]` quando todos os filhos estiverem marcados e `[~]` quando parcialmente marcados.
- Selecionar/desselecionar **não pode** alterar o scroll.
- Apenas o estado do checkbox deve ser alterado.

### RF-05 — Navegação e foco

- A barra azul de seleção deve acompanhar a navegação (↑/↓).
- A tela **só rola** quando a barra azul atinge o limite superior ou inferior visível.
- Não deve haver salto para topo ao selecionar itens.

### RF-06 — Confirmação e execução

- O texto de orientação deve indicar `Ctrl+S` para sincronizar todos e `Enter` para sincronizar o escopo destacado.
- Ao confirmar, a sincronização deve se comportar como CLI:
  - Remover diretórios locais recém desmarcados, com confirmação apenas para estados `UNCOMMITTED`, `AHEAD` e `DIVERGED`.
  - Respeitar paralelismo configurado.
  - Respeitar `dry-run` quando definido.

### RF-07 — Progresso por linha

- Durante a sincronização, cada linha de repositório deve exibir progresso.
- As informações devem seguir o mesmo padrão visual da CLI.

### RF-08 — Resumo final

- Ao final da sincronização, exibir modal com resumo:
  - Tempo total
  - Contagem de ações (clone/pull/push/sem ação/falhas)
  - Lista ordenada de repositórios com métricas (objetos/volume/velocidade)
- Quando houver múltiplos servidores, o resumo deve indicar o total consolidado e, quando aplicável, destacar o servidor de cada repositório.

## Requisitos de usabilidade

### RU-01 — Estrutura da TUI

- A TUI deve ter 3 quadros:
  - **Barra de título**: 1 linha no topo, com o nome da funcionalidade.
  - **Área de trabalho**: ao centro, com a árvore de repositórios.
  - **Barra de orientações/log**: ocupa 15% da tela, na parte inferior.
- A barra de orientações/log deve ser dividida em:
  - **Linha de orientações** (1 linha) com comandos possíveis.
  - **Área de log** com as mensagens de execução.
- O cabeçalho agregado deve permanecer visível no topo da árvore durante a navegação.

### RU-02 — Orientações

- A linha de orientações deve indicar ações básicas: navegar, selecionar, sincronizar, cancelar.
- Deve exibir o atalho `Ctrl+F` para alternar o filtro de itens marcados.
- Deve exibir os atalhos `Ctrl+W` para maximizar/restaurar a área de trabalho e `Ctrl+L` para maximizar/restaurar o log.
- Deve exibir `Ctrl+B` para a modal de branch e `Ctrl+H` para a modal de ajuda.

### RU-03 — Log de operações

- O log deve exibir tudo que o sistema está fazendo, incluindo comandos executados e respostas.
- Cada linha deve ter data/hora com precisão de segundos.
- Mensagens de erro devem aparecer em vermelho.
- Scroll do log deve ser automático.
- Ao pressionar `Ctrl+L`, o log deve ocupar a tela inteira e retornar ao layout padrão ao pressionar `Ctrl+L` novamente.
- Ao pressionar `Ctrl+W`, a área de trabalho deve ocupar a tela inteira e retornar ao layout padrão ao pressionar `Ctrl+W` novamente.
- O pipeline de log deve usar LoggerBroker com transport dedicado ao painel.
- O painel deve iniciar em nível `warn` (erros em vermelho).

### RU-04 — Filtro de selecionados

- Ao pressionar `Ctrl+F`, a árvore deve alternar entre exibir todos os itens e apenas os itens marcados.
- Quando o filtro estiver ativo, os ancestrais dos itens marcados devem permanecer visíveis.
- Ao pressionar `Ctrl+F` novamente, a árvore completa deve ser restaurada.

### RU-05 — Esc

- `Esc` retorna à tela anterior.
- Se o usuário estiver digitando, confirmar desistência.

### RU-06 — Cenários multi-servidor

- Caso nenhum servidor corresponda aos filtros `serverName`/`baseUrl`, exibir mensagem explícita e não abrir a árvore.
- Quando apenas um servidor corresponder, o cabeçalho deve indicar `GitLab (1 servidor)`.
- O contador de requisições deve refletir o total global de chamadas somadas entre servidores válidos.
- Grupos com o mesmo `full_path` em servidores diferentes devem ser consolidados em um único nó.
- Os rótulos dos grupos devem exibir apenas o último segmento do caminho (sem prefixo de servidor).
- Em colisão de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório local deve receber sufixo `-<Servidor>`.

## Requisitos não funcionais

### RNF-01 — UTF-8

- Todos os textos exibidos devem estar corretamente codificados em UTF-8.

### RNF-02 — Testes

- Todo ajuste deve incluir testes automatizados cobrindo comportamento da TUI.
