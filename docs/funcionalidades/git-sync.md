# Funcionalidade — git-sync

## Objetivo

Sincronizar repositórios GitLab em paralelo, permitindo seleção e filtragem por servidor, grupo, projeto e padrões Ant/Glob. A TUI apresenta árvore consolidada e resumo de execução.

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
| `--use-basic-auth` | não | `false` | CLI/env | Usa autenticação básica |
| `--username <username>` | condicional | — | CLI/env | Usuário para auth básica |
| `--password <password>` | condicional | — | prompt/env | Senha para auth básica |
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
| `--env-file <path>` | não | `~/.paje/env.yaml` | CLI | Arquivo de ambiente |
| `-v, --verbose` | não | `false` | CLI/env | Logs detalhados |

> Em TUI, alguns parâmetros podem ser solicitados via prompts quando ausentes.

## Fluxo principal

1. Carrega servidores e aplica filtros por `serverName` e/ou `baseUrl`.
2. Aplica filtros de repositórios (`filter`, `noPublicRepos`, `noArchivedRepos`).
3. Calcula estado local e pré-seleção automática na árvore TUI (baseado em clones existentes).
4. Renderiza árvore consolidada na TUI ou imprime árvore na CLI.
5. Na TUI, a confirmação é feita com **S** (escopo total) ou **Ctrl+S** (escopo da linha/grupo destacado).
6. Remove diretórios locais recém desmarcados dentro do escopo selecionado (com confirmação quando há alterações locais).
7. Sincroniza os itens marcados `[x]` respeitando paralelismo e `dry-run`.
8. Exibe resumo final e status por repositório.

## Requisitos funcionais

- Exibir cabeçalho agregado com total de servidores.
- Exibir branch e status coloridos por repositório.
- Manter seleção por checkbox sem perder o scroll.
- Inicializar checkboxes com base em clonagem local (pré-seleção automática).
- Permitir alternar a visualização para mostrar apenas repositórios marcados (atalho `C`).
- Mostrar progresso por linha durante sincronização.
- Exibir resumo consolidado ao final.

## Comportamentos importantes

- Sem filtros de servidor, agrega todos os servidores persistidos.
- Com filtros, somente servidores correspondentes são carregados.
- Grupos com o mesmo `full_path` em servidores diferentes são consolidados no mesmo nó da árvore.
- Em colisões de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório local recebe sufixo `-<Servidor>`.
- `--sync-repos` aceita padrão `path_with_namespace[.git]#branch`.
- `--parallels` aceita `AUTO`, `0` ou número ≥ 1.
- `--dry-run` evita alterações reais, apenas reporta ações.
- Diretórios desmarcados na TUI são removidos; a confirmação é exibida apenas para estados `UNCOMMITTED`, `AHEAD` e `DIVERGED`.
- Logs são centralizados no LoggerBroker, com níveis configuráveis por transport (console/painel/arquivo).
- O painel de logs da TUI deve espelhar o mesmo texto e ordem das mensagens da CLI, incluindo logs HTTP em modo `--verbose`.

## Saídas

- Resumo final com estados: `SYNCED`, `BEHIND`, `AHEAD`, `DIVERGED`, `REMOTE`, `EMPTY`, `LOCAL`, `UNCOMMITTED`.
- Logs detalhados quando `--verbose` está ativo.

## Erros conhecidos

Consulte [auditoria de código](../auditoria-codigo.md) e requisitos detalhados da TUI em [requisitos-tui-git-sync](../requisitos-tui-git-sync.md).
