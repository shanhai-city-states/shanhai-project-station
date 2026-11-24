/**
 * ChatItemView —— 对话流里的每一条（消息 / 三种卡片）
 * =====================================================================
 * ★★ 三种卡片只在「需要人拍板」时插入（README §3.2）：
 *   ① 资源确认卡（**含预算段**）② API Key 卡 ③ 验收红绿灯
 *
 * ★★ 两条产品铁律（阿开原话，写进代码注释防后人改错）：
 *
 *   「预算并入资源确认卡」——
 *     本项目曾出现「同一笔钱两处各写一次」（①资源卡②预算卡），互不覆盖。
 *     ⇒ 只有**一张**资源确认卡，预算在里面。
 *     「预算冻结失败」**不是另一张卡**，是本卡就地转的失败终态（卡不消失、变红）。
 *
 *   「提前亮的按钮不是搭架子，是失约」——
 *     ⇒ 用不上的按钮一律 `disabled`，并在旁边说清「为什么还不能点」。
 *       不许放一个点了没反应的按钮。
 */

import type { ChatItem } from '../lib/contract'
import { VERDICT_TONE } from '../styles/tokens'
import { ResourceConfirmCard } from './ResourceConfirmCard'
import { ApiKeyCard } from './ApiKeyCard'
import { AcceptanceCard } from './AcceptanceCard'

export function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'message':
      return (
        <div className={`msg ${item.from === 'human' ? 'mine' : 'theirs'}`}>
          <div className="bubble">{item.text}</div>
          <div className="msg-time">{fmtTime(item.at)}</div>
        </div>
      )

    case 'resource-confirm':
      return <ResourceConfirmCard item={item} />

    case 'api-key':
      return <ApiKeyCard item={item} />

    case 'acceptance':
      return <AcceptanceCard item={item} />
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 卡片外壳 —— 三张卡长一样，只有内容不同 */
export function CardShell(props: {
  tone: 'info' | 'pass' | 'fail' | 'warn'
  title: string
  children: React.ReactNode
  ariaLabel: string
}) {
  const cls = `card card-${props.tone}`
  return (
    <div className={cls} role="group" aria-label={props.ariaLabel}>
      <div className="card-head">{props.title}</div>
      <div className="card-body">{props.children}</div>
    </div>
  )
}

/** 验收结论圆点 + 文字（★ 不能只靠颜色） */
export function VerdictChip(props: { verdict: keyof typeof VERDICT_TONE | null }) {
  if (!props.verdict) {
    return <span className="chip chip-gray">未判定</span>
  }
  const tone = VERDICT_TONE[props.verdict]
  const labels = {
    pass: '通过',
    conditional: '有条件通过',
    fail: '不通过',
    unverifiable: '无法核实',
  } as const
  return (
    <span className="chip" style={{ background: tone.bg }}>
      {labels[props.verdict]}
    </span>
  )
}
