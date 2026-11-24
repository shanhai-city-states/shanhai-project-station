/**
 * 097 基础组件集 —— 小砚设计稿 §四 五个薄组件
 * =====================================================================
 * 设计依据：小砚《097 UI 设计说明 V1.0》§四 组件清单
 *
 * ★★ 为什么全放一个文件（而设计稿列成 5 个）
 *   设计稿自己也说「都极薄（见 §四）」，并给了压缩方案：
 *     「`StatusBar` 与 `StatusChip` 可合并成 1 个，`StatCard` 用纯 CSS 也能省。
 *       如果你要压到 3 个，我建议保留 `StatusBar` / `DataTable` / `AppShell`，其余用 CSS 类。」
 *
 *   ⇒ 采纳她的压缩建议：StatusBar 单独（逻辑重），其余薄组件合并到本文件。
 *     好处是**少 4 个 import 路径**，坏处是文件长一点 —— 薄组件不值一个文件。
 *
 * ★ 不引 UI 框架（任务书硬约束 + package.json 的 //why-no-ui-framework）
 */

import type { ReactNode } from 'react'
import { T } from '../styles/tokens'

// ═══════════════════════════════════════════════════════════════════
// StatusChip —— 圆点 + 文字胶囊
// ═══════════════════════════════════════════════════════════════════

export type ChipTone = 'pass' | 'warn' | 'fail' | 'info' | 'muted'

const CHIP_COLOR: Record<ChipTone, string> = {
  pass: '#15803d',
  warn: '#b45309',
  fail: '#b91c1c',
  info: '#3B6FE0',
  muted: '#8a8a8a',
}

/**
 * ★ 圆点 + 文字，不是纯色块。
 *   设计稿原则3：「每个状态点都带文字，每个颜色块都带标签」——
 *   红绿色盲看不出绿/红，但读得懂「已通过」「已打回」。
 */
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  const c = CHIP_COLOR[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 12,
        color: c,
        background: `${c}14`,
        border: `1px solid ${c}33`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />
      {label}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════
// StatCard —— 三个读数用
// ═══════════════════════════════════════════════════════════════════

export function StatCard({
  label,
  value,
  sub,
  tone = 'info',
}: {
  label: string
  /** ★ 接受 string 而非 number：有时是 `—`（没有数据），不能编个 0 出来 */
  value: string | number
  /** ★ `| undefined` 是 exactOptionalPropertyTypes 的要求，见 AppShellProps 注释 */
  sub?: string | undefined
  tone?: ChipTone | undefined
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: '14px 16px',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: CHIP_COLOR[tone], lineHeight: 1.2 }}>
        {value}
      </div>
      {sub !== undefined && (
        <div style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DataTable —— 通用表格
// ═══════════════════════════════════════════════════════════════════

export interface Column<T> {
  key: string
  title: string
  /** 列宽，不填则均分 */
  width?: string | number
  align?: 'left' | 'right' | 'center'
  render: (row: T) => ReactNode
}

/**
 * ★ 视觉口径（取自设计稿 §四）：
 *   行高 54 / 表头 11px / 分隔线 #f0f1f3 / **无斑马纹**
 *   「无斑马纹」是有意的：斑马纹会让 54px 行高看起来更碎，且和状态色条抢视线。
 */
export function DataTable<T>({
  cols,
  rows,
  rowKey,
  empty,
}: {
  cols: Column<T>[]
  rows: readonly T[]
  rowKey: (row: T, i: number) => string
  /** ★ 空态必须传 —— 不传就等于「空白表格」，客户以为加载失败 */
  empty: ReactNode
}) {
  if (rows.length === 0) return <>{empty}</>

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {/*
        ★★★ `tableLayout: 'fixed'`（2026-11-24 阿开实测后加）

        ## 为什么必须加：不加，所有 width 声明都不作数
        阿开原话：「把状态以及右边的栏目收紧一些往右移动一些」
        ⇒ 我把状态 92→76、Agent 120→104 等挨个改小，**界面毫无变化**。

        实测（真 DOM 读数，表宽 1062px）：
            声明 34% / 46 / 76 / 104 / 116 / 84
            实际 361 / 92 / 132 / 154 / 200 / 124   ← 全部被放大约 1.5 倍

        **根因不是数字改得不够小，是 `width` 在 `table-layout: auto` 下只是「建议值」。**
        浏览器为了把 `width:100%` 填满，会按比例重新分配每列宽度 ——
        你写多小它都会放大回来。

        ## 为什么 `fixed` 能解决
        `fixed` 下**第一行的宽度声明就是最终宽度**，浏览器不再按内容/容器重新分配。
        ⇒ 「把右边收紧」这件事只有 fixed 能做得到。
        ⇒ 此时 `width:100%` 仍然保留：列宽之和小于容器时，多出的空间全给
          **没有声明宽度的列**（本表的「任务」列用的是 34%，所以会按比例分）。
          想让右侧严格不吃多余空间，就必须让任务列承担弹性 —— 见下方 width 口径。

        ## 代价（如实说）
        1. 列内长内容**不会把列撑开**，会溢出或换行。所以每个单元格的渲染里
           都要自己处理截断（本表 Agent 名已带省略号；任务标题需允许换行）。
        2. 列宽之和 > 容器时会横向溢出。本表已控制在 34% + 442px 内。
      */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          tableLayout: 'fixed',
        }}
      >
        <thead>
          <tr style={{ background: T.surfaceSoft }}>
            {cols.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align ?? 'left',
                  padding: '9px 12px',
                  fontSize: 11,
                  fontWeight: 500,
                  color: T.dim,
                  width: c.width,
                  borderBottom: `1px solid ${T.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {cols.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '0 12px',
                    height: 54,
                    borderBottom: i === rows.length - 1 ? 'none' : '1px solid #f0f1f3',
                    verticalAlign: 'middle',
                  }}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// EmptyState —— 每页必须有
// ═══════════════════════════════════════════════════════════════════

/**
 * ★ 文案纪律（设计稿 §六）：
 *   空：`还没有项目 · 从「＋ 新建项目」开始`  ← 带下一步动作
 *   失败：`没加载出来 · 重试`                ← **不出现 500 / fetch failed / 堆栈**
 *
 *   为什么错误态不许露技术细节：
 *     客户看到 `fetch failed` 只会更慌，且他会去搜这个词；
 *     看到「重试」他知道自己能做什么。**报错是给客户看的，不是给开发者看的。**
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: T.dim }}>{title}</div>
      {hint !== undefined && (
        <div style={{ fontSize: 12, color: T.faint, marginTop: 6 }}>{hint}</div>
      )}
      {action !== undefined && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 16,
            padding: '6px 16px',
            fontSize: 13,
            color: T.accent,
            background: 'transparent',
            border: `1px solid ${T.accent}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
