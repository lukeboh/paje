# Regra de código — Arquitetura e ciclo de testes

## Leitura obrigatória antes de qualquer modificação de código

Leia os arquivos abaixo **antes** de escrever ou alterar qualquer linha:

1. [`CLAUDE.md`](../../CLAUDE.md) — separação de camadas, proibições por camada,
   padrão de uso do core e ciclo de testes.
2. [`docs/arquitetura.md`](../../docs/arquitetura.md) — diagrama de camadas e
   responsabilidades.
3. [`docs/auditoria-arquitetura.md`](../../docs/auditoria-arquitetura.md) — 16 problemas
   arquiteturais conhecidos com arquivo:linha. Se o ponto que você vai tocar está listado,
   corrija no sentido da arquitetura correta, não do código atual.

## Regras resumidas (detalhes em CLAUDE.md)

- **Nunca** implementar lógica de negócio fora de `src/modules/git/core/`.
- **Nunca** chamar `GitLabApi`, `parallelSync()` ou funções de resolução de paths
  diretamente da camada de apresentação (`gitCommand.ts`, `tui.app.tsx`, `tuiSession.tsx`).
- **Sempre** usar `core.loadTree()` para carregar projetos e `core.syncSelected()`
  para sincronizar — tanto na CLI quanto na TUI.
- **Nunca** duplicar uma função que já existe no core.

## Ciclo de testes obrigatório

Após toda modificação:

```bash
npm run build   # sem erros de TypeScript
npm test        # sem novas falhas
```

Não faça commit se qualquer um falhar (exceto as falhas pré-existentes documentadas
em `CLAUDE.md`).
