/**
 * ResourceConfirmCard —— 资源确认卡（★ 含预算段）
 * =====================================================================
 * ★★ 阿开 2026-11-22 定案（本来两处正本对不上，现钉死）：
 *   「预算并入资源确认卡」——「预算冻结失败」**不是另一张卡**，
 *    是本卡就地转的**失败终态**（卡不消失、变红、写差多少 + 三条路）。
 *
 * ★ 三条「不许把不知道伪装成知道」：
 *   ① 费用没算出来 ⇒ 显示「待评估」，**不许显示 ¥0**（¥0 意味着免费）
 *   ② token 没算出来 ⇒ 同上
 *   ③ 冻结失败必须**说清差多少**，并给三条路（充值 / 改范围 / 取消）
 */

import type { ChatItem } from '../lib/contract'
import { CardShell } from './ChatItemView'

type Item = Extract<ChatItem, { kind: 'resource-confirm' }>

export function ResourceConfirmCard({ item }: { item: Item }) {
  const freeze = item.freeze
  const failed = freeze !== null && !freeze.ok

  return (
    <CardShell
      tone={failed ? 'fail' : 'info'}
      title="资源确认"
      ariaLabel="资源确认卡"
    >
      <div className="kv">
        <span className="k">预估费用</span>
        <span className="v">
          {/* ★ 不许把「没算出来」显示成 ¥0 */}
          {item.estimatedCost === null ? (
            <span className="pending">待评估</span>
          ) : (
            `¥${item.estimatedCost.toFixed(2)}`
          )}
        </span>
      </div>
      <div className="kv">
        <span className="k">预估消耗</span>
        <span className="v">
          {item.estimatedTokens === null ? (
            <span className="pending">待评估</span>
          ) : (
            `${item.estimatedTokens.toLocaleString('zh-CN')} tokens`
          )}
        </span>
      </div>

      {/* ★ 冻结失败 = 本卡就地转的终态，不另开一张卡 */}
      {failed && freeze && (
        <div className="card-fail-note">
          <div className="fail-line">
            额度不够：还差 <strong>¥{(freeze.shortfall ?? 0).toFixed(2)}</strong>
          </div>
          <div className="fail-actions">
            <button type="button" className="btn sm">去充值</button>
            <button type="button" className="btn sm">改小范围</button>
            <button type="button" className="btn sm ghost">取消这次派活</button>
          </div>
        </div>
      )}

      {/* ★ 未冻结：按钮可点；已失败：主按钮禁用（不许点了没反应） */}
      {!failed && (
        <div className="card-actions">
          <button type="button" className="btn primary" disabled={freeze === null}>
            {freeze === null ? '正在冻结…' : '确认派活'}
          </button>
          <button type="button" className="btn ghost">先不派</button>
        </div>
      )}
    </CardShell>
  )
}
