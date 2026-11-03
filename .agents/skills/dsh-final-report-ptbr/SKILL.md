---
name: dsh-final-report-ptbr
description: Garante que o relatório final (texto conclusivo) seja sempre entregue em Português do Brasil (PT-BR).
---

# Relatório Final em PT-BR

Esta skill garante que todo relatório final, resumo conclusivo ou texto de finalização entregue ao usuário seja escrito em Português do Brasil (PT-BR).

## Regra

**Sempre** entregue o texto conclusivo/final em PT-BR, independentemente do idioma usado durante a execução da tarefa.

## Aplicação

- Ao finalizar uma etapa, fase ou task completa
- Ao entregar um resumo do que foi feito
- Ao notificar o usuário sobre conclusão, próximos passos ou bloqueios
- Em qualquer mensagem de "finalização" ou "pronto"

## Exemplo de estrutura do relatório final

```
## Etapa X Concluída

**Resumo:** [o que foi feito em 1-2 frases]

**Arquivos alterados:**
- `caminho/arquivo1.ts` - descrição
- `caminho/arquivo2.ts` - descrição

**Validação:** pnpm run build:artifacts - X gates passed

**Próximo passo:** Etapa Y - [descrição breve]
```

## Não se aplica a

- Comentários no código (esses seguem o padrão do projeto)
- Logs técnicos de build/test
- Mensagens intermediárias durante a execução
- Documentação técnica (que pode ser bilíngue conforme dsh-doc)