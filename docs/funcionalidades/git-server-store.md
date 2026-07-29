# Funcionalidade — git-server-store

## Objetivo

Registrar um servidor Git (GitLab ou GitHub) e suas credenciais.

- **GitLab**: garante chave SSH válida e token pessoal — cria ou reutiliza chave, atualiza `~/.ssh/config`, registra no GitLab e persiste token em `~/.paje`. Alternativamente (`--use-basic-auth`), configura HTTPS + PAT sem SSH.
- **GitHub**: valida um Personal Access Token via API e persiste o servidor com `type: "github"` (não há fluxo SSH).

## Entradas

### CLI

```
paje git-server-store [opções]
```

### TUI

Pode ser iniciado pelo menu TUI ao executar `paje` sem parâmetros. Abre a tela
**Gerenciar Servidores Git**: uma lista com a opção "Registrar novo servidor"
seguida de todos os servidores já salvos (nome, URL e um resumo — tipo,
modo de autenticação, se há token salvo).

- **Registrar novo**: abre o formulário combinado (URL, nome, usuário, senha,
  nome do token) em uma única tela, com os campos em branco/genéricos.
- **Selecionar um servidor existente**: mostra os detalhes salvos (inclusive
  propriedades que não aparecem no formulário — `userEmail`, `baseDir`,
  `filter`, validade do token) e, em seguida, abre o **mesmo formulário**,
  agora **pré-preenchido** com os valores atuais desse servidor. O usuário
  pode visualizar, alterar qualquer campo e confirmar para persistir.
  - A gravação atualiza a entrada existente — nunca cria uma duplicata,
    mesmo que a URL base seja alterada durante a edição (a entrada antiga é
    removida quando a URL muda).
  - Propriedades que o formulário não expõe (`userEmail`, `baseDir`,
    `filter`, `syncRepos`, `noPublicRepos`, `noArchivedRepos`,
    `tokenScopes`, `tokenExpiresAt`) são preservadas do servidor existente —
    editar um servidor nunca apaga essas propriedades já salvas.
  - O restante do fluxo (validação/rotação de token, geração de chave SSH
    quando aplicável) é o mesmo da seção *Fluxo principal* abaixo — editar
    é, tecnicamente, um novo registro para a mesma URL, cujo resultado é
    mesclado sobre a entrada já salva.
  - Depois de salvar, a lista é reexibida com os dados atualizados.

## Detecção do tipo de servidor

O tipo é resolvido nesta ordem:

1. `--server-type gitlab|github` explícito (valores desconhecidos geram aviso e caem na detecção automática);
2. Detecção pela URL: hostnames `github.com`, `www.github.com` e `*.github.com` → `github`;
3. Padrão: `gitlab`.

## Parâmetros (CLI + env)

| Parâmetro | Obrigatório | Padrão | Origem | Descrição |
| --- | --- | --- | --- | --- |
| `--server-name <name>` | não | `GitLab` | CLI/env | Nome do servidor |
| `--base-url <url>` | sim | — | CLI/env | URL base do servidor (GitLab ou GitHub) |
| `--server-type <tipo>` | não | auto | CLI | `gitlab` ou `github` (detectado pela URL quando omitido) |
| `--token <token>` | não (GitHub) | — | CLI/prompt | PAT do GitHub; sem ele, solicita interativamente ou reutiliza o salvo |
| `--username <username>` | sim (GitLab) | — | CLI/env/prompt | Usuário do GitLab |
| `--use-basic-auth` | não | `false` | CLI/env | HTTPS + PAT em vez de SSH (somente GitLab) |
| `--key-label <label>` | não | `paje` | CLI/env | Nome da chave SSH |
| `--passphrase <passphrase>` | não | — | CLI/env/prompt | Passphrase da chave |
| `--public-key-path <path>` | não | — | CLI/env | Chave pública existente |
| `--key-overwrite` | não | `false` | CLI/env | Sobrescrever chave existente |
| `--retry-delay-ms <ms>` | não | — | CLI/env | Intervalo entre tentativas |
| `--max-attempts <count>` | não | — | CLI/env | Número máximo de tentativas |
| `--token-name <name>` | sim (GitLab) | — | CLI/env | Nome do token |
| `--token-scopes <scopes>` | não | padrão interno | CLI/env | Escopos do token |
| `--token-expires-at <date>` | não | +1 ano | CLI/env | Expiração `YYYY-MM-DD` |
| `--base-dir <dir>` | não | — | CLI/env | Diretório base salvo como propriedade do servidor |
| `--user-email <email>` | não | — | CLI/env | E-mail Git salvo como propriedade do servidor |
| `--filter <pattern>` | não | — | CLI/env | Filtro Ant/Glob salvo como propriedade do servidor |
| `--env-file <path>` | não | `~/.paje/env.yaml` | CLI | Arquivo de ambiente |
| `-v, --verbose` | não | `false` | CLI/env | Logs detalhados |

## Fluxo principal — GitLab (SSH, padrão)

1. Sonda TCP na porta 22 do servidor (timeout 3 s); se bloqueada, exibe guia de geração de PAT e orienta reexecutar com `--use-basic-auth`.
2. Verifica chave SSH existente e permite reutilizar ou gerar uma nova (ed25519).
3. Atualiza `~/.ssh/config` e `known_hosts`.
4. Registra chave no GitLab (quando autenticado).
5. Valida token existente; se inválido, tenta rotacionar e, se necessário, cria novo.
6. Persiste dados em `~/.paje/git-servers.json`.

## Fluxo principal — GitLab (HTTPS + PAT, `--use-basic-auth`)

1. Valida token salvo e reutiliza se válido; rotaciona se inválido.
2. Sem token: solicita usuário/senha (ou lê do env), cria novo PAT e persiste.
3. Operações git passam a usar `oauth2:<token>@host` na URL HTTPS.

## Fluxo principal — GitHub

1. Resolve o PAT: `--token` → token salvo do servidor → prompt interativo (mascarado).
2. Valida via `GET /user` (Bearer token) e captura o `login` do usuário.
3. Token inválido: informa e solicita novo token; token ausente: encerra com aviso.
4. Persiste o servidor com `type: "github"`, `username` = login e o token.
5. Operações git usam `x-access-token:<token>@host` na URL HTTPS.

> Crie o PAT em `github.com/settings/tokens` com escopos `repo` e `read:org`.
> Para GitHub Enterprise Server, a API é resolvida como `<baseUrl>/api/v3`.

## Saídas

- Logs sobre criação/registro de chave (GitLab).
- Mensagens de token reaproveitado, rotacionado, criado ou validado (com o login do GitHub).
- Persistência local atualizada (re-registro atualiza a entrada existente — sem duplicatas).

## Segurança

- Senhas/tokens não devem ser versionados.
- Use `env.yaml` local com permissões restritas.
- O token é o único segredo persistido, sempre em `~/.paje/git-servers.json`; o cache da árvore nunca contém tokens.
- `~/.paje/env.yaml` é criado automaticamente na primeira execução de qualquer comando, a partir de [`env-template.yaml`](../../env-template.yaml). Comentários nunca são suprimidos em atualizações.

## Erros conhecidos

Consulte [auditoria de código](../auditoria-codigo.md).
