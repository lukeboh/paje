# PAJÉ — Plataforma de Apoio à Jornada do Engenheiro

O PAJÉ automatiza tarefas repetitivas de ambiente de desenvolvimento com servidores Git (GitLab e GitHub): sincronização paralela de repositórios, gerenciamento de chaves SSH e tokens pessoais de acesso.

## Características

### Sincronização

- **Sincronização paralela de repositórios**: seleção de grupos/projetos por checkbox, clone/pull em paralelo (paralelismo configurável ou automático), resumo final com contagem por ação e progresso individual por repositório (barra, % , volume, velocidade, objetos) durante a execução.
- **GitLab e GitHub**: suporte a gitlab.com, GitLab self-hosted, github.com e GitHub Enterprise Server — tipo detectado automaticamente pela URL.
- **Multi-servidor**: múltiplos servidores simultâneos (inclusive misturando GitLab e GitHub), cada um com suas próprias configurações (diretório, filtros, e-mail), mesclados numa única árvore consolidada — grupos com o mesmo caminho em servidores diferentes viram um único nó, e colisões de caminho local recebem sufixo automático.
- **Abertura instantânea da árvore**: cache local (`~/.paje/git-tree-cache.json`) permite exibir a árvore imediatamente; o status de cada repositório é recalculado em segundo plano, linha a linha, sem travar a interface.
- **Cursor posicionado no contexto**: ao executar `paje git-sync` (ou `paje`) de dentro de um clone, a árvore abre com o cursor no repositório correspondente — inclusive depois de sair com `Ctrl+Q` (ver abaixo) e chamar o `paje` de novo de lá.
- **Filtro por digitação (`Ctrl+F`)**: filtra a árvore em tempo real por nome/caminho, sem diferenciar maiúsculas; `Ctrl+X` alterna para exibir só os itens marcados.
- **Filtros por padrão Ant/Glob**: `filter` (allow-list) e `excludeFilter` (deny-list — nunca sincroniza nem exibe, mesmo com acesso), combináveis, com múltiplos padrões separados por `;`; `Ctrl+D` na árvore adiciona o item destacado ao `excludeFilter` direto pela interface.
- **Ocultar públicos/arquivados**: `--no-public-repos`/`--no-archived-repos`; repositórios arquivados exibidos ganham uma tag "ARQUIVADO" (cinza) na árvore.
- **Sincronização seletiva**: `--sync-repos` sincroniza uma lista específica de `grupo/repo#branch`; `--prepare-local-dirs` só cria a estrutura de pastas sem clonar; `--dry-run` simula sem persistir nada.
- **Sair no diretório do repositório destacado (`Ctrl+Q`)**: encerra o PAJÉ e deixa o terminal posicionado no diretório do repositório destacado pelo cursor — fecha o ciclo com o item anterior.

### Branches

- **Trocar/criar branch (`Ctrl+B`)**: lista as branches locais do repositório destacado, permite trocar ou criar uma nova a partir dali.
- **Renomear branch (`Ctrl+B`)**: renomeia local e — se houver remoto configurado — remotamente também (envia o novo nome e remove o antigo do remoto, nessa ordem, para nunca deixar a branch sem nenhuma cópia lá).
- **Checkout em massa, com opção de criar (`Ctrl+K`)**: troca de branch em todos os repositórios marcados de uma vez; se a branch não existir em algum deles, oferece criá-la **localmente** ali também — nunca envia ao remoto sozinho; o envio fica a critério do usuário, repositório por repositório.
- **Voltar em massa à branch padrão (`Ctrl+R`)**: volta cada repositório marcado para sua própria branch padrão, pulando sem travar o lote os que não têm essa informação.

### Autenticação e segurança

- **Cadastro guiado por método**: chave SSH (recomendado — gera chave **e** token), usuário/senha (bootstrap de token único, senha nunca persistida) ou colar um token já existente — todo servidor termina com token e/ou chave SSH, nunca com senha guardada.
- **GitHub OAuth Device Flow**: cadastro de conta GitHub sem colar token manualmente — abre o navegador sozinho (melhor esforço), mostra o código, e faz polling até a autorização.
- **Sondagem de porta 22**: antes de tentar SSH, testa conectividade; se bloqueada, orienta a escolher usuário/senha ou token colado em vez de travar no meio do fluxo.
- **`known_hosts` gerenciado automaticamente**: adiciona hosts SSH ausentes via `ssh-keyscan` sozinho (com aviso no log), tanto no cadastro quanto no início de toda sincronização — mesmo quando a árvore vem do cache — para nunca deixar um clone em paralelo travado numa pergunta interativa do SSH sem resposta.
- **Rotação e cura automática de token**: um PAT do GitLab expirado/revogado é detectado reativamente (401/403) e curado em até 3 passos na mesma execução — rotaciona sozinho, senão pede a senha uma vez para gerar um novo, senão avisa claramente e pula o servidor — sem precisar reiniciar a sincronização.
- **Bootstrap de credencial faltante durante o próprio `git-sync`**: um servidor cadastrado sem token e sem chave SSH (ex.: versão antiga, cadastro interrompido) não fica travado — o bootstrap roda na hora, pede a senha uma vez e continua.
- **Gerenciar servidores cadastrados**: lista todos com resumo (tipo · método de auth · status do token) e detalhe completo; selecionar um abre o mesmo formulário de cadastro pré-preenchido, para editar sem duplicar nem perder propriedades que o formulário não exibe.
- **Reaproveitar chave SSH existente** (`--public-key-path`) ou sobrescrever a atual (`--key-overwrite`) em vez de sempre gerar uma nova.

### Configuração e persistência

- **Configuração por arquivo**: parâmetros em `~/.paje/env.yaml` (ou `--env-file`), com prioridade sobre padrões embutidos; criado automaticamente na primeira execução a partir de um template comentado.
- **Editor de parâmetros na TUI (`Ctrl+E`)**: edição inline do `env.yaml` sem sair da interface, com alterações pendentes até salvar — grava preservando comentários e ordem das linhas, nunca reescrevendo o arquivo do zero.
- **Ordem de prioridade clara**: propriedade do servidor > argumento de linha de comando > `env.yaml` > padrão embutido — cada servidor pode sobrepor filtros, diretório e e-mail individualmente.
- **Persistência local**: servidores e tokens em `~/.paje/git-servers.json` (único segredo persistido em disco); cache da árvore em `~/.paje/git-tree-cache.json` (nunca com tokens); logs em `~/.paje/logs`.

### Interface

- **CLI + TUI + VSCode**: execução por comando (`paje <comando>`), interface textual guiada ao iniciar sem parâmetros, e extensão VSCode com a árvore de repositórios na sidebar — as três camadas de apresentação consomem o mesmo core.
- **Modal de ajuda contextual (`Ctrl+H`)**: lista os atalhos válidos na tela atual; apertar a tecla ali dentro fecha a ajuda e já executa o atalho.
- **Modal de parâmetros carregados (`Ctrl+P`)**: mostra de onde veio cada valor em uso (CLI, env.yaml, calculado).
- **Área de trabalho e log em tela cheia** (`Ctrl+W`/`Ctrl+L`): alterna cada painel entre o layout padrão e ocupar a tela inteira.
- **Logs estruturados com pino**: console, arquivo diário e painel TUI colorizado por nível (debug/info/aviso/erro), com scroll automático.
- **Interface em português e inglês**: detecta o idioma automaticamente (ou `--locale`) — CLI, TUI e extensão VSCode inteiramente traduzidas.

### Multiplataforma

- Linux, macOS, Windows (PowerShell e cmd) e WSL — instalador dedicado por plataforma, com verificação/instalação automática de Git e Node.js 24.x.
- No WSL, filtra automaticamente entradas do PATH do Windows para não conflitar com binários Linux.

## Requisitos

- Linux/macOS com Bash, ou Windows 10+ com PowerShell (WSL também suportado — `paje.sh` filtra o PATH do Windows automaticamente)
- Git
- Node.js 24.x (Active LTS) + npm

## Instalação

### Linux, macOS ou WSL

```bash
curl -fsSL https://raw.githubusercontent.com/lukeboh/paje/main/install-paje.sh -o install-paje.sh \
  && chmod +x install-paje.sh && ./install-paje.sh
```

O instalador verifica o Git, clona o repositório, executa health-check, garante Node.js 24.x (chamando `config-paje.sh` — ver abaixo), roda `npm install`, cria o link `paje`, opcionalmente adiciona ao `PATH` e registra uma função `paje()` no `.bashrc`/`.zshrc`/`.profile` (necessária para o "cd persistente" do `Ctrl+Q` — ver "Sair no diretório do repositório destacado" abaixo). Ao final, o PAJÉ já está pronto pra rodar com `paje` — a única exceção é essa função nova: como ela é escrita no arquivo de configuração do shell (não pode ser aplicada retroativamente na sessão que rodou o instalador — limitação do sistema operacional, não do PAJÉ), o terminal atual só passa a usá-la depois de `source ~/.bashrc` (o instalador avisa o comando exato ao final) ou de abrir um terminal novo; até lá, `Ctrl+Q` continua funcionando normalmente, só sem o "cd" persistente. **Quem já tinha o PAJÉ instalado antes dessas etapas existirem** pode rodar o instalador de novo a qualquer momento: ele detecta o que já está feito (repositório clonado, PATH, função de shell) e só completa o que falta, incluindo reinstalar dependências que ficaram desatualizadas.

`config-paje.sh` continua existindo como script separado, standalone, pra quem só quer atualizar a versão do Node.js depois — sem precisar rodar o instalador inteiro de novo:

```bash
./config-paje.sh
```

### Windows (PowerShell)

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/lukeboh/paje/main/install-paje.ps1" -OutFile install-paje.ps1
.\install-paje.ps1
```

Mesmo comportamento do instalador Linux (checa o Git e o Node.js — instalando via `winget` se necessário —, clona o repositório, executa health-check, roda `npm install` e oferece adicionar o PAJÉ ao `PATH` do usuário), adaptado às ferramentas nativas do PowerShell 5.1+/7+. Se o PowerShell bloquear a execução do script baixado, rode `Unblock-File install-paje.ps1` antes, ou ajuste a política de execução da sessão atual com `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

O instalador também cria `paje.cmd` junto do `paje.ps1` — um shim que permite chamar `paje` (sem digitar a extensão) tanto no `cmd.exe` quanto dentro do próprio PowerShell, exatamente como no Linux. Isso é necessário porque `.ps1` não faz parte do `PATHEXT` padrão do Windows, e o PowerShell recusa por segurança rodar um script pelo nome nu mesmo com o diretório no `PATH` — só `.cmd`/`.bat`/`.exe` resolvem dessa forma.

O instalador também registra uma função `paje` no `$PROFILE` do PowerShell, necessária para o "cd persistente" do `Ctrl+Q` (mesma lógica do `.bashrc`/`.zshrc` no Linux — ver "Sair no diretório do repositório destacado" abaixo). Quem já tinha o PAJÉ instalado antes dessa função existir precisa rodar o instalador de novo ou reabrir o PowerShell. **`cmd.exe` puro (sem passar pela função do PowerShell) não ganha essa funcionalidade** — `Ctrl+Q` continua encerrando o PAJÉ normalmente, só que o terminal não muda de diretório.

### Windows (cmd)

Equivalente ao comando acima, mas rodável direto no `cmd.exe` — já contorna o bloqueio de política de execução sem precisar de `Unblock-File`/`Set-ExecutionPolicy` manual, já que `-ExecutionPolicy Bypass` é aplicado só ao processo do PowerShell que baixa e executa o script, sem alterar nenhuma configuração persistente do sistema:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri https://raw.githubusercontent.com/lukeboh/paje/main/install-paje.ps1 -OutFile install-paje.ps1" && powershell -NoProfile -ExecutionPolicy Bypass -File install-paje.ps1
```

## Como executar

```bash
paje                          # TUI interativa (menu de funcionalidades)
paje git-sync [opções]        # CLI — sincronizar repositórios
paje git-server-store [opções]# CLI — registrar servidor, SSH e token
npm run dev -- <comando>      # execução de desenvolvimento
npm run build:vscode          # empacotar a extensão VSCode (vscode-extension/)
```

No Windows, os mesmos comandos funcionam com `paje` normalmente, desde que o diretório de instalação esteja no `PATH` (o instalador oferece isso automaticamente) — o shim `paje.cmd` cuida de repassar tudo para `paje.ps1`. Sem isso no `PATH`, use `.\paje.cmd` (ou `.\paje.ps1`) de dentro do diretório de instalação.

---

## Funcionalidades

### `git-sync` — sincronizar repositórios Git

Carrega a árvore de grupos/projetos de todos os servidores configurados (GitLab e GitHub), exibe na TUI para seleção e sincroniza em paralelo.

**Parâmetros principais:**

| Flag CLI | Chave env | Padrão | Descrição |
|---|---|---|---|
| `--base-dir <dir>` | `baseDir` | `repos` | Diretório base de clonagem |
| `--server-name <name>` | `serverName` | `""` | Filtrar por nome de servidor |
| `--base-url <url>` | `baseUrl` | `""` | Filtrar por URL de servidor |
| `--use-basic-auth` | `useBasicAuth` | `false` | HTTPS + PAT em vez de SSH |
| `--username <u>` | `username` | `""` | Usuário para auth básica |
| `--user-email <e>` | `userEmail` | `""` | E-mail Git nos repos clonados |
| `--no-public-repos` | `noPublicRepos` | `false` | Ocultar repos públicos |
| `--no-archived-repos` | `noArchivedRepos` | `false` | Ocultar repos arquivados |
| `--filter <padrão>` | `filter` | `""` | Filtro Ant/Glob de `path_with_namespace` (`;` separa múltiplos) |
| `--exclude-filter <padrão>` | `excludeFilter` | `""` | Filtro Ant/Glob de **exclusão** — repositórios/pastas nunca sincronizados nem exibidos na árvore, mesmo com acesso (mesma sintaxe do `filter`; excluir uma pasta exclui tudo dentro dela) |
| `--sync-repos <lista>` | `syncRepos` | `""` | Repos/branches a sincronizar (`grupo/repo#branch;...`) |
| `--parallels <n>` | `parallels` | `auto` | Paralelismo (`AUTO` \| `0` \| `1..N`) |
| `--dry-run` | `dryRun` | `false` | Simular sem persistir |
| `--prepare-local-dirs` | `prepareLocalDirs` | `false` | Criar estrutura de diretórios sem clonar |
| `--no-summary` | `noSummary` | `false` | Ocultar resumo final |
| `--verbose` | `verbose` | `false` | Logs detalhados |
| `--env-file <path>` | — | `~/.paje/env.yaml` | Arquivo de ambiente |

**Comportamento relevante:**

- Opera sobre todos os servidores configurados quando nenhum filtro de servidor é fornecido.
- **Cache da árvore**: após a primeira carga completa, a árvore é gravada em `~/.paje/git-tree-cache.json`. Nas execuções seguintes ela abre instantaneamente a partir do cache, e o status local de cada repositório é recalculado em segundo plano (até 4 repositórios por vez), atualizando a TUI linha a linha. O cache não tem TTL — é invalidado apenas quando a configuração de servidores muda (nome, URL, filtros). Tokens nunca são gravados no cache.
- **Cursor no contexto**: se o comando é executado de dentro de um clone git, a TUI abre com o cursor posicionado no repositório correspondente.
- A TUI pré-seleciona repositórios com clone local (`[x]`); grupos propagam seleção parcial (`[~]`).
- Grupos com o mesmo `full_path` em servidores diferentes são consolidados em um único nó.
- Em colisão de caminho local (mesmo `path_with_namespace` em servidores diferentes), o diretório recebe sufixo `-<Servidor>`.
- Filtros Ant/Glob suportam `?`, `*`, `**`; múltiplos padrões separados por `;`.
- **Excluir da árvore (Ctrl+D)**: na TUI, `Ctrl+D` no item destacado abre um modal de confirmação e adiciona o repositório (ou, se for uma pasta, ela e tudo dentro dela) ao `excludeFilter`, gravando em `env.yaml` — a partir daí, nunca mais aparece na árvore nem é sincronizado, mesmo com acesso. Repita em outros itens para excluir mais de um.
- **Checkout em massa (Ctrl+K)**: na TUI, com um ou mais itens marcados por checkbox, pede o nome de uma branch e faz checkout dela em todos os repositórios marcados. Se a branch não existir em algum deles, avisa quais faltam e oferece a opção de criá-la (e enviá-la ao remoto) ali também. Sem nenhum item marcado, apenas avisa — não há fallback para o item destacado.
- **Voltar em massa à branch padrão (Ctrl+R)**: mesma exigência de seleção do Ctrl+K; volta cada repositório marcado à sua própria branch padrão, pulando (sem travar o lote) os que não têm branch padrão conhecida.
- **Renomear branch (dentro do Ctrl+B)**: a modal de branch já existente ganhou a opção "✎ Renomear branch atual" — renomeia localmente (`git branch -m`) e, se houver remoto configurado, envia o novo nome e remove o antigo do remoto (nessa ordem, para nunca deixar a branch sem nenhuma cópia remota). Opera sobre um único repositório (o destacado), não em massa.
- **Tag ARQUIVADO**: repositórios com `archived: true` na API de origem exibem uma tag "ARQUIVADO" (cinza) junto de servidor/branch/status na árvore, sempre que não estiverem ocultos por `--no-archived-repos`.
- **Sair no diretório do repositório destacado (Ctrl+Q)**: encerra o PAJÉ e deixa o terminal posicionado no diretório do repositório destacado pelo cursor (não precisa estar marcado por checkbox). Exige um projeto com clone git já existente localmente; num grupo, ou num projeto ainda não clonado, apenas avisa. **Requer a função de shell instalada pelo instalador** (ver seção de Instalação) — sem ela, o PAJÉ ainda encerra normalmente, mas o terminal não muda de diretório.
- Em servidores GitHub, organizações são exibidas como grupos e o login do usuário aparece como grupo pessoal.
- O log usa `LoggerBroker` (motor pino) com transports para console (`info`), painel TUI (`info`; `debug` com `--verbose`) e arquivo diário `~/.paje/logs` via pino-pretty.

---

### `git-server-store` — registrar e editar servidores

Registra um servidor GitLab ou GitHub. Para GitLab: gera ou reutiliza chave SSH, configura `~/.ssh/config` e cria/rotaciona PAT. Para GitHub: valida um Personal Access Token e o persiste.

Na TUI, a tela **Gerenciar Servidores Git** lista os servidores já salvos além da opção de registrar um novo. Selecionar um servidor existente abre o **mesmo formulário de cadastro, já preenchido** com os dados atuais — permitindo visualizar, alterar e salvar sem duplicar a entrada nem apagar propriedades que o formulário não exibe (`userEmail`, `baseDir`, `filter` etc.).

**Parâmetros principais:**

| Flag CLI | Chave env | Padrão | Descrição |
|---|---|---|---|
| `--base-url <url>` | `baseUrl` | `""` | URL base do servidor (ex.: `https://github.com` ou `https://gitlab.com`) |
| `--server-name <name>` | `serverName` | `GitLab` | Nome do servidor |
| `--server-type <tipo>` | — | auto | `gitlab` ou `github` (detectado pela URL quando omitido) |
| `--token <token>` | — | `""` | PAT do GitHub (evita o prompt interativo) |
| `--username <u>` | `username` | `""` | Usuário do GitLab |
| `--use-basic-auth` | `useBasicAuth` | `false` | Usar HTTPS + PAT (sem SSH) |
| `--token-name <name>` | `tokenName` | `""` | Nome do PAT no GitLab |
| `--token-scopes <escopos>` | `tokenScopes` | `read_repository,read_api,…` | Escopos do PAT |
| `--token-expires-at <data>` | `tokenExpiresAt` | `""` | Expiração do PAT (`YYYY-MM-DD`) |
| `--key-label <name>` | `keyLabel` | `""` | Nome da chave SSH |
| `--public-key-path <path>` | `publicKeyPath` | `""` | Reutilizar chave pública existente |
| `--key-overwrite` | `keyOverwrite` | `false` | Sobrescrever chave existente |
| `--base-dir <dir>` | `baseDir` | `""` | Diretório base salvo neste servidor |
| `--user-email <e>` | `userEmail` | `""` | E-mail Git salvo neste servidor |
| `--filter <padrão>` | `filter` | `""` | Filtro Ant/Glob salvo neste servidor |
| `--env-file <path>` | — | `~/.paje/env.yaml` | Arquivo de credenciais |

Na TUI, o cadastro de um servidor GitLab pergunta primeiro **como autenticar**:
chave SSH (recomendado — gera chave **e** token), usuário/senha (bootstrap de
token único, senha nunca persistida) ou colar um token já existente (nenhuma
senha necessária). Todo servidor termina com um token e/ou chave SSH — nunca
com uma senha guardada em lugar nenhum.

**Fluxo SSH (padrão, `--use-basic-auth` ausente):**

1. Sonda TCP na porta 22 do servidor (timeout 3 s).
2. Se porta 22 bloqueada: exibe guia passo a passo para geração de PAT no GitLab (e futuramente GitHub) e encerra — reexecutar com `--use-basic-auth` ou `--token`.
3. Gera ou reutiliza par de chaves ed25519.
4. Atualiza `~/.ssh/config` e `~/.ssh/known_hosts`.
5. Registra a chave pública no GitLab e cria/rotaciona PAT (sempre — mesmo no fluxo SSH, o servidor termina com um token também).
6. Persiste o servidor e token em `~/.paje/git-servers.json`.

**Fluxo HTTPS + PAT via senha (`--use-basic-auth`, GitLab):**

1. Valida token existente salvo (se houver) e reutiliza se válido.
2. Se inválido, rotaciona automaticamente.
3. Se não houver token, solicita a senha (nunca lida de `env.yaml`), cria novo PAT via login web e persiste — a senha é usada uma única vez e descartada.
4. As operações `git clone/pull/push` passam a usar URL HTTPS com `oauth2:<token>@host` embutido.

**Fluxo "já tenho um token" (`--token`, GitLab):**

1. Sem senha, sem chave SSH, sem prompt de usuário.
2. Valida o token informado e persiste o servidor.

**Fluxo GitHub (auto-detectado para `github.com` ou forçado com `--server-type github`):**

1. Recebe o PAT via `--token`, reutiliza o token salvo do servidor ou solicita interativamente.
2. Valida o token via API (`GET /user`) e captura o login do usuário.
3. Persiste o servidor com `type: "github"` em `~/.paje/git-servers.json`.
4. As operações git usam URL HTTPS com `x-access-token:<token>@host` embutido (não há fluxo SSH para GitHub).

> Crie o PAT em `github.com/settings/tokens` com escopos `repo` e `read:org`. Para GitHub Enterprise Server, a API é resolvida como `<baseUrl>/api/v3`.

---

### Extensão VSCode

A árvore de repositórios do PAJÉ dentro do VSCode (ícone na barra de atividades), consumindo o mesmo core e a mesma configuração da CLI/TUI — cache instantâneo compartilhado, checkboxes de seleção, sincronização com progresso, log no Output Channel "PAJÉ" e interface em pt-BR/inglês conforme o idioma do VSCode.

**Instalação (a partir do repositório):**

```bash
npm install
npm run build:vscode                          # typecheck + bundle
cd vscode-extension
npx @vscode/vsce package --no-dependencies    # gera paje-vscode-<versão>.vsix
code --install-extension paje-vscode-*.vsix
```

Também é possível instalar pela interface (Extensões → `...` → *Install from VSIX...*) ou testar em modo desenvolvimento abrindo a pasta `vscode-extension/` no VSCode e pressionando `F5`.

**Comandos:** sincronizar selecionados, sincronizar um item, recarregar árvore, abrir repositório em nova janela, abrir `env.yaml`.

> O registro de servidores continua na CLI/TUI (`paje git-server-store`). Detalhes em [`docs/funcionalidades/vscode-extension.md`](docs/funcionalidades/vscode-extension.md).

---

## Propriedades por servidor (`~/.paje/git-servers.json`)

Cada servidor registrado armazena suas próprias propriedades. Durante o `git-sync`, essas propriedades têm **prioridade** sobre os parâmetros de sessão (CLI/env):

| Propriedade | Descrição |
|---|---|
| `type` | Tipo do servidor: `gitlab` (padrão) ou `github` |
| `baseDir` | Diretório base de clone exclusivo deste servidor |
| `userEmail` | E-mail Git aplicado aos repos deste servidor |
| `filter` | Filtro Ant/Glob aplicado antes da mesclagem multi-servidor |
| `noPublicRepos` | Ocultar repos públicos deste servidor |
| `noArchivedRepos` | Ocultar repos arquivados deste servidor |
| `syncRepos` | Repos/branches a sincronizar deste servidor |
| `token` | PAT salvo — único segredo persistido em disco |

**Ordem de prioridade para resolução de parâmetros:**

```
Propriedade do servidor (git-servers.json)
  > Argumento CLI (--flag)
    > Arquivo de ambiente (env.yaml)
      > Padrão embutido
```

Veja tabela completa em [`docs/arquitetura.md`](docs/arquitetura.md) — seções *Parâmetros* e *Propriedades por servidor*.

---

## Configuração por arquivo (`env.yaml`)

O PAJÉ lê parâmetros de `~/.paje/env.yaml` por padrão, ou do caminho informado em `--env-file`.

**Criação automática na primeira execução**: se `~/.paje/env.yaml` não existir, o PAJÉ o cria automaticamente a partir de [`env-template.yaml`](env-template.yaml) (raiz do repositório) — com todos os parâmetros disponíveis, valores padrão e comentários explicativos. Isso acontece na primeira vez que qualquer comando é executado (`paje`, `paje git-sync` ou `paje git-server-store`), não apenas no menu. Execuções seguintes nunca sobrescrevem o arquivo.

**Comentários nunca são suprimidos ao atualizar**: tanto a criação inicial quanto qualquer atualização subsequente — pelo editor da TUI (`Ctrl+E`) ou por outros fluxos que gravam no arquivo — preservam os comentários e a ordem das linhas existentes. Uma chave alterada é atualizada *in-place*; uma chave nova é anexada ao final. Se o arquivo alvo não existir no momento da gravação (por exemplo, foi apagado manualmente), a gravação parte do template completo em vez de um arquivo em branco.

> Esta criação automática só ocorre para o caminho padrão (`~/.paje/env.yaml`). Um `--env-file <caminho>` explícito apontando para um arquivo inexistente não é criado automaticamente — comportamento inalterado, útil para testes e configurações avançadas.

```yaml
# ~/.paje/env.yaml — trecho do template gerado automaticamente
# (veja env-template.yaml na raiz para o arquivo completo, com comentários)
locale: ""
username: ""
user-email: ""
server-name: ""
base-url: ""
base-dir: "repos"
use-basic-auth: false
verbose: false
key-label: "paje"
filter: ""
sync-repos: "grupo/projeto#main;grupo/outro"
parallels: "auto"
dry-run: false
token-name: "paje-token"
token-scopes: ["read_repository", "read_api", "read_virtual_registry", "self_rotate"]
token-expires-at: "2027-01-01"
```

> Este arquivo não tem — e nunca teve — um campo de senha: ela só existe em memória, pedida interativamente (ou via `--password`) para o bootstrap único de um token ou chave SSH, e nunca é persistida em lugar nenhum. Tokens de acesso pessoal (GitLab/GitHub) também não ficam neste arquivo — são armazenados em `~/.paje/git-servers.json` após o registro do servidor. Use permissões restritas (`chmod 600`) para ambos os arquivos.

---

## Interface TUI

A TUI é composta por quatro quadros:

1. **Barra de título** — 1 linha no topo com o nome da funcionalidade.
2. **Área de trabalho** — menus, formulários e árvore de repositórios.
3. **Barra de orientação** — 1 linha com atalhos contextuais.
4. **Painel de log** — ~15% da tela, com timestamp por linha, colorização por nível (debug cinza, aviso amarelo, erro vermelho), truncamento em uma linha por entrada e auto-scroll.

### Editor de parâmetros (`Ctrl+E`)

Abre um modal para editar o `env.yaml` sem sair da TUI:

- `↑/↓` navegam; `Enter` edita o valor do parâmetro selecionado; `Esc` cancela a edição em curso.
- Alterações ficam **pendentes** (badge magenta) até `Ctrl+S`, que grava no arquivo preservando comentários e convertendo chaves para kebab-case (`baseDir` → `base-dir`).
- Parâmetros vindos da linha de comando ou calculados são exibidos como somente leitura.
- Enquanto o editor está aberto, `Ctrl+P`/`Ctrl+H` são bloqueados para não descartar pendências; `Esc` fora do modo edição fecha o editor.

Layout detalhado em [`docs/TUI-leiaute.md`](docs/TUI-leiaute.md).

### Atalhos globais

| Atalho | Ação |
|---|---|
| `Ctrl+H` | Abrir/fechar modal de ajuda (atalhos) |
| `Ctrl+P` | Abrir/fechar modal de parâmetros carregados |
| `Ctrl+E` | Abrir/fechar editor de parâmetros do env.yaml |
| `Ctrl+W` | Alternar área de trabalho entre padrão e tela cheia |
| `Ctrl+L` | Alternar painel de log entre padrão e tela cheia |
| `Esc` | Fechar modal → restaurar painel maximizado → voltar tela → sair (no menu) |
| `Ctrl+C` | Encerrar a aplicação |

### Atalhos do menu

| Atalho | Ação |
|---|---|
| `Ctrl+S` | Selecionar git-sync |
| `Ctrl+G` | Selecionar git-server-store |
| `Enter` | Confirmar seleção |
| `↑ ↓ ← →` / `Tab` | Navegar entre cartões |
| `1` / `2` | Selecionar cartão pelo número |

### Atalhos da árvore git-sync

| Atalho | Ação |
|---|---|
| `↑ ↓` / `PgUp PgDn` | Navegar |
| `Home` / `End` | Ir ao início/fim da lista |
| `Space` | Selecionar/deselecionar repositório |
| `Ctrl+F` | Entrar no modo de pesquisa por nome |
| *digitar texto (no modo de pesquisa)* | Filtrar a árvore em tempo real (Backspace apaga; Esc sai do modo e limpa) |
| `Ctrl+S` | Sincronizar todos os marcados |
| `Enter` | Sincronizar apenas o escopo destacado (linha/grupo) |
| `Ctrl+X` | Alternar filtro: todos / apenas selecionados |
| `Ctrl+B` | Abrir modal de seleção de branch |
| `Ctrl+D` | Excluir item destacado da árvore (`excludeFilter`) |
| `Ctrl+K` | Checkout em massa nos itens marcados (com opção de criar) |
| `Ctrl+R` | Voltar os itens marcados para a branch padrão de cada um |
| `Ctrl+Q` | Sair no diretório do repositório destacado |
| `Esc` | Cancelar |

> Nota: o terminal envia o mesmo byte para `Ctrl+M` e `Enter`, e o byte de backspace para `Ctrl+H`. Por isso a pesquisa por nome exige `Ctrl+F` antes de digitar, e a ajuda (`Ctrl+H`) é reconhecida pelo byte de backspace nas telas sem campo de texto ativo.

---

## Testes

```bash
npm run build   # compilação TypeScript — deve terminar sem erros
npm test        # suite completa (runner tolerante a falhas + resumo final)
```

- O runner (`tests/run-all.ts`) é tolerante a falhas: um teste que quebra não impede os demais de rodar. Ao final é impresso `Todos os arquivos de teste passaram.` ou a lista de arquivos com falha, e o exit code reflete o resultado.
- Os testes de TUI usam `tests/tui_test_utils.ts` (TTY simulado com bytes reais de teclado — `KEYS.ctrlP`, `KEYS.ctrlE` etc. — e captura de frames do Ink).
- Os testes de chave SSH requerem `ssh-keygen`; em containers sem ele: `apt-get install -y openssh-client`.

---

## Roadmap

### Novas funcionalidades planejadas

Ideias registradas para o futuro — **ainda não implementadas**, sem previsão:

- **Sincronizar todas as branches dos repositórios locais** (não só a que está em checkout no momento): um comando novo (`Ctrl+Alt+S` na árvore), tanto individual (repositório destacado) quanto em massa (todos os marcados), que atualiza cada branch local a partir do remoto sem precisar fazer checkout nela primeiro.
- **Purge de branches locais que não existem mais no servidor**: individual ou em massa. O purge já apaga a branch local — exceto quando ela ainda não foi mergeada, caso em que pergunta ao usuário se quer fazer checkout para essa branch não mergeada, ignorá-la (deixar como está), ou apagá-la mesmo assim.

### Bugs conhecidos

Relatados, ainda **não reproduzidos/diagnosticados** neste ambiente de desenvolvimento:

- **TUI trava sem responder a nenhuma tecla no Windows, depois que a árvore carrega** — relatado com 3 servidores já cadastrados (ainda não confirmado se é a causa). Depois que a árvore do `git-sync` termina de carregar, nenhuma tecla tem efeito; a única forma de sair é fechar o terminal à força, e o problema se repete em execuções seguintes. Sem um ambiente Windows disponível para reproduzir diretamente — hipótese a investigar: alguma camada da cadeia `paje.cmd` → `powershell.exe` → `npm run dev` → `tsx`/`node` pode não estar entregando ao processo um `stdin` em modo raw de verdade, que é o que o Ink precisa para capturar teclado.
- **Ao sair do PAJÉ no Windows, fica numa tela vazia até `Ctrl+C`** — depois de sair da TUI, o terminal fica com a tela em branco, sem devolver o prompt; só depois de apertar `Ctrl+C` aparece o prompt nativo do `cmd.exe` "Deseja finalizar o arquivo em lotes (S/N)?" — sinal de que o processo Node, por baixo da cadeia `paje.cmd` → `powershell.exe` → `npm run dev` → `tsx`, não está terminando sozinho ao final da execução (nenhum `process.exit()` é chamado hoje em nenhum caminho de saída "normal", fora do `Ctrl+Q`; o processo deveria encerrar pelo esvaziamento natural do event loop, mas algo na cadeia do Windows parece não deixar isso acontecer). Possivelmente relacionado ao bug anterior (travamento de teclado) — mesma cadeia de processos sob suspeita. Não reproduzido neste ambiente (sem Windows disponível).

---

## Documentação técnica

| Documento | Conteúdo |
|---|---|
| [`docs/arquitetura.md`](docs/arquitetura.md) | Separação de camadas, tabela de parâmetros, propriedades de servidor, cache, logging, ordem de prioridade |
| [`docs/TUI-leiaute.md`](docs/TUI-leiaute.md) | Layout obrigatório da TUI, atalhos e componentes |
| [`docs/requisitos-tui-git-sync.md`](docs/requisitos-tui-git-sync.md) | Requisitos funcionais e de usabilidade da TUI git-sync |
| [`docs/funcionalidades/git-sync.md`](docs/funcionalidades/git-sync.md) | Especificação da funcionalidade git-sync |
| [`docs/funcionalidades/git-server-store.md`](docs/funcionalidades/git-server-store.md) | Especificação da funcionalidade git-server-store (GitLab e GitHub) |
| [`docs/funcionalidades/help-shortcuts.md`](docs/funcionalidades/help-shortcuts.md) | Modal de ajuda e tabela completa de atalhos por contexto |
| [`docs/funcionalidades/vscode-extension.md`](docs/funcionalidades/vscode-extension.md) | Extensão VSCode: instalação, comandos e comportamento |
| [`vscode-extension/README.md`](vscode-extension/README.md) | Extensão VSCode: desenvolvimento e empacotamento |
| [`docs/auditoria-codigo.md`](docs/auditoria-codigo.md) | Bugs, inconsistências e débitos técnicos — abertos e resolvidos, com workarounds |
| [`docs/auditoria-arquitetura.md`](docs/auditoria-arquitetura.md) | Histórico de problemas arquiteturais e status de resolução |
| [`CLAUDE.md`](CLAUDE.md) | Regras obrigatórias para agentes (arquitetura, testes, i18n, commits) |
