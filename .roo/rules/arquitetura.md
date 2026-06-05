# Regra global — Arquitetura do PAJÉ

**Antes de qualquer análise, pergunta ou evolução neste projeto, leia obrigatoriamente:**

1. [`CLAUDE.md`](../../CLAUDE.md) — regras de arquitetura, separação de camadas,
   proibições explícitas e ciclo de testes obrigatório.
2. [`docs/arquitetura.md`](../../docs/arquitetura.md) — visão geral e diagrama
   de camadas para desenvolvedores.

Estas regras definem o que pertence ao core, à apresentação (CLI/TUI) e à
infraestrutura, e o que é **proibido** em cada camada.
Ignorá-las é a principal fonte de divergência arquitetural neste projeto.
