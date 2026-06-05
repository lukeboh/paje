# Funcionalidade — git-server-store

## Objetivo

Registrar um servidor GitLab, garantindo chave SSH válida e token pessoal. O fluxo cria ou reutiliza chave, atualiza `~/.ssh/config`, registra no GitLab e persiste token em `~/.paje`.

## Entradas

### CLI

```
paje git-server-store [opções]
```

### TUI

Pode ser iniciado pelo menu TUI ao executar `paje` sem parâmetros.

## Parâmetros (CLI + env)

| Parâmetro | Obrigatório | Padrão | Origem | Descrição |
| --- | --- | --- | --- | --- |
| `--server-name <name>` | não | `GitLab` | CLI/env | Nome do servidor |
| `--base-url <url>` | sim | — | CLI/env | URL base do GitLab |
| `--username <username>` | sim | — | CLI/env/prompt | Usuário do GitLab |
| `--key-label <label>` | não | `paje` | CLI/env | Nome da chave SSH |
| `--passphrase <passphrase>` | não | — | CLI/env/prompt | Passphrase da chave |
| `--public-key-path <path>` | não | — | CLI/env | Chave pública existente |
| `--key-overwrite` | não | `false` | CLI/env | Sobrescrever chave existente |
| `--retry-delay-ms <ms>` | não | — | CLI/env | Intervalo entre tentativas |
| `--max-attempts <count>` | não | — | CLI/env | Número máximo de tentativas |
| `--token-name <name>` | sim | — | CLI/env | Nome do token |
| `--token-scopes <scopes>` | não | padrão interno | CLI/env | Escopos do token |
| `--token-expires-at <date>` | não | +1 ano | CLI/env | Expiração `YYYY-MM-DD` |
| `--env-file <path>` | não | `~/.paje/env.yaml` | CLI | Arquivo de ambiente |
| `-v, --verbose` | não | `false` | CLI/env | Logs detalhados |

## Fluxo principal

1. Valida credenciais e parâmetros obrigatórios.
2. Verifica chave SSH existente e permite reutilizar ou gerar uma nova.
3. Atualiza `~/.ssh/config` e `known_hosts`.
4. Registra chave no GitLab (quando autenticado).
5. Valida token existente; se inválido, tenta rotacionar e, se necessário, cria novo.
6. Persiste dados em `~/.paje/git-servers.json`.

## Saídas

- Logs sobre criação/registro de chave.
- Mensagens de token reaproveitado, rotacionado ou criado.
- Persistência local atualizada.

## Segurança

- Senhas/tokens não devem ser versionados.
- Use `env.yaml` local com permissões restritas.

## Erros conhecidos

Consulte [auditoria de código](../auditoria-codigo.md).
