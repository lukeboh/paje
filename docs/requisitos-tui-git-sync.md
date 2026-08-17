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
  - `filter` (Ant/Glob, allow-list)
  - `excludeFilter` (Ant/Glob, deny-list — repositórios/pastas nunca aparecem nem sincronizam, mesmo com acesso)
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

### RF-09 — Carga instantânea com cache

- Quando existir cache válido (`~/.paje/git-tree-cache.json` com `configHash` igual ao da configuração atual de servidores), a árvore deve abrir imediatamente a partir do cache.
- O status local de cada repositório deve ser recalculado em segundo plano com concorrência limitada (4 repositórios por vez) — nunca todos simultaneamente, para não saturar a máquina nem travar a TUI.
- Cada status recalculado deve ser entregue **incrementalmente** à árvore (atualização linha a linha), e não em bloco ao final.
- Statuses que chegarem antes de a árvore montar devem ser bufferizados e aplicados assim que ela estiver pronta — nenhum update pode ser perdido.
- Ao final do refresh, o cache deve ser regravado com o `statusMap` atualizado.
- O cache não tem TTL; é invalidado apenas por mudança na configuração de servidores.
- O cache nunca pode conter tokens (URLs autenticadas são reidratadas a cada carga).

### RF-10 — Posicionamento inicial do cursor

- Quando `paje git-sync` for executado de dentro de um diretório de trabalho git, a árvore deve abrir com o cursor posicionado na linha do repositório correspondente (comparação por caminho local resolvido).
- O scroll inicial deve deixar algumas linhas de contexto acima do repositório selecionado.
- Quando não houver correspondência, o cursor inicia na primeira linha.

### RF-11 — Excluir da árvore (`Ctrl+D`)

- `Ctrl+D` no item destacado (grupo ou projeto) deve abrir um modal de confirmação mostrando o padrão exato que será adicionado a `excludeFilter`:
  - Projeto: `path_with_namespace` exato.
  - Grupo: `full_path` do grupo sufixado com `/**` (cascateia para todos os subgrupos e projetos dentro dele).
- `Enter` no modal confirma: o padrão é somado ao valor atual de `excludeFilter` (nunca sobrescreve o que já existia) e gravado em `env.yaml`; o item — e toda a subárvore, se for grupo — desaparece da árvore imediatamente, sem precisar recarregar.
- `Esc` no modal cancela sem alterar `env.yaml` nem a árvore.
- A ação pode ser repetida em outros itens para excluir mais de um repositório/pasta na mesma sessão.
- Os parâmetros exibidos em `Ctrl+P`/editados em `Ctrl+E` devem refletir o novo valor de `excludeFilter` imediatamente após confirmar, sem precisar reabrir a tela.

### RF-12 — Checkout em massa, com opção de criar (`Ctrl+K`)

- `Ctrl+K` exige pelo menos um item marcado com checkbox; sem marcação, o sistema apenas registra um aviso no log e não abre nenhum modal (não há fallback para o item destacado — a operação muta a working tree de vários repositórios de uma vez).
- Com itens marcados, um modal de texto pede o nome da branch de destino.
- O sistema verifica, somente em modo leitura, em quais repositórios marcados a branch já existe (local ou remotamente), sem alterar nada.
- Se a branch já existir em todos os repositórios marcados, o checkout é feito diretamente, sem confirmação adicional.
- Se faltar em algum, um modal de confirmação lista quantos/quais repositórios não têm a branch e explica os dois desfechos possíveis: `Enter` cria a branch e a envia ao remoto também nesses repositórios; `Esc` troca apenas onde a branch já existe e pula o restante.
- Cada repositório processado gera uma linha de log com o resultado (`trocado`, `criado`, `pulado`, `falhou`) e a árvore atualiza a coluna de branch/status do respectivo nó imediatamente.
- Uma falha em um repositório (ex.: alterações não commitadas que o git recusa sobrescrever) não interrompe o processamento dos demais.

### RF-13 — Voltar em massa à branch padrão (`Ctrl+R`)

- `Ctrl+R` exige pelo menos um item marcado com checkbox; sem marcação, mesmo comportamento de aviso do RF-12 (sem fallback para o item destacado).
- Um modal de confirmação pergunta se deve voltar os repositórios marcados para a branch padrão de cada um (`Enter` confirma, `Esc` cancela).
- Repositórios sem branch padrão conhecida (`default_branch` ausente no projeto) são pulados, não travam a operação dos demais.
- Mesmo tratamento de resultado por item do RF-12 (log por status, atualização da árvore, falha isolada não aborta o lote).

### RF-14 — Renomear branch, local e remotamente (dentro do `Ctrl+B`)

- Diferente dos RF-12/RF-13, esta é uma operação de **um repositório por vez** — o já existente modal de branch (`Ctrl+B`) ganha uma opção "✎ Renomear branch atual", visível apenas quando o repositório destacado tem uma branch atual conhecida.
- Ao confirmar o novo nome, o sistema renomeia a branch localmente (`git branch -m`).
- Se o repositório tiver remoto configurado, o novo nome também é enviado ao remoto e a branch antiga é removida de lá — nessa ordem (cria/envia o novo nome primeiro, só depois apaga o antigo), para nunca deixar o remoto sem nenhuma cópia da branch em caso de falha no meio do processo.
- Se o repositório não tiver remoto configurado, a renomeação fica só local.
- Se o envio do novo nome falhar, a renomeação é revertida por erro (mesmo tratamento de falha do fluxo de branch já existente). Se apenas a remoção do nome antigo no remoto falhar (o novo nome já foi enviado com sucesso), o sistema avisa no log, mas não trata como falha — a renomeação em si foi concluída.

### RF-15 — Sair no diretório do repositório destacado (`Ctrl+Q`)

- Diferente dos RF-12/RF-13, esta é uma operação de **um repositório só** — o destacado pelo cursor, não os marcados com checkbox.
- Exige que o item destacado seja um projeto com um clone git real já existente localmente; num grupo, ou num projeto sem clone local, `Ctrl+Q` apenas registra um aviso no log e não abre nenhum modal.
- Com um projeto válido destacado, um modal de confirmação mostra o caminho absoluto de destino antes de agir.
- `Enter` no modal: o sistema grava esse caminho num arquivo (`~/.paje/cd-target`) e encerra o PAJÉ inteiro (não volta ao menu, mesmo quando iniciado sem argumentos).
- `Esc` no modal cancela: a tela da árvore continua aberta, nada é gravado.
- Depois que o processo do PAJÉ encerra, uma função registrada no shell do usuário (instalada pelo instalador — ver README) lê esse arquivo e efetivamente muda o diretório do terminal para lá. Sem essa função instalada, `Ctrl+Q` ainda encerra o PAJÉ normalmente, mas o terminal não muda de diretório.

### RF-16 — Tag ARQUIVADO

- Repositórios com `archived: true` na API de origem (GitLab/GitHub) devem exibir uma tag "ARQUIVADO" na árvore, junto das demais informações da linha (servidor, branch, status de sincronização), sempre que não estiverem ocultos por `noArchivedRepos`.
- A tag deve aparecer mesmo antes do status de sincronização local terminar de ser calculado em segundo plano.

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
- Deve exibir o atalho `Ctrl+F` para pesquisar por nome e `Ctrl+X` para alternar o filtro de itens marcados.
- Deve exibir os atalhos `Ctrl+W` para maximizar/restaurar a área de trabalho e `Ctrl+L` para maximizar/restaurar o log.
- Deve exibir `Ctrl+B` para a modal de branch, `Ctrl+D` para excluir da árvore e `Ctrl+H` para a modal de ajuda.
- Deve exibir `Ctrl+K` para checkout em massa (com opção de criar) e `Ctrl+R` para voltar em massa à branch padrão, nos itens marcados.
- Deve exibir `Ctrl+Q` para sair no diretório do repositório destacado.

### RU-03 — Log de operações

- O log deve exibir tudo que o sistema está fazendo, incluindo comandos executados e respostas.
- Cada linha deve ter data/hora com precisão de segundos.
- Colorização por nível: debug em cinza (dim), info na cor padrão, warn em amarelo, erro em vermelho — com códigos ANSI aplicados manualmente (independentes de detecção de TTY).
- Cada entrada deve ocupar exatamente uma linha física (truncamento; linhas longas não podem quebrar e estourar a altura do painel).
- Scroll do log deve ser automático.
- Ao pressionar `Ctrl+L`, o log deve ocupar a tela inteira e retornar ao layout padrão ao pressionar `Ctrl+L` novamente.
- Ao pressionar `Ctrl+W`, a área de trabalho deve ocupar a tela inteira e retornar ao layout padrão ao pressionar `Ctrl+W` novamente.
- O pipeline de log deve usar LoggerBroker (motor pino) com transport dedicado ao painel.
- O painel deve iniciar em nível `info`; com `--verbose`, em nível `debug`.

### RU-04 — Filtro de selecionados

- Ao pressionar `Ctrl+X`, a árvore deve alternar entre exibir todos os itens e apenas os itens marcados.
- Quando o filtro estiver ativo, os ancestrais dos itens marcados devem permanecer visíveis.
- Ao pressionar `Ctrl+X` novamente, a árvore completa deve ser restaurada.

### RU-05 — Esc

- `Esc` retorna à tela anterior.
- Se o usuário estiver digitando, confirmar desistência.
- Em modais de workflow (editor de env.yaml e branch), `Esc` é tratado pelo próprio modal: durante uma edição inline, cancela apenas a edição; fora dela, fecha o modal.

### RU-06 — Cenários multi-servidor

- Caso nenhum servidor corresponda aos filtros `serverName`/`baseUrl`, exibir mensagem explícita e não abrir a árvore.
- Quando apenas um servidor corresponder, o cabeçalho deve indicar `GitLab (1 servidor)`.
- O contador de requisições deve refletir o total global de chamadas somadas entre servidores válidos.
- Grupos com o mesmo `full_path` em servidores diferentes devem ser consolidados em um único nó.
- Os rótulos dos grupos devem exibir apenas o último segmento do caminho (sem prefixo de servidor).
- Em colisão de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório local deve receber sufixo `-<Servidor>`.

### RU-07 — Editor de parâmetros (`Ctrl+E`)

- `Ctrl+E` abre o editor do `env.yaml` sobreposto à árvore.
- `Enter` inicia edição inline do valor; `Esc` durante a edição cancela apenas a edição.
- Alterações confirmadas ficam pendentes (badge) até `Ctrl+S`, que grava no arquivo preservando comentários e convertendo chaves para kebab-case.
- Parâmetros com origem `cli`/`resolved` são somente leitura.
- A descrição do parâmetro selecionado aparece em rodapé fixo; o conteúdo do modal nunca excede sua altura.
- Enquanto aberto, `Ctrl+P`/`Ctrl+H` são bloqueados; `Ctrl+C` continua encerrando a aplicação.

### RU-08 — Pesquisa por digitação (`Ctrl+F`)

- Fora do modo de pesquisa, digitar caracteres imprimíveis na árvore não tem efeito — é preciso pressionar `Ctrl+F` primeiro.
- `Ctrl+F` ativa o modo de pesquisa; a partir daí, digitar caracteres imprimíveis filtra os itens em tempo real, casando com o rótulo do nó ou com o `path_with_namespace` (case-insensitive).
- Grupos cujo nome casa com a consulta mantêm toda a subárvore; ancestrais de itens correspondentes permanecem visíveis.
- Um indicador acima da lista exibe a consulta atual e a contagem de itens visíveis assim que o modo de pesquisa é ativado (mesmo com a consulta ainda vazia); a lista desconta essa linha da altura disponível (sem estourar o quadro).
- `Backspace` apaga o último caractere da consulta (não pode abrir a ajuda enquanto o modo de pesquisa está ativo).
- `Esc` no modo de pesquisa sai do modo e limpa a consulta, restaurando a árvore — **não** cancela a tela; um `Esc` seguinte (fora do modo de pesquisa) cancela normalmente.
- A navegação, a seleção por checkbox e a sincronização continuam funcionando sobre a lista filtrada; o cursor volta ao topo a cada alteração da consulta.
- A pesquisa por digitação compõe com o filtro de selecionados (`Ctrl+X`).

## Requisitos não funcionais

### RNF-01 — UTF-8

- Todos os textos exibidos devem estar corretamente codificados em UTF-8.

### RNF-02 — Testes

- Todo ajuste deve incluir testes automatizados cobrindo comportamento da TUI.
