/**
 * ConfirmBar —— 危险动作的「问一句再执行」
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（2026-11-23 阿开原话）
 * ══════════════════════════════════════════════════════════════════
 *
 *   「点击就直接执行了，建议点击弹一个或者切换一个确认？取消？
 *     避免用户好奇想看看会怎么样就直接换掉了。」
 *
 * ★ 问题不是「用户会误点」，是「好奇心的代价太大」——
 *   换发新 Key 是会当场作废旧凭据的不可逆动作，
 *   而它长得跟「看看」一样（一个普通按钮）。
 *
 * ★★ 为什么不用浏览器原生 `confirm()`
 *   ① 手机上是宿主的灰弹窗，和我们这套界面割裂
 *   ② 只有一行字，放不下「旧的会作废」这种后果说明
 *   ③ 会被顺手点掉（用户对弹窗有肌肉记忆）
 *   ⇒ 用**页面内联确认**：后果文字就摆在按钮边上，点取消不花任何代价。
 *
 * ★★★ 确认条的文案必须写「后果」，不能写「确定吗」
 *   「确定要换发吗？」= 没信息量，用户只会点确定。
 *   「换发后，当前这把当场作废，正在用它的地方会立刻断开」= 有信息量。
 */

import type { ReactNode } from 'react'
import { T } from '../styles/tokens'

export interface ConfirmBarProps {
  /** 一句话说清「这一步会造成什么后果」，不是「确定吗」 */
  consequence: ReactNode
  /** 确认按钮文案，用动词：换发 / 续期 / 清除 */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** 正在执行时锁住按钮，防连点 */
  busy?: boolean
  /** 危险等级：danger=红（作废类不可逆）；normal=蓝（续期这类可补救） */
  tone?: 'danger' | 'normal'
}

export function ConfirmBar({
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  tone = 'danger',
}: ConfirmBarProps) {
  const accent = tone === 'danger' ? '#b91c1c' : T.accent
  const accentBg = tone === 'danger' ? '#fef2f2' : T.surfaceSoft
  const accentBorder = tone === 'danger' ? '#fecaca' : T.border

  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 12.5,
      }}
      // 让屏幕阅读器知道这是个需要回答的提示
      role="alertdialog"
      aria-live="polite"
    >
      <div style={{ flex: 1, minWidth: 180, color: T.text, lineHeight: 1.6 }}>{consequence}</div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            color: T.dim,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            background: busy ? T.surfaceSoft : accent,
            border: 'none',
            borderRadius: 5,
            color: busy ? T.faint : '#fff',
            cursor: busy ? 'default' : 'pointer',
            fontWeight: 500,
          }}
        >
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </div>
  )
}
