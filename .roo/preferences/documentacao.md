# Preferências de documentação (PAJÉ)

## Estrutura obrigatória

- `README.md` é o documento introdutório e deve permitir aprender a usar o sistema.
- `docs/funcionalidades/<func>.md` contém requisitos detalhados por funcionalidade.
- `docs/arquitetura.md` descreve organização do código e fluxos principais.
- `docs/TUI-leiaute.md` padroniza a interface TUI.
- `docs/auditoria-codigo.md` registra bugs, inconsistências e itens de UX — abertos e resolvidos.

## Regras de atualização

- Qualquer alteração de comportamento exige atualização simultânea de `README.md` e do arquivo de requisitos da funcionalidade.
- Mudanças na TUI devem atualizar `docs/TUI-leiaute.md`.
- Bugs descobertos devem ser registrados e, quando corrigidos, a solução deve ser documentada.

## Convenções

- Escrita em pt-BR.
- Citar arquivos relevantes com links relativos.
- Descrever parâmetros (CLI/env), retorno e comportamento.
