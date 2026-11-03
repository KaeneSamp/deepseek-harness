/** Trash hover button and confirmation for moving archived Session to trash. */
import { useState } from 'react'
import type { SessionActivity } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-jobs/view'
import type {} from '@deepseek-ai/dsh-schedule/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import {
  Button, IconTrashOutlineRegular, IconArchiveOutlineRegular, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  TrashSessionInjected, SessionTrashConfirmInjected, SessionTrashConfirmProps, SessionTrashConfirmRequest,
  SessionRowActionProps,
} from '../contract/slots.ts'
import css from '../rows/Rows.module.css'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Hover button (order 110): trash an archived session, or restore a trashed row.
 * Absent while the Session's access snapshot excludes that toggle.
 * @param props - owner share, the access Hook, and the trash share.
 * @returns the button, or nothing when the caller may not toggle this Session's trash state.
 */
export function TrashSessionRowButton({
  sessionId, useTrashed, useSessionAccess, trashSession, restoreFromTrash, t,
}: SessionRowActionProps<TrashSessionInjected>) {
  const trashed = useTrashed(set => set.has(sessionId))
  const allowed = useSessionAccess(sessionId, trashed ? 'workspace/restoreFromTrash' : 'workspace/trashSession')
  if (!allowed) return null
  return (
    <Tooltip label={t(trashed ? 'actions.restoreFromTrash' : 'actions.trash')} side="bottom" align="end" delayMs={500} portal>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t(trashed ? 'menu.restoreFromTrash' : 'menu.trashSession')}
        onClick={() => { (trashed ? restoreFromTrash : trashSession)(sessionId) }}
      >
        {trashed ? <IconArchiveOutlineRegular size={14} /> : <IconTrashOutlineRegular size={14} />}
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming asks
 * the Host to move the session to trash; cancelling leaves the Session in archive.
 * @param props - the request hook, its settlement, the trash hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionTrashConfirmDialog({
  useTrashRequest, settleSessionTrash, trashSession, t,
}: SessionTrashConfirmProps) {
  const request = useTrashRequest((pending: SessionTrashConfirmRequest | null) => pending)
  if (request === null) return null
  return (
    <TrashConfirmForm
      key={request.sessionId}
      request={request}
      trashSession={trashSession}
      onSettle={settleSessionTrash}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function TrashConfirmForm({ request, trashSession, onSettle, t }: {
  request: SessionTrashConfirmRequest
  trashSession: SessionTrashConfirmInjected['trashSession']
  onSettle: () => void
  t: SessionTrashConfirmProps['t']
}) {
  const [trashing, setTrashing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (trashing) return
    onSettle()
  }
  const confirm = () => {
    setTrashing(true)
    setError(null)
    trashSession(request.sessionId).then(() => {
      setTrashing(false)
      onSettle()
    }).catch((reason: unknown) => {
      setTrashing(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('trash.confirm.title')}
      description={t('trash.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={trashing} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={trashing}
            onClick={confirm}
          >
            {t('trash.confirm.action')}
          </Button>
        </>
      )}
    >
      <ul className={browserCss.archiveActivity} aria-label={t('trash.confirm.activity')}>
        {request.activity.map((entry, index) => (
          <li key={`${entry.kind}-${String(index)}`}>{activityLine(entry, t)}</li>
        ))}
      </ul>
      {trashing && <div className={browserCss.deleteStatus} role="status">{t('trash.confirm.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}

/**
 * One family's line: its count and the items' labels (ids when a family
 * carries no label). A family this dictionary does not know — a provider
 * merged into the kind map — falls through to the generic line.
 */
function activityLine(entry: SessionActivity, t: SessionTrashConfirmProps['t']): string {
  const items = entry.items ?? []
  const n = items.length
  const names = items.map(item => item.label ?? item.id).join(t('archive.confirm.listSeparator'))
  const plural = n === 1 ? 'one' : 'other'
  switch (entry.kind) {
    case 'turn': return t('archive.confirm.turn')
    case 'subagent': return t(`archive.confirm.subagents.${plural}`, { n, names })
    case 'job': return t(`archive.confirm.jobs.${plural}`, { n, names })
    case 'schedule': return t(`archive.confirm.schedules.${plural}`, { n, names })
    default: return t(`archive.confirm.other.${plural}`, { kind: entry.kind, n })
  }
}

/** Purge hover button (order 120): permanently delete a trashed session. */
export function PurgeSessionRowButton({
  sessionId, useTrashed, useSessionAccess, purgeTrashedSession, t,
}: SessionRowActionProps<TrashSessionInjected>) {
  const trashed = useTrashed(set => set.has(sessionId))
  if (!trashed) return null
  const allowed = useSessionAccess(sessionId, 'workspace/purgeTrashedSession')
  if (!allowed) return null
  return (
    <Tooltip label={t('actions.purge')} side="bottom" align="end" delayMs={500} portal>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('menu.purgeSession')}
        onClick={() => purgeTrashedSession(sessionId)}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry for purge confirmation.
 * @param props - the request hook, its settlement, the purge hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionPurgeConfirmDialog({
  usePurgeRequest, settleSessionPurge, purgeTrashedSession, t,
}: SessionTrashConfirmProps) {
  const request = usePurgeRequest((pending: SessionTrashConfirmRequest | null) => pending)
  if (request === null) return null
  return (
    <PurgeConfirmForm
      key={request.sessionId}
      request={request}
      purgeTrashedSession={purgeTrashedSession}
      onSettle={settleSessionPurge}
      t={t}
    />
  )
}

/** One purge request's dialog. */
function PurgeConfirmForm({ request, purgeTrashedSession, onSettle, t }: {
  request: SessionTrashConfirmRequest
  purgeTrashedSession: SessionTrashConfirmInjected['purgeTrashedSession']
  onSettle: () => void
  t: SessionTrashConfirmProps['t']
}) {
  const [purging, setPurging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (purging) return
    onSettle()
  }
  const confirm = () => {
    setPurging(true)
    setError(null)
    purgeTrashedSession(request.sessionId).then(() => {
      setPurging(false)
      onSettle()
    }).catch((reason: unknown) => {
      setPurging(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('purge.confirm.title')}
      description={t('purge.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={purging} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={purging}
            onClick={confirm}
          >
            {t('purge.confirm.action')}
          </Button>
        </>
      )}
    >
      <div className={browserCss.deleteStatus} role="alert">{t('purge.confirm.warning')}</div>
      {purging && <div className={browserCss.deleteStatus} role="status">{t('purge.confirm.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
