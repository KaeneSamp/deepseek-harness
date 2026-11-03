# Plano de Implementação — Exclusão de Sessão com Lixeira (30 dias)

> **Objetivo**: Adicionar a opção "Excluir sessão" (mover para lixeira) com exclusão automática após 30 dias, integrada à API existente do DeepSeek Harness.

---

## 📋 Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Client)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Context Menu│  │  Trash View │  │  Confirmation Dialogs   │  │
│  │  (menu)     │  │  (sidebar)  │  │  (delete/restore/purge) │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────│────────────────│─────────────────────│────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (Host)                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ WorkspaceController│  │ SessionController  │  │ ScheduleService│  │
│  │  (archive/trash)   │  │  (delete endpoint)  │  │  (auto-purge)  │  │
│  └────────┬───────────┘  └────────┬───────────┘  └──────┬───────┘  │
└───────────│────────────────────────│─────────────────────│──────────┘
            │                        │                     │
            ▼                        ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PERSISTÊNCIA (Storage)                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ Session Files   │  │ Workspace Index │  │ Schedule Store │  │
│  │ (.jsonl + meta) │  │ (archived/trash)│  │ (purge tasks)  │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Etapas de Implementação

### ✅ ETAPA 1 — Backend: Novo endpoint `workspace/trashSession` e `workspace/restoreFromTrash`

**Arquivos a modificar/criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/api/workspace-controller/src/types.ts` | **Modificar** | Adicionar types: `WorkspaceTrashSessionRequest`, `WorkspaceTrashSessionValue`, `WorkspaceRestoreFromTrashRequest`, `WorkspaceTrashSessionEntry` |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Implementar `trashSession()` e `restoreFromTrash()` |
| `packages/api/workspace-controller/src/index.ts` | **Modificar** | Expor endpoints `@Remote('trashSession')` e `@Remote('restoreFromTrash')` |
| `packages/api/workspace-controller/src/feed.ts` | **Modificar** | Atualizar `WorkspaceFeed` para incluir `trashedSessionIds` no baseline/stream |

**Checklist Etapa 1:**

- [ ] Adicionar tipos TypeScript para request/response de lixeira
- [ ] Implementar `WorkspaceCommands.trashSession()` — move `sessionId` de `archivedSessionIds` → `trashedSessionIds` com timestamp `trashedAt`
- [ ] Implementar `WorkspaceCommands.restoreFromTrash()` — move de volta para `archivedSessionIds` (ou sessão ativa)
- [ ] Registrar endpoints `workspace/trashSession` e `workspace/restoreFromTrash` no `WorkspaceController`
- [ ] Atualizar `WorkspaceFeed` para emitir `trashedSessionIds` no baseline e increments
- [ ] Adicionar validação: só pode mandar para lixeira sessões **já arquivadas** (regra de negócio)
- [ ] Testes unitários: `workspace/trashSession` e `workspace/restoreFromTrash`
- [ ] Testes de integração: fluxo archive → trash → restore

---

### ✅ ETAPA 2 — Backend: Endpoint `workspace/purgeTrashedSession` (exclusão definitiva)

**Arquivos a modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/api/workspace-controller/src/types.ts` | **Modificar** | Adicionar `WorkspacePurgeTrashedSessionRequest`, `WorkspacePurgeTrashedSessionValue` |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Implementar `purgeTrashedSession()` — apaga arquivos da sessão do disco |
| `packages/api/workspace-controller/src/index.ts` | **Modificar** | Expor `@Remote('purgeTrashedSession')` |

**Checklist Etapa 2:**

- [ ] Adicionar tipos para purge
- [ ] Implementar `WorkspaceCommands.purgeTrashedSession()`:
  - [ ] Remover `sessionId` de `trashedSessionIds`
  - [ ] Chamar `sessionPersistence.delete(sessionId)` para apagar arquivos físicos (`.jsonl`, checkpoints, etc.)
  - [ ] Emitir evento `api-session/removed` (já existe)
- [ ] Registrar endpoint `workspace/purgeTrashedSession`
- [ ] Validação: só pode purgar sessões que estão na lixeira (`trashedSessionIds`)
- [ ] Testes unitários e de integração

---

### ✅ ETAPA 3 — Backend: Job agendado de auto-purge (30 dias)

**Arquivos a modificar/criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/schedule/schedule/src/index.ts` | **Modificar** | Adicionar task interna de limpeza da lixeira (não exposta ao usuário) |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Exportar função `purgeExpiredTrash()` reaproveitável pelo job |
| `packages/schedule/schedule/src/storage.ts` | **Verificar** | Confirmar se schedule domain suporta tasks internas do sistema |

**Checklist Etapa 3:**

- [ ] Criar função `WorkspaceCommands.purgeExpiredTrash(cutoffDate: Date)` que:
  - [ ] Lista todas as sessões em `trashedSessionIds` com `trashedAt < cutoffDate`
  - [ ] Para cada uma, chama `purgeTrashedSession()` internamente
  - [ ] Retorna contagem de sessões purgadas
- [ ] Registrar task agendada no `ScheduleService` (ex: daily às 03:00) — **task interna, não visível ao usuário**
- [ ] Configurar retenção padrão: 30 dias (configurável via `Config` do workspace-controller)
- [ ] Testes: simular passagem de tempo, verificar auto-purge

---

### ✅ ETAPA 4 — Frontend: Menu de contexto — Adicionar "Mover para lixeira"

**Arquivos a modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/context-menus.tsx` | **Modificar** | Adicionar action `trash` (order 700, após archive) |
| `packages/client/ui-workspace/src/client/session-actions/TrashSession.tsx` | **Criar** | Componente do botão "Mover para lixeira" / "Restaurar da lixeira" |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar `TrashSessionInjected` ao tipo `Actions` |

**Checklist Etapa 4:**

- [ ] Criar `TrashSession.tsx` seguindo padrão de `ArchiveSession.tsx`:
  - [ ] Botão row: "Mover para lixeira" (ícone: trash) — só aparece se sessão **arquivada** E **não estiver na lixeira**
  - [ ] Botão row: "Restaurar da lixeira" (ícone: restore) — só aparece se sessão **na lixeira**
  - [ ] Tooltip com atalho (opcional)
- [ ] Registrar action `trash` em `context-menus.tsx` (order 700, endpoints: `workspace/trashSession`, `workspace/restoreFromTrash`)
- [ ] Adicionar `useTrashed` hook no `resolve` para verificar membership
- [ ] Adicionar `TrashSessionInjected` em `slots.ts` e injetar no `registerSessionMenus`
- [ ] Testes: `session-actions.client.spec.tsx` — novos casos para trash/restore

---

### ✅ ETAPA 5 — Frontend: Dialog de confirmação "Mover para lixeira"

**Arquivos a criar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/TrashSessionConfirmDialog.tsx` | **Criar** | Dialog de confirmação (seguindo padrão `SessionArchiveConfirmDialog`) |
| `packages/client/ui-workspace/src/client/session-actions/context-menus.tsx` | **Modificar** | Integrar dialog no flow do trash |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar `TrashSessionConfirmInjected` |

**Checklist Etapa 5:**

- [ ] Criar `TrashSessionConfirmDialog.tsx`:
  - [ ] Título: "Mover para lixeira?"
  - [ ] Texto: "A sessão será movida para a lixeira e excluída permanentemente após 30 dias. Essa ação pode ser desfeita a qualquer momento antes disso."
  - [ ] Lista itens: nome da sessão, aviso de 30 dias
  - [ ] Botões: "Cancelar", "Mover para lixeira" (destrutivo)
  - [ ] Loading state durante chamada API
  - [ ] Tratamento de erro (toast)
- [ ] Integrar no `context-menus.tsx`: ao clicar "Mover para lixeira", abre dialog → confirma → chama `trashSession()`
- [ ] Toast de sucesso: "Sessão movida para lixeira" com ação "Desfazer" (chama `restoreFromTrash`)
- [ ] Testes: dialog rendering, flow completo, error handling

---

### ✅ ETAPA 6 — Frontend: Sidebar — View "Lixeira" (Trash View)

**Arquivos a criar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/sidebar/TrashView.tsx` | **Criar** | View da lixeira (lista sessões trash) |
| `packages/client/ui-workspace/src/client/sidebar/Sidebar.tsx` | **Modificar** | Adicionar tab/item "Lixeira" na navegação |
| `packages/client/ui-workspace/src/client/stores.ts` | **Modificar** | Adicionar `trashedSessionIds` selector e actions `trashSession`, `restoreFromTrash`, `purgeTrashedSession` |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar tipos para trash view |

**Checklist Etapa 6:**

- [ ] Criar `TrashView.tsx`:
  - [ ] Lista sessões em `trashedSessionIds` (ordenadas por `trashedAt` desc)
  - [ ] Cada row mostra: título, data original, data de expiração (trashedAt + 30d), ações: "Restaurar", "Excluir agora"
  - [ ] Empty state: "Lixeira vazia"
  - [ ] Loading / error states
- [ ] Adicionar item "Lixeira" (ícone: trash) na sidebar — **só aparece se houver itens na lixeira** (ou sempre com badge count)
- [ ] Atualizar store (`createWorkspaceViewStore`) com:
  - [ ] `trashedSessionIds` selector (do workspace feed)
  - [ ] `trashSession`, `restoreFromTrash`, `purgeTrashedSession` actions
- [ ] Badge com contagem na sidebar
- [ ] Testes: rendering, interações, empty state

---

### ✅ ETAPA 7 — Frontend: Dialog "Excluir permanentemente" (Purge)

**Arquivos a criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/PurgeTrashedSessionDialog.tsx` | **Criar** | Dialog confirmação exclusão definitiva |

**Checklist Etapa 7:**

- [ ] Criar `PurgeTrashedSessionDialog.tsx`:
  - [ ] Título: "Excluir permanentemente?"
  - [ ] Texto: **"Esta ação não pode ser desfeita."** A sessão e todo seu histórico serão apagados para sempre.
  - [ ] Checkbox obrigatório: "Entendo que esta ação é irreversível"
  - [ ] Botões: "Cancelar", "Excluir para sempre" (vermelho, disabled até checkbox marcado)
- [ ] Integrar na `TrashView` — botão "Excluir agora" abre este dialog
- [ ] Toast de sucesso: "Sessão excluída permanentemente"
- [ ] Testes

---

### ✅ ETAPA 8 — Persistência: Atualizar Workspace Registry / Storage

**Arquivos a verificar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/workspace/workspace/src/index.ts` | **Verificar** | Como `archivedSessionIds` e `pinnedSessionIds` são persistidos — adicionar `trashedSessionIds` |
| `packages/workspace/workspace/src/types.ts` | **Modificar** | Adicionar `trashedSessionIds` e `trashedAt` map no `WorkspaceSnapshot` |

**Checklist Etapa 8:**

- [ ] Adicionar `trashedSessionIds: Set<SessionId>` no `WorkspaceSnapshot`
- [ ] Adicionar `trashedAt: Map<SessionId, number>` (timestamp ms) no `WorkspaceSnapshot`
- [ ] Atualizar serialização/deserialização no storage do workspace
- [ ] Migration: workspaces existentes recebem sets/maps vazios
- [ ] Testes de persistência e migration

---

### ✅ ETAPA 9 — Tipos compartilhados (Typert) — Regenerar cliente

**Comandos:**

```bash
# Após modificar types.ts do workspace-controller
pnpm run build:artifacts
# Isso regenera os types TypeScript do cliente em packages/api/workspace-controller/lib/types/
```

**Checklist Etapa 9:**

- [ ] Executar `pnpm run build:artifacts` após mudanças nos types
- [ ] Verificar se types gerados em `lib/types/` estão corretos
- [ ] Atualizar imports no frontend se necessário

---

### ✅ ETAPA 10 — Testes E2E e Validação Completa

**Cenários a testar:**

| Cenário | Descrição |
|---------|-----------|
| Archive → Trash → Restore | Sessão ativa → arquivar → mover para lixeira → restaurar → volta ativa |
| Archive → Trash → Purge | Sessão ativa → arquivar → lixeira → excluir agora → sumiu do disco |
| Trash → Auto-purge (30d) | Simular tempo → job roda → sessão expirada some |
| Trash view UI | Abre sidebar → vê lixeira → lista itens → ações funcionam |
| Permissions | Usuário sem acesso não vê/opera lixeira |
| Empty states | Lixeira vazia, sessão não arquivada não mostra "Mover para lixeira" |

**Checklist Etapa 10:**

- [ ] Testes unitários backend (commands, controller)
- [ ] Testes unitários frontend (componentes, dialogs, store)
- [ ] Testes de integração (API completa)
- [ ] Testes E2E (DSH_SNAPSHOT=replay pnpm run test:web)
- [ ] Testar migração de workspace existente
- [ ] Verificar coverage: `pnpm run test:coverage`

---

## 📦 Mudanças de Tipos (TypeScript) — Resumo

### `packages/api/workspace-controller/src/types.ts`

```typescript
// NOVOS TIPOS
export interface WorkspaceTrashSessionRequest {
  readonly sessionId: SessionId;
}

export interface WorkspaceTrashSessionValue {
  readonly trashedSessionIds: readonly SessionId[];
}

export interface WorkspaceRestoreFromTrashRequest {
  readonly sessionId: SessionId;
}

export interface WorkspacePurgeTrashedSessionRequest {
  readonly sessionId: SessionId;
}

export interface WorkspacePurgeTrashedSessionValue {
  readonly purged: boolean;
}

// ESTENDER WorkspaceSnapshot
export interface WorkspaceSnapshot {
  // ... campos existentes
  readonly trashedSessionIds: readonly SessionId[];
  readonly trashedAt: Record<SessionId, number>; // timestamp ms
}
```

---

## 🔧 Configuração (Opcional — para PR futuro)

Adicionar no `Config` do `WorkspaceController`:

```typescript
export interface Config {
  // ... existentes
  /** Dias até exclusão automática da lixeira; padrão 30. 0 = desativado. */
  trashRetentionDays?: number;
}
```

---

## 🚀 Ordem Sugerida de PRs

| PR | Escopo | Por que separado |
|----|--------|------------------|
| **PR 1** | Backend: trash/restore/purge endpoints + workspace storage | Base da feature, testável isoladamente |
| **PR 2** | Backend: auto-purge schedule job | Dependência do PR 1, pode ser feature-flagged |
| **PR 3** | Frontend: context menu + confirm dialog + toasts | UI do fluxo principal |
| **PR 4** | Frontend: Trash View (sidebar) + purge dialog | UI complementar |
| **PR 5** | Testes E2E + docs + migration guide | Qualidade e documentação |

---

## ⚠️ Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Perda acidental de dados | Média | Alto | Confirmação em 2 etapas (trash → purge), toast "Desfazer", 30 dias de retenção |
| Job de auto-purge não roda | Baixa | Médio | Logs de auditoria, health check, config desabilitável |
| Migration de workspaces existentes falha | Baixa | Alto | Testes de migration, defaults vazios, rollback plan |
| Inconsistência workspace ↔ session persistence | Média | Alto | Transação lógica: purge chama `sessionPersistence.delete()` ANTES de remover do workspace index |

---

## 📝 Critérios de Aceitação (Definition of Done)

- [ ] Usuário pode: Arquivar → Mover para lixeira → Restaurar (volta arquivada)
- [ ] Usuário pode: Arquivar → Lixeira → Excluir agora → Sessão some do disco
- [ ] Lixeira aparece na sidebar com badge count
- [ ] Auto-purge roda diariamente e remove itens > 30 dias
- [ ] Toasts informativos com ações "Desfazer" funcionam
- [ ] Todos os testes passam (`test:coverage`, `test:gui`, `test:web` replay)
- [ ] Migration de workspace existente funciona
- [ ] Documentação atualizada (README, upgrade guide se breaking)

---

## 📌 Referências de Código Existente (para seguir padrões)

| Padrão | Arquivo de Referência |
|--------|----------------------|
| Archive/Unarchive row button | `packages/client/ui-workspace/src/client/session-actions/ArchiveSession.tsx` |
| Archive confirm dialog | `packages/client/ui-workspace/src/client/session-actions/ArchiveSession.tsx` (SessionArchiveConfirmDialog) |
| Context menu registration | `packages/client/ui-workspace/src/client/session-actions/context-menus.tsx` |
| Workspace feed baseline | `packages/api/workspace-controller/src/feed.ts` |
| Schedule service internal task | `packages/schedule/schedule/src/index.ts` (ver `deliveryHistoryDays`) |
| Session persistence delete | `packages/session/session-persistence-jsonl/src/index.ts` (método `delete`) |

---

*Documento gerado em 2026-11-02 — DeepSeek Harness vNext*