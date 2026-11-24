/**
 * 项目名输入表单 —— 新建项目 / 改项目名共用。
 *
 * ★ 为什么单独成件：项目列表页（新建）和项目详情页（改名）两处用同一形态。
 *   各写一遍必然样式漂移（本仓记过：「同一语义 ≥2 处实现必漂移」）。
 *
 * ★ 按钮样式遵守阿开 2026-11-24 定的口径：
 *   主操作实心、次操作浅灰细边（`1px solid #e7e8ed` + 透明底 + 灰字 `#4b5563`）、
 *   常规字重。不要黑边框、不要刺眼。
 */

import { T } from '../styles/tokens'

export function ProjectNameForm(props: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
  error: string | null
  submitLabel: string
  placeholder?: string
  autoFocus?: boolean
}): React.JSX.Element {
  const canSubmit = props.value.trim() !== '' && !props.busy
  return (
    <div
      style={{
        padding: '14px 16px',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 8 }}>
        给项目起个名字（比如「橙子之家小程序」）。编号 P-00x 由系统分配，不用填。
      </div>
      <input
        value={props.value}
        autoFocus={props.autoFocus ?? true}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (canSubmit) props.onSubmit()
          }
          if (e.key === 'Escape') props.onCancel()
        }}
        placeholder={props.placeholder ?? '项目名称'}
        maxLength={80}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          fontSize: 13,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          background: T.bg,
          color: T.text,
          outline: 'none',
          marginBottom: 10,
        }}
      />
      {props.error !== null && (
        <div style={{ fontSize: 12, color: '#a32626', marginBottom: 10 }}>{props.error}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={props.onSubmit}
          disabled={!canSubmit}
          style={{
            padding: '7px 18px',
            fontSize: 13,
            border: 'none',
            borderRadius: 6,
            background: canSubmit ? T.accent : T.surfaceSoft,
            color: canSubmit ? '#fff' : T.faint,
            cursor: canSubmit ? 'pointer' : 'default',
            fontWeight: 500,
          }}
        >
          {props.busy ? '处理中…' : props.submitLabel}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.busy}
          style={{
            padding: '7px 18px',
            fontSize: 13,
            border: '1px solid #e7e8ed',
            borderRadius: 6,
            background: 'transparent',
            color: '#4b5563',
            cursor: props.busy ? 'default' : 'pointer',
            fontWeight: 400,
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}

