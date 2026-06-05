# Bugs conhecidos

## BUG-001 — Senha ausente no fluxo `git-server-store`

**Status:** Corrigido.

**Descrição original:**
O fluxo `storeSshKeyOnly()` podia deixar de exibir detalhes do token existente porque
`useBasicAuth` defaultava incorretamente para `true` (BUG-06). Com o fix, `useBasicAuth`
agora default para `false` e o teste atualizado passa `--use-basic-auth` explicitamente.

**Solução aplicada:**
- Corrigido `useBasicAuth: options.useBasicAuth ?? false` em `gitCommand.ts`.
- Teste `ssh_key_store_command_test.ts` atualizado para incluir `--use-basic-auth`.
- `ssh_key_store_command_test: OK` confirmado em `npm test`.

---

## BUG-002 — Comportamento do Esc não está consistente

**Descrição:**

O Esc deveria "retornar":
1. Sair de uma modal;
2. Restaurar um painel maximizado;
3. Retornar para uma tela anterior, até chegar no menu principal.
4. Se estiver no menu principal, sair da aplicação.

**Impacto:**
Prejudica a usabilidade da aplicação.

**Como reproduzir:**
1. Executar `paje`.
2. Selecione qualquer menu, por exemplo o S - Sincronizar.
3. Clique em Esc. Deveria voltar para o menu mas não volta.

E em qualquer situação que está descrita na descrição.

**Status:**
Corrigido.

**Solução planejada:**
- Centralizar o tratamento do Esc no layout para priorizar: fechar modal -> restaurar painel maximizado -> voltar tela anterior -> sair no menu principal.
- Garantir que o retorno das telas internas (S/G) ao menu passe pelo handler global do layout.
- Reforçar esse comportamento na documentação.

---

## BUG-003 — Mensagens e Logs da funcionalidade de sincronização não estão dentro do padrão

**Descrição:**
Ao selecionar S para sincronizar na primeira tela no menu de funcionalidades, uma mensagem genérica "yyyy-mm-dd hh:mm:ss] Mensagem informativa" era apresentada no painel de log e o texto abaixo era apresentado na área de trabalho:

> GitLab
> Acessando servidores e carregando repositórios - requisições: 2

A mensagem informativa não era útil e o "Acessando servidores e carregando repositórios - requisições: 2" estava estático e não dava ideia do progresso no acesso ao servidor. A TUI também não espelhava as mesmas mensagens do CLI.

**Impacto:**
Falta de coerência quanto aos feedbacks que o sistema dá ao usuário para acompanhar a operação do sistema.

**Como reproduzir:**
1. Executar `paje` e selecionar S para sincronizar.
3. Observar as mensagens na área de trabalho e painel de log.

**Status:**
Corrigido.

**Solução aplicada:**
- Direcionado o log de carregamento/HTTP e progresso do sync para o painel TUI com o mesmo texto e ordem do CLI.
- Removidas mensagens genéricas que não existem no CLI.
- Logs verbose da API passam a ser exibidos no painel TUI.
- A duração de listagem de repositórios é registrada no painel sem formatação ANSI para manter equivalência com o CLI.

**Validação sugerida:**
- Executar `./paje.sh git-sync --locale=en-US --dry-run --verbose` e comparar a saída do CLI com o painel TUI usando os mesmos parâmetros.

---

## BUG-004 — Remoção de repositórios locais desmarcados com comportamento inconsistente

**Descrição:**
Ao confirmar a sincronização na TUI, o comportamento de remoção de repositórios locais desmarcados não respeita corretamente o escopo (linha/grupo destacado com **Ctrl+S** versus todas as linhas com **S**) nem as regras esperadas para exclusão segura. O resultado é que a remoção pode ocorrer fora do escopo ou sem seguir a lógica de confirmação adequada.

**Regras esperadas (referência do produto):**
1. A diferença entre o **S** e o **Ctrl+S** é o escopo: o **Ctrl+S** trabalha apenas na linha destacada (em azul) na TUI. E o **S** trabalha em TODAS as linhas. Ou seja, as regras abaixo valem tanto para o **S** como para o **Ctrl+S**, vc só tem que decidir em quantos repositórios fazer;
2. Se a linha esta selecionada com **X**: vc vai fazer um clone, se ainda não houver diretório local. Se tiver, vc vai fazer pull e push para sincronizar.
3. Se a linha não está selecionada, mas existe diretório local e não existe nada para fazer push (não pode estar **AHEAD** ou **UNCOMMITTED**) você pode deletar o diretório local.
4. Se a linha não está selecionada e está **UNCOMMITTED** ou **AHEAD**, você vai fazer a pergunta que te passei antes para o usuário confirmar antes que quer deletar o diretório local.

**Impacto:**
- Risco de remoção de diretórios locais fora do escopo pretendido.
- Fluxo inconsistente para exclusão segura, com possibilidade de perda de alterações locais.

**Como reproduzir:**
1. Abrir `git-sync` na TUI e selecionar/deselecionar repositórios.
2. Usar **Ctrl+S** sobre um grupo/linha destacada e observar remoções fora do escopo.
3. Usar **S** com repositórios desmarcados e observar que a remoção não segue as regras acima.

**Status:**
Aberto.

**Workaround:**
Evitar remover repositórios locais via TUI até correção; fazer limpeza manual com conferência de status.

---

## Como registrar novos bugs

1. Descreva o comportamento esperado e o comportamento atual.
2. Registre passos de reprodução.
3. Inclua impacto e workaround (se existir).
4. Atualize o status e, se corrigido, referência ao commit/PR.