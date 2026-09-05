# Funcionalidade — git-sync

## Objetivo

Sincronizar repositórios Git (GitLab e GitHub) em paralelo, permitindo seleção e filtragem por servidor, grupo, projeto e padrões Ant/Glob. A TUI apresenta árvore consolidada e resumo de execução.

## Entradas

### CLI

```
paje git-sync [opções]
```

### TUI

A TUI é iniciada ao executar `paje` sem parâmetros e selecionar **Sincronizar repositórios GitLab**.

## Parâmetros (CLI + env)

| Parâmetro | Obrigatório | Padrão | Origem | Descrição |
| --- | --- | --- | --- | --- |
| `--base-dir <dir>` | não | `repos` | CLI/env | Diretório base de clonagem |
| `--server-name <name>` | não | — | CLI/env | Filtra servidores pelo nome |
| `--base-url <url>` | não | — | CLI/env | Filtra servidores pela URL |
| `--use-basic-auth` | não | `false` | CLI/env | Ao cadastrar um servidor via `--server-name`/`--base-url`, bootstrap de token via usuário/senha em vez de chave SSH |
| `--username <username>` | condicional | — | CLI/env | Usuário do GitLab, usado só para o bootstrap de token quando necessário |
| `--password <password>` | condicional | — | CLI/prompt | Senha para o bootstrap único de token/chave SSH; **nunca** lida de `env.yaml` nem persistida |
| `--user-email <email>` | não | — | CLI/env | Email Git local |
| `--key-label <label>` | não | `paje` | CLI/env | Nome da chave SSH |
| `--passphrase <passphrase>` | não | — | CLI/env | Passphrase da chave |
| `--public-key-path <path>` | não | — | CLI/env | Chave pública existente |
| `--prepare-local-dirs` | não | `false` | CLI/env | Cria pastas sem clonar |
| `--no-summary` | não | `false` | CLI/env | Oculta resumo final |
| `--no-public-repos` | não | `false` | CLI/env | Oculta repositórios públicos |
| `--no-archived-repos` | não | `false` | CLI/env | Oculta repositórios arquivados |
| `-f, --filter <pattern>` | não | — | CLI/env | Filtro Ant/Glob por caminho |
| `--sync-repos <pattern>` | não | — | CLI/env | Filtro Ant/Glob com branch |
| `--parallels <value>` | não | `1` | CLI/env | Paralelismo (`AUTO`, `0` ou número) |
| `--dry-run` | não | `false` | CLI/env | Simula ações sem alterar |
| `--fix-remotes` | não | `false` | CLI | Corrige o remote de cada repositório já clonado localmente para a URL que o PAJÉ resolveria (SSH ou HTTPS+token) e encerra, sem carregar a TUI nem sincronizar. Ação pontual — não é lida de `env.yaml` nem aparece no editor de parâmetros. |
| `--env-file <path>` | não | `~/.paje/env.yaml` | CLI | Arquivo de ambiente |
| `-v, --verbose` | não | `false` | CLI/env | Logs detalhados |

> Em TUI, alguns parâmetros podem ser solicitados via prompts quando ausentes.
> O editor `Ctrl+E` permite alterar os parâmetros do `env.yaml` sem sair da TUI.
> Se `~/.paje/env.yaml` ainda não existir, ele é criado automaticamente na
> primeira execução a partir de [`env-template.yaml`](../../env-template.yaml),
> com todos os parâmetros comentados. Comentários nunca são suprimidos em
> atualizações posteriores. Detalhes em [`docs/arquitetura.md`](../arquitetura.md).

## Fluxo principal

1. Carrega servidores e aplica filtros por `serverName` e/ou `baseUrl`.
2. **Verifica o cache da árvore** (`~/.paje/git-tree-cache.json`): se o `configHash` dos servidores coincide, a árvore abre **imediatamente** a partir do cache e o status local de cada repositório é recalculado em segundo plano (concorrência 4, entrega incremental linha a linha). Sem cache válido, executa a carga completa via API e grava o cache ao final.
3. Aplica filtros de repositórios (`filter`, `noPublicRepos`, `noArchivedRepos`).
4. Calcula estado local e pré-seleção automática na árvore TUI (baseado em clones existentes).
5. Renderiza árvore consolidada na TUI ou imprime árvore na CLI. Se o comando foi executado de dentro de um clone git, o cursor da TUI abre posicionado no repositório correspondente.
6. Na TUI, a confirmação é feita com **Ctrl+S** (todos os marcados) ou **Enter** (apenas o escopo destacado — linha/grupo).
7. Remove diretórios locais recém desmarcados dentro do escopo selecionado (com confirmação quando há alterações locais).
8. Sincroniza os itens marcados `[x]` respeitando paralelismo e `dry-run`.
9. Exibe resumo final e status por repositório.

## Requisitos funcionais

- Exibir cabeçalho agregado com total de servidores.
- Exibir branch e status coloridos por repositório.
- Manter seleção por checkbox sem perder o scroll.
- Inicializar checkboxes com base em clonagem local (pré-seleção automática).
- Permitir alternar a visualização para mostrar apenas repositórios marcados (atalho `Ctrl+F`).
- Permitir filtrar a árvore digitando texto (nome ou caminho, case-insensitive), com indicador da consulta e contagem; Esc limpa o filtro.
- Mostrar progresso por linha durante sincronização.
- Exibir resumo consolidado ao final.
- Abrir a árvore instantaneamente quando houver cache válido, com atualização de status em segundo plano.

## Comportamentos importantes

- Sem filtros de servidor, agrega todos os servidores persistidos (GitLab e GitHub).
- Com filtros, somente servidores correspondentes são carregados.
- Servidores GitHub: organizações são exibidas como grupos; o login do usuário aparece como grupo pessoal; repositórios são mapeados para o mesmo modelo de projeto do GitLab.
- Grupos com o mesmo `full_path` em servidores diferentes são consolidados no mesmo nó da árvore.
- Em colisões de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório local recebe sufixo `-<Servidor>`.
- `--sync-repos` aceita padrão `path_with_namespace[.git]#branch`.
- `--parallels` aceita `AUTO`, `0` ou número ≥ 1.
- `--dry-run` evita alterações reais, apenas reporta ações.
- Diretórios desmarcados na TUI são removidos; a confirmação é exibida apenas para estados `UNCOMMITTED`, `AHEAD` e `DIVERGED`.
- Operações git usam SSH (quando o servidor tem uma chave associada em `~/.ssh/config`) ou HTTPS com token embutido (`oauth2:` para GitLab; `x-access-token:` para GitHub).
- Como essa escolha depende do estado de `~/.ssh/config` no momento de cada sincronização, um remote local pode ficar desalinhado se essa associação mudar depois do clone original (ex.: a chave SSH foi configurada só depois). `Ctrl+U` na TUI e `--fix-remotes` na CLI corrigem o remote de todo repositório já clonado, sem clonar nem sincronizar nada — reconciliam apenas a URL do `origin` (nunca um `https://` configurado manualmente pelo usuário).
- No Windows, antes da primeira operação git de cada sessão em cada host SSH-associado, o PAJÉ verifica se o `ssh.exe` embutido do Git for Windows consegue ler a identidade configurada para aquele host; se não conseguir (`error in libcrypto: unsupported` — incompatibilidade conhecida do OpenSSL 3.x do Git for Windows com certas chaves) e o OpenSSH nativo do Windows conseguir, usa `GIT_SSH_COMMAND` para apontar só esta execução do PAJÉ para o cliente nativo — nunca mexe no `git config` global nem sobrescreve um `GIT_SSH_COMMAND` já definido pelo usuário. Ver `resolveGitSshCommandOverride` (`sshManager.ts`).
- Um servidor sem token e sem chave SSH (registro legado ou interrompido) faz o bootstrap automaticamente na sincronização: pede a senha uma única vez, gera e persiste o token, e a sincronização continua sem reiniciar. Se a senha não for informada, o servidor é pulado com o aviso de "sem autenticação configurada" de sempre.
- O cache nunca armazena URLs com token (`pajeHttpUrl`); elas são reidratadas da configuração atual do servidor a cada carga.
- Logs são centralizados no LoggerBroker (motor pino), com níveis configuráveis por transport (console/painel/arquivo).
- O painel de logs da TUI deve espelhar o mesmo texto e ordem das mensagens da CLI, incluindo logs HTTP em modo `--verbose`.

## Saídas

- Resumo final com estados: `SYNCED`, `BEHIND`, `AHEAD`, `DIVERGED`, `REMOTE`, `EMPTY`, `LOCAL`, `UNCOMMITTED`.
- Logs detalhados quando `--verbose` está ativo.

## Erros conhecidos

Consulte [auditoria de código](../auditoria-codigo.md) e requisitos detalhados da TUI em [requisitos-tui-git-sync](../requisitos-tui-git-sync.md).
