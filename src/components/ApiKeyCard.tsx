/**
 * ApiKeyCard —— API Key 交付卡
 * =====================================================================
 * ★★ 安全纪律（本仓已有血泪，写进代码防后人改错）：
 *   「凭证不得进 URL / 不得进日志 / 只在签发那一刻显示一次全文」
 *
 *   ⇒ 本组件的行为约束：
 *     ① `fullKey === null` ⇒ **只显示前缀**，不许「想办法凑出全文」
 *     ② 全文显示必须配「只显示这一次」的明确提示
 *     ③ 复制按钮复制的是 fullKey；它已经为 null ⇒ 按钮**禁用**（不许复制个假的）
 */

import type { ChatItem } from '../lib/contract'
import { CardShell } from './ChatItemView'

type Item = Extract<ChatItem, { kind: 'api-key' }>

export function ApiKeyCard({ item }: { item: Item }) {
  const hasFull = item.fullKey !== null

  return (
    <CardShell tone="info" title="接入密钥" ariaLabel="API Key 卡">
      <div className="kv">
        <span className="k">Key</span>
        <span className="v mono">
          {hasFull ? item.fullKey : `${item.keyPrefix}••••••••`}
        </span>
      </div>
      <div className="kv">
        <span className="k">有效期至</span>
        <span className="v">{fmtDate(item.expiresAt)}</span>
      </div>

      {hasFull ? (
        <div className="card-warn-note">
          ⚠️ 这串 Key <strong>只显示这一次</strong>。关掉或刷新后就看不到了，
          请现在复制保存到你自己的密码管理器里。
        </div>
      ) : (
        <div className="card-note">
          完整 Key 已不再显示。如果你没保存，可以重新签发一个（旧的会立即失效）。
        </div>
      )}

      <div className="card-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!hasFull}
          onClick={() => {
            if (item.fullKey) void navigator.clipboard.writeText(item.fullKey)
          }}
        >
          {hasFull ? '复制 Key' : '已不可复制'}
        </button>
        <button type="button" className="btn ghost">重新签发</button>
      </div>
    </CardShell>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
