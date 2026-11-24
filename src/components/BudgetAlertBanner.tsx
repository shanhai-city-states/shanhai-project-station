/**
 * BudgetAlertBanner —— 预算止损横幅（顶栏下方通栏）
 * ============================================================================
 *
 * ## 阿开定案（2026-11-24）
 * > 「在页面某个位置例如在顶部菜单栏下方弹出一个通知长时间展示，不可关闭，
 * >  除非项目结束结算后再自动消失。」
 *
 * ## 古茶定案（2026-11-24）
 * > 「越线弹一次，不是每笔都弹。核心是状态位。」
 * > 「只报数字的通知，是噪音；带选项的通知，才是提醒。」
 *
 * ## ★★★ 为什么「不可关闭」但「可折叠」
 *
 * 阿开要求不可关闭，这是对的 —— 古茶说过「通知一旦被关掉，预警就废了」。
 * 但「不可关 + 永久常驻」有个副作用：**条子太占地方，客户会开始无视它**。
 * 无视比关掉更糟 —— 它还在那，但你不知道它没被看。
 *
 * ⇒ 治法不是给 ✕ 按钮（那违背阿开定案），而是**允许折叠成一行**：
 *   折叠后仍然显示「⚠ 项目预算已超支 · 已用 120 分」，只是不占三行。
 *   **它永远在，但不是一直挡着。**
 *
 * ## ★ 折叠状态不持久化
 *
 * 刷新页面后恢复展开。为什么：
 *   折叠是「暂时不想看细节」，不是「已读」。持久化就成了「永久关闭」的马甲。
 *   每次打开项目都提醒一次，符合「止损」的定位。
 *
 * ## 这个组件不管什么
 *  · 不管数据（父组件传进来，它只画）
 *  · 不管轮询（父组件定时拉 GET /projects/:id/alerts）
 *  · 不管「点了选项之后做什么」（现在三个选项都是占位，未接功能）
 */

import { useState } from 'react'

/** 与服务端 budget/alert.ts 的 BudgetAlert 同形（★ 字段改动必须两边同步） */
export interface BudgetAlert {
  level: 'warn' | 'over'
  actual: number
  frozen: number
  warnAt: number
  overAt: number
  title: string
  status: string
  options: string[]
  triggeredAt: string
}

export function BudgetAlertBanner({ alert }: { alert: BudgetAlert | null }) {
  // ★ 折叠状态放组件内、不持久化 —— 理由见文件头
  const [collapsed, setCollapsed] = useState(false)

  if (alert === null) return null

  const isOver = alert.level === 'over'
  // 超支用红，预警用琥珀 —— 两档颜色必须一眼分得清
  const colors = isOver
    ? { bg: '#fdf2f2', border: '#e8b4b4', bar: '#dc2626', text: '#991b1b' }
    : { bg: '#fffbf0', border: '#e8d9a8', bar: '#d97706', text: '#92400e' }

  // ── 折叠态：一行 ──
  if (collapsed) {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 20px',
          background: colors.bg,
          borderBottom: `1px solid ${colors.border}`,
          borderLeft: `4px solid ${colors.bar}`,
          fontSize: 12.5,
          color: colors.text,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {isOver ? '⚠' : '⚡'} {alert.title}
        </span>
        <span>已用 {alert.actual} 分</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.text,
            cursor: 'pointer',
            fontSize: 12,
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          展开详情
        </button>
      </div>
    )
  }

  // ── 展开态：完整三行 ──
  return (
    <div
      role="alert"
      style={{
        padding: '11px 20px',
        background: colors.bg,
        borderBottom: `1px solid ${colors.border}`,
        borderLeft: `4px solid ${colors.bar}`,
        color: colors.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {isOver ? '⚠' : '⚡'} {alert.title}
        </span>
        <div style={{ flex: 1 }} />
        {/*
          ★ 这里没有「关闭」按钮，只有「收起」——
            阿开定案不可关闭；「收起」是降噪，不是关掉。
            文案用「收起」不用「关闭」，避免客户以为能关掉。
        */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="收成一行（预警会一直在，只是不占地方）"
          style={{
            background: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            color: colors.text,
            cursor: 'pointer',
            fontSize: 11.5,
            padding: '2px 8px',
          }}
        >
          收起
        </button>
      </div>

      {/* 现状 —— 古茶第六条：必须说清现状，不许只报数字 */}
      <div style={{ fontSize: 12.5, lineHeight: 1.65, marginBottom: 8 }}>{alert.status}</div>

      {/*
        ★★★ 选项区 —— 2026-11-24 按阿开令拆除「开发中」占位按钮
        ====================================================================
        原来这里渲染 alert.options 里的三个按钮，**全部 disabled + title="功能开发中"**
        （文件头注释当时自己写着「现在三个选项都是占位，未接功能」）。

        ★ 为什么必须拆（产品铁律）：「提前亮的按钮不是搭架子，是失约」。
          更严重的是：这是**告警横幅**。
          客户余额超支被打断，弹出告警，给的三个「选项」一个都点不了 ——
          **看到告警却无法行动，比不弹更焦虑**。

        ★ 古茶那句「带选项的通知，才是提醒」怎么保住？
          他真正要的是「客户知道该干什么」，不是「必须有三个能点的按钮」。
          ⇒ 现状文案（alert.status）里已经写了下一步该做什么，
             **把可执行的动作写成人话，比给三个死按钮更诚实**。

        ★ 什么时候加回来：alert.options 每一项真有对应的后端动作、
          真点了能生效，再按真实数量渲染按钮。
          **不做「先摆三个灰的，以后接上」** —— 那三个灰的今天就在骗人。
      */}
    </div>
  )
}
