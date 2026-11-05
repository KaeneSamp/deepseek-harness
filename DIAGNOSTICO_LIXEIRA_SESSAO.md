# Diagnóstico — Lixeira inteligente de sessões

Referência do plano: [PLANO_IMPLEMENTACAO_EXCLUSAO_SESSAO.md](PLANO_IMPLEMENTACAO_EXCLUSAO_SESSAO.md)
Escopo: diagnóstico apenas; nenhuma correção foi aplicada.
Comandos executados: `pnpm run typecheck`, `pnpm vitest run packages/api/workspace-controller packages/workspace/workspace packages/schedule/schedule`, `pnpm vitest run packages/client/ui-workspace`, leitura das rotas do fluxo Client → Host → Registry → Schedule.

## Resumo executivo

A feature está funcional no fluxo principal (arquivar → lixeira → restaurar funciona e o cliente consome o frame `trashed` corretamente), mas o diagnóstico encontrou **3 defeitos de runtime (P0)**, **quebra de gates de compilação (P1, 57 erros de typecheck, todos em fixtures de teste)**, **deriva de testes (P2, 22 falhas host + 4 client)**, **lacunas de UI (P3)** e **pendências do próprio plano (P4)**. O sintoma de "instabilidade" nos últimos testes corresponde majoritariamente ao P0-3 (controller quebra sem o serviço `schedule`) e ao P0-1/P0-2 (purge deixa id fantasma arquivado; timer de purge rearma para sempre após dispose).

## P0 — Defeitos de runtime

### P0-1 Purge rearquiva a sessão (id fantasma em `archivedSessionIds`)

- `packages/api/workspace-controller/src/commands.ts:260` (`purgeTrashedSession`) e `commands.ts:298` (`purgeExpiredTrash`) removem da lixeira chamando `workspaceRegistry.restoreFromTrash(sessionId)`.
- `restoreFromTrash` em `packages/workspace/workspace/src/index.ts:540` faz `archivedSessionIds: [sessionId, ...state.archivedSessionIds]` — ou seja, **recoloca o id no conjunto arquivado** enquanto `sessionPersistence.delete(sessionId)` apaga os dados persistidos logo em seguida.
- Resultado: após qualquer purge (manual ou automático), o id fica pendurado em `archivedSessionIds` apontando para dados inexistentes; nada o remove (`deleteKnown` é interno ao workspace e não toca o índice). O feed emite os incrementos `archived` + `trashed`, então os clientes também recriam o id fantasma no conjunto arquivado. A tabela de riscos do próprio plano sinaliza essa ordem de transação.
- Os `catch` vazios em `commands.ts:262-267` e `:300-304` Engolam a falha de `delete` com comentário, mas o comentário afirma "registry está limpo", o que é falso por causa do P0-1.

### P0-2 Timer de auto-purge vaza e rearma após dispose

- `packages/schedule/schedule/src/index.ts:303-309` (cleanup): define `this.stopping = true`, descarta runtime e fecha o domínio, **mas nunca faz `clearTimeout(this.trashPurgeTimer)`**.
- Callback do timer em `:394-408`: ao disparar, chama o callback e **chama `scheduleNext()` incondicionalmente em `:407`**, sem verificar `this.stopping` e sem `unref()` — o timer rearma para sempre e dispara numa registry já descartada (dispose/HMR).
- `registerTrashPurgeCallback` (`:369-375`) não tem disposer: se o `workspace-controller` for desmontado (HMR), o callback continua apontando para um controller descartado.

### P0-3 Controller quebra no construtor sem o serviço `schedule`

- `packages/api/workspace-controller/src/index.ts:90` chama `ctx.schedule.registerTrashPurgeCallback(...)` direto no construtor, com `static inject = [..., 'schedule']` (`:66`).
- Resultado concreto: os **15 testes de `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` falham** com `TypeError: Cannot read properties of undefined (reading 'registerTrashPurgeCallback')` porque o harness de teste monta um ctx sem `schedule`. Qualquer perfil que monte `workspace-controller` sem `schedule` fica PENDING ou quebra da mesma forma. Viola a convenção "registrations are effects" e a regra de serviço opcional via `ctx.get(name)`.
- Nota de topologia: no bundle `web-app` (`packages/bundle/web-app/cordis.patch.yml:150-151` e `:135-136`) ambos os plugins embarcam, então em produção o inject resolve — o problema é o padrão frágil + a suite vermelha.

## P1 — Quebra de gates de compilação (57 erros, todos em fixtures de teste)

Gates "Host Typert", "host compiler" e "client compiler" pasan; **"host aggregate check" e "client aggregate check" falham** (`tsc -b` sobre os testes). Nenhuma augmentation conflitante (`TS2717`) entre as duas declarações de `Context.schedule` foi encontrada — ver P3-5.

1. **12× `trashRetentionDays` ausente em `ScheduleRuntimeLimits`** nos testes de `packages/schedule/schedule/tests/` (`execution.spec.ts` ×6, `runtime.spec.ts` ×4, `targets.spec.ts`, `target-recovery.spec.ts`, `delivery.spec.ts`) — `ScheduleRuntimeLimits` (`packages/schedule/schedule/src/runtime.ts:40`) passou a exigir o campo.
2. **6× `TS2515` — fakes de `SessionPersistence` sem `delete`**: `packages/feedback/message-feedback/tests/helpers.ts`, `packages/session-query/session-query/tests/{session-query,tracing,observation}.spec.ts`, `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts`, `packages/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts` (`delete` é abstrato desde `packages/session/session-persistence/src/index.ts:225`; a impl real está em `session-persistence-jsonl/src/index.ts:574`).
3. **~20 literals de `WorkspaceSnapshot`/baseline sem `trashedSessionIds`** (campo obrigatório novo): `packages/client/ui-chat/tests`, `ui-conversation/tests` ×6, `ui-layout`, `ui-schedule/tests` ×4, `ui-sidebar-browser`, `ui-theme/tests` ×4, `ui-trajectory`, `ui-user-questions/tests` ×2, `ui-workspace/tests` ×4, `packages/client/locale/tests/language-row.client.spec.tsx`, além de `packages/api/workspace-controller/tests/{model.client,transport.client}.spec.ts` e `tests/remote/workspace.client.ts:72` (baselines sem `trashedSessionIds`; sink sem `replaceTrashed`).
4. **Fakes de remoto/serviço incompletos**: `FakeWorkspaceRemote` em `model.client.spec.ts:71` sem `trashSession`/`restoreFromTrash`/`purgeTrashedSession` (TS2420/TS2345); `FakeWorkspaces` em `ui-workspace/tests/workspaces-service.client.spec.ts` sem os 3 métodos novos de `IWorkspaces` (`client/service.ts`); mock de `session-menu-actions.client.spec.ts` sem os membros de `TrashSessionInjected`.

## P2 — Deriva de testes em runtime (26 falhas)

Host (`workspace-controller` + `workspace` + `schedule`): **22 falhas em 3 arquivos**.

- `workspace-controller.host.spec.ts` — 15 falhas, todas pelo P0-3 (TypeError no construtor, via harness do spec `:74`).
- `workspace.spec.ts` — 5 falhas: literais `toEqual` de estado armazenado agora recebem `trashedSessionIds: []` / `trashedAt: {}` extras (ex.: "commits deletion and leaves a recoverable marker…", "recovers only an explicitly marked interrupted create or delete" também mostra diff de `pendingMutation: undefined`, "bootstraps once from list headers only…", "does not rerun bootstrap…", "deletes only the registration…", "stays pending without sessionPersistence…").
- `schedule/tests/delete-inactive.spec.ts` — "clears a large ended set in one batch…" estoura o timeout de 5000 ms (rodou 6019 ms). O timer de purge não é disparado nesse spec (sem callback registrado), então a causa provável é o próprio teste de lote pesados; precisa de timeout maior com justificativa ou perfil.

Client (`ui-workspace`): **4 falhas em 2 arquivos**.

- `apply.client.spec.ts` ×3 — contagens de slot `ROW_ACTION`: esperava 2, recebeu 4; a lista agora inclui `["trash", 110, TrashSessionRowButton]` depois de `["archive", 100, …]` (`:309`, `:915`).
- `session-menu-actions.client.spec.ts` ×1 — esperava último item do menu `Unarchive session`, recebeu `Move to trash` (`:68`).

## P3 — Lacunas de UI / consistência

1. **`trashedFilter` é código morto**: o campo existe em `packages/client/ui-workspace/src/client/stores.ts:31-32` (+ setter `:131`, persist key `dsh.workspace.view.v5`), mas **nenhum componente lê** (grep: só `stores.ts` e a chave de toast `toast.trashedFilter` em `locales.ts`). A visibilidade de linhas usa só `archivedFilter`: `sessionVisible` em `packages/client/ui-workspace/src/client/tree.ts:229-248` não conhece lixeira — linhas na lixeira (que saíram de `archivedSessionIds`) continuam visíveis como linhas normais, com badge e botões de restaurar/purgar na linha (`session-actions/TrashSession.tsx`, ordens 110/120). Decidir: implementar o filtro de lixeira na sidebar ou remover o campo morto.
2. **Purge não está no menu de contexto**: `session-actions/context-menus.tsx:72` observa o acesso `workspace/purgeTrashedSession`, mas **não renderiza item de purge** — purge só via botão de hover na linha. O plano (etapa 5) previa entrada no menu com diálogo `SessionTrashConfirm` (`contract/slots.ts:478-484` já declarado).
3. **`stopActivity` inconsistente**: `client/model.ts:277-284` envia `{ sessionId, stopActivity: true }` em `trashSession`, mas `WorkspaceTrashSessionRequest` (`packages/api/workspace-controller/src/types.ts:133-135`) não tem o campo (o spread contorna o excess-property check; o schema strippa; o host ignora). Como trash exige arquivado, o campo é inútil aqui — remover do envio ou adicionar ao contrato.
4. **Catches vazios nomeados apenas em comentário** nos dois caminhos de purge — após corrigir P0-1, logar a falha com `ctx.logger` em vez de engolir silenciosamente.
5. **Duas augmentations de `Context.schedule`**: `packages/schedule/schedule/src/index.ts:75` declara `schedule: ScheduleService`; `packages/api/workspace-controller/src/index.ts:57-61` declara uma interface estrutural mínima. Compilou sem `TS2717` nesta rodada, mas é uma bomba futura — consolidar numa declaração canônica.

## P4 — Pendências do próprio plano

- Testes unitários de trash/restaurar/purge e teste de integração arquivar → lixeira → restaurar → purge (ainda não marcados no plano).
- README dos pacotes (`workspace-controller`, `workspace`, `schedule`) e **entrada no upgrade guide** (`docs/upgrade-guide/`, hoje sem nenhum registro de lixeira): novo domínio persistido `workspaceDomainState` v3, novos endpoints remotos e nova config `schedule.trashRetentionDays` (padrão 30, 0 desativa) são perceptíveis externamente.
- Cobertura: `pnpm run test:coverage` exige 100% por arquivo em `packages/*/*/src` — os novos caminhos de trash e o timer precisam de testes.

## Pontos sadios confirmados

- Domínio v3 com `compatibleVersions: [2]` e defaults zod nos campos novos (`packages/workspace/workspace/src/spec.ts:67-68,81-88`) — linhas v2 antigas parseiam inalteradas.
- i18n completo nas 8 localidades (chaves `actions.trash`, `purge.confirm.*`, `toast.trashed`, `row.trashed`, `toast.trashedFilter`).
- Consumo do frame `trashed` no cliente correto, com `assertNever` (`packages/api/workspace-controller/src/client/index.ts:119-124`).
- Fila FIFO serializa purge com os demais comandos (`commands.ts:349-353`); comparação de corte por ISO léxico está correta para UTC.

## Rota de correções (prioridade)

1. **P0-1**: adicionar `WorkspaceRegistry.removeTrashedSession(sessionId)` (remove de `trashedSessionIds`/`trashedAt` **sem** tocar `archivedSessionIds`) e usar nos dois caminhos de purge; extrair um helper privado `purgeOne(sessionId)`; logar falhas de `delete` via logger.
2. **P0-2**: `clearTimeout` no cleanup do schedule; checar `this.stopping` no callback antes de executar e antes de `scheduleNext()`; `unref()` no timer; disposer para `registerTrashPurgeCallback`.
3. **P0-3**: mover o registro do callback do construtor para `ctx.effect()` com `ctx.get('schedule')` opcional (remover `'schedule'` do `inject` estático), logando quando ausente — corrige os 15 testes host e o padrão frágil.
4. **P1**: fixtures — `trashRetentionDays` nos 12 literais de limites do schedule (de preferência um helper `testLimits()` único); `delete()` nos 6 fakes de `SessionPersistence`; `trashedSessionIds: []` nos ~20 snapshots/baselines (de preferência uma fábrica compartilhada de baseline); 3 métodos nos fakes de remoto/serviço; `replaceTrashed` no sink de transporte; `TrashSessionInjected` no mock de menu.
5. **P2**: atualizar literais de estado em `workspace.spec.ts`; contagens/ordem de `ROW_ACTION` em `apply.client.spec.ts`; ordem do menu em `session-menu-actions.client.spec.ts`; timeout/perf do teste de lote em `delete-inactive.spec.ts`.
6. **P3**: decidir e ligar o filtro de lixeira (ou remover `trashedFilter` morto); item de purge no menu de contexto com `SessionTrashConfirm`; alinhar `stopActivity` no contrato de trash; consolidar a declaração de `Context.schedule`.
7. **P4**: testes unitários + integração arquivar→lixeira→restaurar→purge; README + entrada no upgrade guide; manter 100% de cobertura nos arquivos novos.

## Validação após as correções

`pnpm run typecheck` (5 gates), `pnpm vitest run packages/api/workspace-controller packages/workspace/workspace packages/schedule/schedule`, `pnpm vitest run packages/client/ui-workspace` (ou `pnpm run test:gui`), e `pnpm run test:coverage` nos pacotes tocados.
