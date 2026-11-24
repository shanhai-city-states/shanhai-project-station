/**
 * AgentLifecycleDialogs —— 改名 / 停用 / 归档确认（2026-11-24）
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 古茶三道闸（阿开四问之第 3 条定案）：
 *
 *   闸一：**归档二次确认，说清后果**。他给的原话：
 *     ❌「确认归档？」
 *     ✅「归档后，这个 Agent 将永久封存，无法恢复。
 *        它的历史记录会保留，但不能再派活、不能再进项目。
 *        确认归档？」
 *     ⇒ 本文件 `ArchiveConfirm` **逐字照用**，不改写。
 *
 *   闸二：**归档前强制「无未结任务」**，且被拒要**显示「还有 N 个」**。
 *     ⇒ 由 `ArchiveBlocked` 承担：把后端 `openTasks` 逐条列出来。
 *        古茶原话：「只报『不能归档』不告诉原因，用户会反复试。」
 *
 *   闸三：归档后沉入「归档」区（在 AgentsPage 做分区，不在本文件）。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 停用不弹二次确认 —— 只有归档弹。
 *   为什么：停用**可恢复**，误点的代价是「再点一次恢复」；
 *   归档**不可恢复**，误点的代价是「雇一个新人 + 历史断档」。
 *   ⇒ 确认框的数量要和「不可逆程度」成正比，否则用户会练成「闭眼点确认」，
 *     等到真正危险那一张也不再看了。**确认框泛滥 = 没有确认框。**
 */
import { useEffect, useState } from 'react'
import { T, VERDICT_TONE } from '../styles/tokens'

const NAME_MAX = 30

/** 通用遮罩 + 卡片 */
function Dialog({
  title, children, onClose, danger = false,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  danger?: boolean
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(16,24,40,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      // 点遮罩关闭；卡片内部点一下不该关（stopPropagation）
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 440,
          background: T.surface,
          border: `1px solid ${danger ? VERDICT_TONE.fail.fg : T.border}`,
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 12px 40px rgba(16,24,40,0.18)',
        }}
      >
        <div style={{
          fontSize: 14.5, fontWeight: 600, marginBottom: 12,
          color: danger ? VERDICT_TONE.fail.fg : T.text,
        }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const btn = (kind: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 16px',
  fontSize: 13,
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  ...(kind === 'primary'
    ? { color: '#fff', background: T.accent, border: `1px solid ${T.accent}` }
    : kind === 'danger'
      ? { color: '#fff', background: VERDICT_TONE.fail.fg, border: `1px solid ${VERDICT_TONE.fail.fg}` }
      : { color: T.dim, background: 'transparent', border: `1px solid ${T.border}` }),
})

// ══════════════════════════════════════════════════════════════════
// ① 改名
// ══════════════════════════════════════════════════════════════════

export function RenameDialog({
  currentName, idTail, busy, error, onSubmit, onClose,
}: {
  currentName: string
  /** 工牌尾号 —— 让用户看见「号不变」，改名只是换标签 */
  idTail: string
  busy: boolean
  error: string | null
  onSubmit: (next: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(currentName)

  const trimmed = value.trim()
  const tooLong = [...trimmed].length > NAME_MAX
  const empty = trimmed === ''
  const unchanged = trimmed === currentName
  const canSubmit = !busy && !tooLong && !empty && !unchanged

  return (
    <Dialog title="改名字" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.75, marginBottom: 12 }}>
        名字只是标签，<b>工牌号不会变</b>
        （`…{idTail}`），项目履历也不受影响。
        <br />
        允许和别的 Agent 重名 —— 列表里会用尾号区分。
      </div>

      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onSubmit(trimmed) }}
        maxLength={NAME_MAX + 10}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '8px 10px', fontSize: 13,
          border: `1px solid ${tooLong ? VERDICT_TONE.fail.fg : T.border}`,
          borderRadius: 6, outline: 'none', fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5 }}>
        <span style={{ color: tooLong ? VERDICT_TONE.fail.fg : T.faint }}>
          {tooLong ? `最多 ${NAME_MAX} 个字（现在 ${[...trimmed].length} 个）` : `最多 ${NAME_MAX} 个字`}
        </span>
        <span style={{ color: T.faint }}>{[...trimmed].length} / {NAME_MAX}</span>
      </div>

      {error !== null && (
        <div style={{ marginTop: 10, fontSize: 12, color: VERDICT_TONE.fail.fg, lineHeight: 1.7 }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button style={btn('ghost')} onClick={onClose} disabled={busy}>取消</button>
        <button
          style={{ ...btn('primary'), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          disabled={!canSubmit}
          onClick={() => onSubmit(trimmed)}
        >{busy ? '正在改…' : '改好'}</button>
      </div>
    </Dialog>
  )
}

// ══════════════════════════════════════════════════════════════════
// ② 归档确认（闸一 · 逐字照用古茶原文）
// ══════════════════════════════════════════════════════════════════

export function ArchiveConfirm({
  name, projectNames, busy, onConfirm, onClose,
}: {
  name: string
  /** 它当前参与的项目 —— 让「不能再进项目」这句话落到具体项目上 */
  projectNames: string[]
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog title={`归档「${name}」`} onClose={onClose} danger>
      {/* ★★★ 古茶原话，逐字不改 —— 他明确否掉了「确认归档？」这种轻飘说法 */}
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.85 }}>
        归档后，这个 Agent 将<b>永久封存，无法恢复</b>。
        <br />
        它的历史记录会保留，但不能再派活、不能再进项目。
      </div>

      {projectNames.length > 0 && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6,
          fontSize: 12, color: T.dim, lineHeight: 1.8,
        }}>
          它当前在 {projectNames.length} 个项目里：
          <b>{projectNames.join('、')}</b>
          <br />
          归档后这些项目里不会再看到它。
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: T.faint, lineHeight: 1.75 }}>
        想让它以后还能回来，请用「停用（离职）」而不是归档 —— 停用可以恢复。
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button style={btn('ghost')} onClick={onClose} disabled={busy}>取消</button>
        <button style={btn('danger')} onClick={onConfirm} disabled={busy}>
          {busy ? '正在归档…' : '确认归档，不可恢复'}
        </button>
      </div>
    </Dialog>
  )
}

// ══════════════════════════════════════════════════════════════════
// ③ 归档被拒 —— 闸二：显示「还有 N 个未结任务」且逐条列出
// ══════════════════════════════════════════════════════════════════

export interface OpenTask {
  taskId: string
  title: string
  status: string
}

/** 任务状态 → 人话（★ 与后端 OPEN_TASK_STATUSES 对齐，别自己编词） */
const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '待认领',
  running: '进行中',
  blocked: '卡住',
  rejected: '被退回',
}

export function ArchiveBlocked({
  name, tasks, onClose,
}: {
  name: string
  tasks: OpenTask[]
  onClose: () => void
}) {
  return (
    <Dialog title={`「${name}」现在不能归档`} onClose={onClose} danger>
      {/* ★ 古茶要求：必须说「还有 N 个」，不能只说「不能归档」 */}
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.85 }}>
        它手上还有 <b>{tasks.length}</b> 件没干完的活。
        <br />
        归档不可恢复，留下没人能接的任务会成死结。
      </div>

      <div style={{
        marginTop: 12, maxHeight: 200, overflowY: 'auto',
        border: `1px solid ${T.border}`, borderRadius: 6,
      }}>
        {tasks.map((t, i) => (
          <div
            key={t.taskId}
            style={{
              padding: '9px 12px',
              borderTop: i === 0 ? 'none' : `1px solid ${T.border}`,
              fontSize: 12.5, lineHeight: 1.6,
              display: 'flex', gap: 8, alignItems: 'baseline',
            }}
          >
            <span style={{
              flexShrink: 0, fontSize: 10.5, padding: '1px 6px', borderRadius: 4,
              background: T.bg, color: T.dim, border: `1px solid ${T.border}`,
            }}>{TASK_STATUS_LABEL[t.status] ?? t.status}</span>
            <span style={{ minWidth: 0, color: T.text }}>{t.title}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: T.dim, lineHeight: 1.8 }}>
        下一步：把这些活干完，或者到项目里改派给别人，再回来归档。
        <br />
        也可以先用「<b>停用（离职）</b>」—— 停用不要求清空任务，且可以恢复。
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button style={btn('primary')} onClick={onClose}>知道了</button>
      </div>
    </Dialog>
  )
}
