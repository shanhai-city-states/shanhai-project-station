/**
 * StatusBar —— 4 段任务状态条（P2/P3 共用）
 * =====================================================================
 * 设计依据：小砚《097 UI 设计说明 V1.0》§三 原则2
 *
 * ★★★ 为什么是「4 段 + 终态显形」，不是 5 个并列点
 *   设计稿原话：
 *     「5 个并列会让人以为一条任务要**同时经过**『已通过』和『已打回』两个终态。
 *       4 段 + 终态显形，语义是『要么这样、要么那样』，一眼就对。」
 *
 *   ⇒ 第 4 段不是「已通过」这个点，而是**一个位置**，它显示成绿（通过）还是红（打回），
 *     取决于任务的真实终态。**没有终态时它是灰的空心圈。**
 *
 * ★★ 7 个 DB 状态 → 4 段位置的映射（本文件唯一一处，别在别处再写一遍）
 *     pending / dispatched → 段0「待认领」
 *     running              → 段1「进行中」
 *     delivered            → 段2「待验收」
 *     accepted / rejected  → 段3「终态」（绿/红显形）
 *     cancelled            → 特殊：整条置灰，不显示进度（任务不存在了）
 *
 * ★ 三重编码（设计稿原则3）：位置 + 颜色 + 文字。
 *   红绿色盲看不出绿/红，但「第 4 段写着『已通过』还是『已打回』」他读得出来。
 */

import type { TaskStatus } from '../lib/contract'
import { VERDICT_TONE, T } from '../styles/tokens'

export interface StatusBarProps {
  status: TaskStatus
  /** sm 用于项目卡（紧凑），lg 用于详情页 */
  size?: 'sm' | 'lg'
}

/** 4 个阶段的位置定义。★ 顺序即语义，不许重排 */
const STAGES = ['待认领', '进行中', '待验收', '终态'] as const

/** DB 状态 → (段位置, 该段实际文字, 色调) */
function mapStatus(status: TaskStatus): {
  at: number
  label: string
  tone: 'done' | 'current' | 'todo' | 'pass' | 'reject' | 'dead'
} {
  switch (status) {
    case 'pending':
    case 'dispatched':
      return { at: 0, label: '待认领', tone: 'current' }
    case 'running':
      return { at: 1, label: '进行中', tone: 'current' }
    case 'delivered':
      return { at: 2, label: '待验收', tone: 'current' }
    case 'accepted':
      return { at: 3, label: '已通过', tone: 'pass' }
    case 'rejected':
      return { at: 3, label: '已打回', tone: 'reject' }
    case 'cancelled':
      return { at: 0, label: '已取消', tone: 'dead' }
  }
}

export function StatusBar({ status, size = 'sm' }: StatusBarProps) {
  const { at, label, tone } = mapStatus(status)
  const sm = size === 'sm'
  const dot = sm ? 8 : 11
  const gap = sm ? 42 : 96
  const fs = sm ? 11 : 12

  // 已取消：不画进度，只给一句灰话。★ 画了进度会让人以为还能继续
  if (tone === 'dead') {
    return (
      <div style={{ fontSize: fs, color: T.faint, lineHeight: 1.6 }}>已取消 · 任务不再进行</div>
    )
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap, position: 'relative' }}
      title={`当前：${label}`}
    >
      {/* 连接线：在两段之间画一条，颜色 = 左侧那段是否已走过 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 2,
          background: T.borderSoft,
          top: dot / 2 - 1,
          zIndex: 0,
        }}
      />
      {STAGES.map((stage, i) => {
        // ★★★ 第 4 段（终态位）的文字规则（2026-11-23 截图抓出的 bug）
        //   原实现：`const text = i === 3 ? label : stage`
        //   ⇒ 当状态是 `running` 时，label === '进行中'，于是第 4 段也显示「进行中」，
        //     和第 2 段重复，看起来像「4 段里有两段叫进行中」。
        //
        //   ⇒ 正确规则：第 4 段的文字**只看终态色调**：
        //       tone=pass   ⇒ 「已通过」
        //       tone=reject ⇒ 「已打回」
        //       还没到终态 ⇒ 「终态」这个占位词（灰色，表示「还没到这一步」）
        //     **绝不回退到当前状态的 label** —— 那是把「现在在哪」错画成「终点是什么」。
        const label4 = tone === 'pass' ? '已通过' : tone === 'reject' ? '已打回' : '终态'
        const text = i === 3 ? label4 : stage
        const passed = i < at || (i === at && (tone === 'pass' || tone === 'reject'))
        const isCurrent = i === at && tone === 'current'

        let color: string = T.faint
        if (i === 3 && tone === 'pass') color = VERDICT_TONE.pass.bg
        else if (i === 3 && tone === 'reject') color = VERDICT_TONE.fail.bg
        else if (isCurrent) color = T.accent
        else if (passed) color = T.accent

        return (
          <div
            key={stage + i}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1 }}
          >
            <div
              style={{
                width: dot,
                height: dot,
                borderRadius: '50%',
                background: passed || isCurrent ? color : T.bg,
                border: `2px solid ${color}`,
                boxSizing: 'border-box',
              }}
            />
            <div
              style={{
                fontSize: fs,
                color: passed || isCurrent ? color : T.faint,
                marginTop: sm ? 6 : 8,
                whiteSpace: 'nowrap',
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
