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

### ✅ ETAPA 1 — Backend: Novo endpoint `workspace/trashSession` e `workspace/restoreFromTrash` — **CONCLUÍDA**

**Arquivos a modificar/criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/api/workspace-controller/src/types.ts` | **Modificar** | Adicionar types: `WorkspaceTrashSessionRequest`, `WorkspaceTrashSessionValue`, `WorkspaceRestoreFromTrashRequest`, `WorkspaceTrashSessionEntry` |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Implementar `trashSession()` e `restoreFromTrash()` |
| `packages/api/workspace-controller/src/index.ts` | **Modificar** | Expor endpoints `@Remote('trashSession')` e `@Remote('restoreFromTrash')` |
| `packages/api/workspace-controller/src/feed.ts` | **Modificar** | Atualizar `WorkspaceFeed` para incluir `trashedSessionIds` no baseline/stream |

**Checklist Etapa 1:**

- [x] Adicionar tipos TypeScript para request/response de lixeira
- [x] Implementar `WorkspaceCommands.trashSession()` — move `sessionId` de `archivedSessionIds` → `trashedSessionIds` com timestamp `trashedAt`
- [x] Implementar `WorkspaceCommands.restoreFromTrash()` — move de volta para `archivedSessionIds` (ou sessão ativa)
- [x] Registrar endpoints `workspace/trashSession` e `workspace/restoreFromTrash` no `WorkspaceController`
- [x] Atualizar `WorkspaceFeed` para emitir `trashedSessionIds` no baseline e increments
- [x] Adicionar validação: só pode mandar para lixeira sessões **já arquivadas** (regra de negócio)
- [ ] Testes unitários: `workspace/trashSession` e `workspace/restoreFromTrash`
- [ ] Testes de integração: fluxo archive → trash → restore

---

### ✅ ETAPA 2 — Backend: Endpoint `workspace/purgeTrashedSession` (exclusão definitiva) — **CONCLUÍDA**

**Arquivos a modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/api/workspace-controller/src/types.ts` | **Modificar** | Adicionar `WorkspacePurgeTrashedSessionRequest`, `WorkspacePurgeTrashedSessionValue` |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Implementar `purgeTrashedSession()` — apaga arquivos da sessão do disco |
| `packages/api/workspace-controller/src/index.ts` | **Modificar** | Expor `@Remote('purgeTrashedSession')` |

**Checklist Etapa 2:**

- [x] Adicionar tipos para purge
- [x] Implementar `WorkspaceCommands.purgeTrashedSession()`:
  - [x] Remover `sessionId` de `trashedSessionIds`
  - [x] Chamar `sessionPersistence.delete(sessionId)` para apagar arquivos físicos (`.jsonl`, checkpoints, etc.)
  - [x] Emitir evento `api-session/removed` (já existe)
- [x] Registrar endpoint `workspace/purgeTrashedSession`
- [x] Validação: só pode purgar sessões que estão na lixeira (`trashedSessionIds`)
- [ ] Testes unitários e de integração

---

### ✅ ETAPA 3 — Backend: Job agendado de auto-purge (30 dias) — **CONCLUÍDA**

**Arquivos a modificar/criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/schedule/schedule/src/index.ts` | **Modificar** | Adicionar task interna de limpeza da lixeira (não exposta ao usuário) |
| `packages/api/workspace-controller/src/commands.ts` | **Modificar** | Exportar função `purgeExpiredTrash()` reaproveitável pelo job |
| `packages/schedule/schedule/src/runtime.ts` | **Modificar** | Adicionar `trashRetentionDays` ao `ScheduleRuntimeLimits` |

**Checklist Etapa 3:**

- [x] Criar função `WorkspaceCommands.purgeExpiredTrash(cutoffDate: Date)` que:
  - [x] Lista todas as sessões em `trashedSessionIds` com `trashedAt < cutoffDate`
  - [x] Para cada uma, chama `purgeTrashedSession()` internamente (restoreFromTrash + sessionPersistence.delete)
  - [x] Retorna contagem de sessões purgadas (`PurgeExpiredTrashResult`)
- [x] Registrar task agendada no `ScheduleService` (daily às 03:00 horário local) — **task interna, não visível ao usuário**
- [x] Configurar retenção padrão: 30 dias (configurável via `ScheduleService.Config.trashRetentionDays`, `0` = desativado)
- [ ] Testes: simular passagem de tempo, verificar auto-purge

---

### ✅ ETAPA 4 — Frontend: Menu de contexto — Adicionar "Mover para lixeira" — **CONCLUÍDA**

**Arquivos a modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/context-menus.tsx` | **Modificar** | Adicionar action `trash` (order 700, após archive) |
| `packages/client/ui-workspace/src/client/session-actions/TrashSession.tsx` | **Criar** | Componente do botão "Mover para lixeira" / "Restaurar da lixeira" |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar `TrashSessionInjected` ao tipo `Actions` |

**Checklist Etapa 4:**

- [x] Criar `TrashSession.tsx` seguindo padrão de `ArchiveSession.tsx`:
  - [x] Botão row: "Mover para lixeira" (ícone: trash) — só aparece se sessão **arquivada** E **não estiver na lixeira**
  - [x] Botão row: "Restaurar da lixeira" (ícone: restore) — só aparece se sessão **na lixeira**
  - [x] Tooltip com atalho (opcional)
- [x] Registrar action `trash` em `context-menus.tsx` (order 700, endpoints: `workspace/trashSession`, `workspace/restoreFromTrash`)
- [x] Adicionar `useTrashed` hook no `resolve` para verificar membership
- [x] Adicionar `TrashSessionInjected` em `slots.ts` e injetar no `registerSessionMenus`
- [ ] Testes: `session-actions.client.spec.tsx` — novos casos para trash/restore

---

### ✅ ETAPA 5 — Frontend: Dialog de confirmação "Mover para lixeira" — **CONCLUÍDA**

**Arquivos a criar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/TrashSessionConfirmDialog.tsx` | **Criar** | Dialog de confirmação (seguindo padrão `SessionArchiveConfirmDialog`) |
| `packages/client/ui-workspace/src/client/session-actions/context-menus.tsx` | **Modificar** | Integrar dialog no flow do trash |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar `TrashSessionConfirmInjected` |

**Checklist Etapa 5:**

- [x] Criar `TrashSessionConfirmDialog.tsx` (integrado no `TrashSession.tsx`):
  - [x] Título: "Mover para lixeira?"
  - [x] Texto: "A sessão será movida para a lixeira e excluída permanentemente após 30 dias. Essa ação pode ser desfeita a qualquer momento antes disso."
  - [x] Lista itens: nome da sessão, aviso de 30 dias
  - [x] Botões: "Cancelar", "Mover para lixeira" (destrutivo)
  - [x] Loading state durante chamada API
  - [x] Tratamento de erro (toast)
- [x] Integrar no `context-menus.tsx`: ao clicar "Mover para lixeira", abre dialog → confirma → chama `trashSession()`
- [x] Toast de sucesso: "Sessão movida para lixeira" com ação "Desfazer" (chama `restoreFromTrash`)
- [ ] Testes: dialog rendering, flow completo, error handling

---

### ✅ ETAPA 6 — Frontend: Sidebar — Filtro/View "Lixeira" (Trash Filter/View) — **CONCLUÍDA** (via store filter, sem TrashView.tsx dedicado)

**Arquivos a criar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/sidebar/TrashView.tsx` | **Criar** | View da lixeira (lista sessões trash) |
| `packages/client/ui-workspace/src/client/sidebar/Sidebar.tsx` | **Modificar** | Adicionar tab/item "Lixeira" na navegação |
| `packages/client/ui-workspace/src/client/stores.ts` | **Modificar** | Adicionar `trashedSessionIds` selector e actions `trashSession`, `restoreFromTrash`, `purgeTrashedSession` |
| `packages/client/ui-workspace/src/contract/slots.ts` | **Modificar** | Adicionar tipos para trash view |

**Checklist Etapa 6:**

- [x] Atualizar store (`createWorkspaceViewStore`) com:
  - [x] `trashedSessionIds` selector (do workspace feed via `TrashSessionInjected.hooks.trashed`)
  - [x] `trashSession`, `restoreFromTrash`, `purgeTrashedSession` actions (via `TrashSessionInjected` e `IWorkspaces`)
  - [x] `trashedFilter` + `setTrashedFilter` para filtrar view (default/only/show)
- [x] Badge com contagem na sidebar (via `trashedSessionIds.size`)
- [ ] Criar `TrashView.tsx` dedicado (opcional — filtrado via `trashedFilter: 'only'` na view atual)
  - [ ] Lista sessões em `trashedSessionIds` (ordenadas por `trashedAt` desc)
  - [ ] Cada row mostra: título, data original, data de expiração (trashedAt + 30d), ações: "Restaurar", "Excluir agora"
  - [ ] Empty state: "Lixeira vazia"
- [ ] Testes: rendering, interações, empty state

---

### ✅ ETAPA 7 — Frontend: Dialog "Excluir permanentemente" (Purge) — **CONCLUÍDA**

**Arquivos a criar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/client/ui-workspace/src/client/session-actions/PurgeTrashedSessionDialog.tsx` | **Criar** | Dialog confirmação exclusão definitiva |

**Checklist Etapa 7:**

- [x] Criar `PurgeTrashedSessionDialog.tsx` (integrado no `TrashSession.tsx` como `PurgeConfirmForm`):
  - [x] Título: "Excluir permanentemente?"
  - [x] Texto: **"Esta ação não pode ser desfeita."** A sessão e todo seu histórico serão apagados para sempre.
  - [x] Checkbox obrigatório: "Entendo que esta ação é irreversível" (implementado via confirm button disabled até usuário confirmar)
  - [x] Botões: "Cancelar", "Excluir para sempre" (vermelho, disabled até confirmação)
- [x] Integrar na row da lixeira — botão "Excluir agora" abre este dialog
- [x] Toast de sucesso: "Sessão excluída permanentemente"
- [ ] Testes

---

### ✅ ETAPA 8 — Persistência: Atualizar Workspace Registry / Storage

**Arquivos a verificar/modificar:**

| Arquivo | Ação | Descrição |
|---------|------|-----------|
| `packages/workspace/workspace/src/index.ts` | **Verificar** | Como `archivedSessionIds` e `pinnedSessionIds` são persistidos — adicionar `trashedSessionIds` |
| `packages/workspace/workspace/src/types.ts` | **Modificar** | Adicionar `trashedSessionIds` e `trashedAt` map no `WorkspaceSnapshot` |

**Checklist Etapa 8:**

- [x] Adicionar `trashedSessionIds: Set<SessionId>` no `WorkspaceSnapshot` / `WorkspaceBaseline` / `WorkspaceFollowIncrement`
- [x] Adicionar `trashedAt: Map<SessionId, number>` (timestamp ms) no `WorkspaceSnapshot` / `WorkspaceBaseline`
- [x] Atualizar serialização/deserialização no storage do workspace (`WorkspaceRegistry` state)
- [x] Migration: workspaces existentes recebem sets/maps vazios (compatível via `compatibleVersions: [2]`)
- [x] Adicionar `trashedSessionIds` e `trashedAt` no `WorkspaceRegistry` com getters/setters
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

- [x] Executar `pnpm run build:artifacts` após mudanças nos types
- [x] Verificar se types gerados em `lib/types/` estão corretos
- [x] Atualizar imports no frontend se necessário (client model regenerado automaticamente)

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

| PR | Escopo | Status | Por que separado |
|----|--------|--------|------------------|
| **PR 1** | Backend: trash/restore/purge endpoints + workspace storage | ✅ **CONCLUÍDO** | Base da feature, testável isoladamente |
| **PR 2** | Backend: auto-purge schedule job | ✅ **CONCLUÍDO** | Dependência do PR 1, implementado |
| **PR 3** | Frontend: context menu + confirm dialog + toasts | ✅ **CONCLUÍDO** | UI do fluxo principal |
| **PR 4** | Frontend: Trash View (sidebar) + purge dialog | ✅ **CONCLUÍDO** (via store filter) | UI complementar |
| **PR 5** | Testes E2E + docs + migration guide | ⏳ **PENDENTE** | Qualidade e documentação |

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

- [x] Usuário pode: Arquivar → Mover para lixeira → Restaurar (volta arquivada)
- [x] Usuário pode: Arquivar → Lixeira → Excluir agora → Sessão some do disco
- [x] Lixeira aparece na sidebar com badge count (via filtro `trashedFilter`)
- [x] Auto-purge roda diariamente e remove itens > 30 dias
- [x] Toasts informativos com ações "Desfazer" funcionam
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