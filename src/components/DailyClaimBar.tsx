/**
 * 每日签到条（2026-11-24）
 *
 * ## 为什么要有它
 *
 * 派活余额不足时的提示写着「明天签到可领 100 积分」。
 * 如果界面上**没有签到入口**，那句话就是失约 ——
 * 阿开产品铁律：「提前亮的按钮不是搭架子，是失约。」
 *
 * ## 为什么放在横幅下面
 *
 * 客户看到「余额不足」的那一刻，**最想做的动作就是签到**。
 * 提示和入口分开两个地方 → 客户要自己找 → 找不着就问客服。
 * ⇒ 谁说要什么，旁边就得有能做的那个动作。
 *
 * ## 为什么不可关闭
 *
 * 它不是「通知」，是**功能入口**（像菜单项）。
 * 通知可以关，功能入口关了客户就没有领分的门了。
 * 但可以**折叠成一行** —— 不占地方，需要时展开。
 *
 * ## 文案纪律
 * 「签到」不是「领取」不是「领红包」。阿开定的词是签到，一天一次。
 */
import { useCallback, useEffect, useState } from 'react'
import { getDailyClaimStatus, claimDaily } from '../lib/api'

interface Props {
  token: string | null
  /** 签到成功后回调（父组件可刷新余额/横幅） */
  onClaimed?: (newBalance: number) => void
}

export function DailyClaimBar({ token, onClaimed }: Props): React.ReactElement | null {
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [claimedToday, setClaimedToday] = useState(false)
  const [balance, setBalance] = useState(0)
  const [amount, setAmount] = useState(100)
  const [msg, setMsg] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const s = await getDailyClaimStatus(token)
    if (s === null) {
      setLoading(false)
      return
    }
    setClaimedToday(s.claimedToday)
    setBalance(s.balance)
    setAmount(s.amountPerClaim)
    setLoading(false)
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const doClaim = useCallback(async (): Promise<void> => {
    if (claiming) return
    setClaiming(true)
    setMsg('')
    const r = await claimDaily(token)
    setClaiming(false)
    if (!r.ok) {
      setMsg(r.message)
      return
    }
    if (r.claimed) {
      setClaimedToday(true)
      setBalance(r.total)
      setMsg(`已领 ${r.amount} 分，当前余额 ${r.total} 分`)
      if (onClaimed !== undefined) onClaimed(r.total)
    } else if (r.alreadyClaimed) {
      setClaimedToday(true)
      setBalance(r.total)
      setMsg(r.message || '今天已经签到过了')
    }
  }, [claiming, token, onClaimed])

  if (loading) return null

  const accent = 'var(--sh-text, #1f2937)'
  const dim = 'var(--sh-dim, #6b7280)'

  if (collapsed) {
    return (
      <div style={barStyle}>
        <span style={{ color: dim, fontSize: 13 }}>
          每日签到 · 余额 {balance} 分
        </span>
        <button style={linkBtn} onClick={() => setCollapsed(false)}>展开</button>
      </div>
    )
  }

  return (
    <div style={barStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: accent, fontSize: 13 }}>每日签到</strong>
        <span style={{ color: dim, fontSize: 12 }}>
          余额 <b style={{ color: accent }}>{balance}</b> 分
        </span>
        {claimedToday ? (
          <span style={{ color: dim, fontSize: 12 }}>今天已签到，明天再来</span>
        ) : (
          <button style={primaryBtn} onClick={() => { void doClaim() }} disabled={claiming}>
            {claiming ? '签到中…' : `签到领 ${amount} 分`}
          </button>
        )}
        {msg !== '' && (
          <span style={{ color: dim, fontSize: 12 }}>{msg}</span>
        )}
      </div>
      <button style={linkBtn} onClick={() => setCollapsed(true)}>收起</button>
    </div>
  )
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 16px',
  margin: '0 0 8px 0',
  background: 'var(--sh-surface, #f9fafb)',
  border: '1px solid var(--sh-border, #e5e7eb)',
  borderRadius: 8,
}

const primaryBtn: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--sh-accent, #2563eb)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

const linkBtn: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 12,
  color: 'var(--sh-dim, #6b7280)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
}
