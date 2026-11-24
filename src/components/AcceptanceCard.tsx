/**
 * AcceptanceCard —— 验收红绿灯卡
 * =====================================================================
 * ★★ 红绿灯与人工复核同屏规则（真机上撞出来的真问题）：
 *
 *   客户会看到「✅ PM 验收合格」，转头又看到「人工复核：三绿两黄」，
 *   必然问一句 **「那到底能不能用？」**
 *
 *   ⇒ 本卡**必须同时说清两件事**：
 *     ① PM 判的是「**事有没有按序推进**」（流程维度）
 *     ② 人工复核判的是「**内容好不好**」（质量维度）
 *     两个维度分开写，**不许合成一个总分**（合了就是混淆职责，三层职责不许混）
 *
 * ★ 可访问性：状态不只用颜色（每项都带 ✓/✗ 符号 + 文字）
 */

import type { ChatItem } from '../lib/contract'
import { CardShell, VerdictChip } from './ChatItemView'

type Item = Extract<ChatItem, { kind: 'acceptance' }>

export function AcceptanceCard({ item }: { item: Item }) {
  const passed = item.checks.filter((c) => c.pass).length
  const failed = item.checks.length - passed

  return (
    <CardShell
      tone={item.verdict === 'fail' ? 'fail' : item.verdict === 'pass' ? 'pass' : 'warn'}
      title="验收结果"
      ariaLabel="验收红绿灯卡"
    >
      <div className="kv">
        <span className="k">PM 结论</span>
        <span className="v">
          <VerdictChip verdict={item.verdict} />
        </span>
      </div>

      <div className="kv">
        <span className="k">判据</span>
        <span className="v">
          {passed} 项通过{failed > 0 ? ` · ${failed} 项未过` : ''}
        </span>
      </div>

      <ul className="check-list">
        {item.checks.map((c) => (
          <li key={c.id} className={c.pass ? 'ok' : 'bad'}>
            <span className="check-sym" aria-hidden="true">
              {c.pass ? '✓' : '✗'}
            </span>
            <span className="check-label">{c.label}</span>
            {c.detail && <span className="check-detail">{c.detail}</span>}
          </li>
        ))}
      </ul>

      {/* ★ 职责分界：PM 判流程，人工复核判质量。两个维度分开写，不合成总分 */}
      <div className="card-note dim">
        这一栏是 <strong>PM 判的「事有没有按序推进」</strong>（流程）。
        内容质量另由人工独立复核，两件事不互相代替。
      </div>

      <div className="card-actions">
        <button type="button" className="btn primary" disabled={failed > 0}>
          {failed > 0 ? '有未过项，不能签字' : '确认验收'}
        </button>
        <button type="button" className="btn ghost">查看证据</button>
      </div>
    </CardShell>
  )
}
