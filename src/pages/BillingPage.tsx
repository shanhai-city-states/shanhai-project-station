/**
 * 积分 / 账单页（2026-11-24）
 *
 * ## 这一页回答什么问题
 *
 * 客户最常问的一句是「**我这 100 分怎么没了**」。
 * 在那之前，他只能在项目页看到一个余额数字 ——
 * 看得到「剩多少」，看不到「为什么剩这么少」。
 *
 * ## 设计取舍（五条）
 *
 * ① **先给余额，再给汇总，最后给流水**
 *    客户进来第一眼要的是「我还有多少」，不是先滚动一屏流水找。
 *
 * ② **对外只两类**（阿开 2026-11-24）
 *    「充值积分 / 赠送积分」。新手礼金和签到赠送都是白送的，
 *    客户不必关心它们的内部区别 —— 那是我们的账本精度，不是他的认知负担。
 *
 * ③ **每笔流水自己说人话**
 *    `title` / `kindLabel` 由服务端翻译（见 router.ts 的 readCreditStatement）。
 *    前端**不做翻译表** —— 那会让加一类来源就要改前端，老客户端永远显示英文。
 *
 * ④ **汇总必须来自服务端独立聚合**
 *    绝不拿当前页 rows 累加：翻页会让「本月消耗」变数，客户以为账错了。
 *    见 core._statement_summary。
 *
 * ⑤ **日期筛选默认「本月」**
 *    客户来看账单，十次有九次是问「这个月花了多少」。
 *    默认给他本月，比让他自己先选日期更省事。
 *
 * ⑥ **过期与作废要看得见**
 *    签到分 3 天过期。如果流水不显示到期时间，客户会觉得
 *    「我明明有 300 分，怎么突然变 100 了，是不是被吞了」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getCreditsStatement,
  getDailyClaimStatus,
  claimDaily,
  type CreditRow,
  type CreditSummary,
} from '../lib/api'
import { useIsMobile } from '../lib/breakpoint'
import { PageFooterNote } from '../components/PageFooterNote'

interface Props {
  token: string | null
}

/** 今天（本地时区）→ YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 本月第一天 → YYYY-MM-DD */
function monthStartStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`
}

const EMPTY_SUMMARY: CreditSummary = {
  inPaid: 0,
  inGift: 0,
  inTotal: 0,
  spent: 0,
  net: 0,
  frozen: 0,
}

export function BillingPage({ token }: Props): React.ReactElement {
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<CreditRow[]>([])
  const [balance, setBalance] = useState(0)
  const [summary, setSummary] = useState<CreditSummary>(EMPTY_SUMMARY)
  const [amountPerClaim, setAmountPerClaim] = useState(100)
  const [claimedToday, setClaimedToday] = useState(false)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // ★ 日期筛选：默认本月（客户十次有九次问「这个月花了多少」）
  const [since, setSince] = useState<string>(monthStartStr)
  const [until, setUntil] = useState<string>(todayStr)
  // 是否启用了日期筛选（默认启用=本月）
  const [dateOn, setDateOn] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [st, ds] = await Promise.all([
      getCreditsStatement(token, {
        since: dateOn ? since : '',
        until: dateOn ? until : '',
      }),
      getDailyClaimStatus(token),
    ])
    if (st !== null) {
      setRows(st.rows)
      setBalance(st.balance)
      setSummary(st.summary ?? EMPTY_SUMMARY)
    }
    if (ds !== null) {
      setClaimedToday(ds.claimedToday)
      setAmountPerClaim(ds.amountPerClaim)
      // 余额以 statement 为准，没有 statement 时用 status 的
      if (st === null) setBalance(ds.balance)
    }
    setLoading(false)
  }, [token, since, until, dateOn])

  useEffect(() => {
    void load()
  }, [load])

  const doClaim = useCallback(async (): Promise<void> => {
    if (claiming) return
    setClaiming(true)
    setErr('')
    setMsg('')
    const r = await claimDaily(token)
    setClaiming(false)
    if (!r.ok) {
      setErr(r.message)
      return
    }
    if (r.claimed) setMsg(`已领 ${r.amount} 分，当前余额 ${r.total} 分`)
    else if (r.alreadyClaimed) setMsg(r.message || '今天已经签到过了')
    await load()
  }, [claiming, token, load])

  const fmtTime = (iso: string): string => {
    if (!iso) return ''
    // 2026-11-23T16:06:35Z → 2026-11-23 16:06
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const rangeLabel = useMemo((): string => {
    if (!dateOn) return '全部时间'
    if (since !== '' && until !== '') return `${since} 至 ${until}`
    if (since !== '') return `${since} 起`
    if (until !== '') return `截至 ${until}`
    return '全部时间'
  }, [dateOn, since, until])

  if (loading && rows.length === 0) {
    return <div style={{ padding: 40, color: 'var(--sh-faint, #9ca3af)', fontSize: 13 }}>加载中…</div>
  }

  return (
    <div style={{
      maxWidth: 880,
      // 固定底条会盖住内容 ⇒ 给容器留出它的高度（手机上还要让开底部标签栏）
      paddingBottom: isMobile ? 72 : 56,
    }}>
      <h1 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px' }}>积分 / 账单</h1>
      <p style={{ fontSize: 13, color: 'var(--sh-dim, #6b7280)', margin: '0 0 16px' }}>
        你的每一笔积分从哪来、到哪去，都在下面。
      </p>

      {/* ── 余额卡 + 签到 ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--sh-dim, #6b7280)', marginBottom: 4 }}>当前可用余额</div>
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
              {balance}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--sh-dim, #6b7280)', marginLeft: 6 }}>分</span>
            </div>
            {/*
              ★ 冻结中（阿开 2026-11-24）：不摆出来，客户会以为账算错了。
                「净变动」算的是账面总额，「可用余额」已经减掉冻结，
                两者相差的就是这一行 —— 把关系写成一句算式，一看就懂。
            */}
            {summary.frozen > 0 && (
              <div style={{ fontSize: 12, color: 'var(--sh-dim, #6b7280)', marginTop: 6 }}>
                冻结中 <strong style={{ color: '#d97706' }}>{summary.frozen}</strong> 分
                <span style={{ margin: '0 4px', color: 'var(--sh-faint, #d1d5db)' }}>·</span>
                账面合计 {balance + summary.frozen} 分
              </div>
            )}
          </div>
          <div style={{ paddingBottom: 4 }}>
            {claimedToday ? (
              <span style={{ fontSize: 13, color: 'var(--sh-dim, #6b7280)' }}>今天已签到，明天再来</span>
            ) : (
              <button style={primaryBtn} onClick={() => { void doClaim() }} disabled={claiming}>
                {claiming ? '签到中…' : `签到领 ${amountPerClaim} 分`}
              </button>
            )}
          </div>
        </div>
        {msg !== '' && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#059669' }}>{msg}</div>
        )}
        {err !== '' && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#dc2626' }}>{err}</div>
        )}
      </div>

      {/* ── 汇总卡：区间内消耗 / 入账（服务端独立聚合，翻页不变）── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>期间汇总</strong>
          <span style={{ fontSize: 12, color: 'var(--sh-dim, #6b7280)' }}>{rangeLabel}</span>
        </div>
        <div style={{
          display: 'grid',
          // ★ 手机两列（4 格排 2×2），桌面自适应多列
          gridTemplateColumns: isMobile
            ? 'repeat(2, minmax(0, 1fr))'
            : 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 12,
        }}>
          <StatBox label="期间消耗" value={summary.spent} tone="#dc2626" />
          <StatBox label="充值积分入账" value={summary.inPaid} tone="#059669" />
          <StatBox label="赠送积分入账" value={summary.inGift} tone="#059669" />
          <StatBox
            label="净变动"
            value={summary.net}
            tone={summary.net >= 0 ? '#059669' : '#dc2626'}
            signed
          />
        </div>
      </div>

      {/* ── 日期筛选 ── */}
      <div style={{ ...cardStyle, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dateOn}
              onChange={(e) => { setDateOn(e.target.checked) }}
            />
            <span>按日期筛选</span>
          </label>
          <input
            type="date"
            value={since}
            disabled={!dateOn}
            onChange={(e) => { setSince(e.target.value) }}
            style={dateInputStyle}
          />
          <span style={{ color: 'var(--sh-dim, #6b7280)' }}>至</span>
          <input
            type="date"
            value={until}
            disabled={!dateOn}
            onChange={(e) => { setUntil(e.target.value) }}
            style={dateInputStyle}
          />
          <button
            style={{ ...ghostBtn, opacity: dateOn ? 1 : 0.5 }}
            disabled={!dateOn}
            onClick={() => { setSince(monthStartStr()); setUntil(todayStr()) }}
          >
            本月
          </button>
          <button
            style={ghostBtn}
            onClick={() => { setDateOn(false) }}
          >
            看全部
          </button>
        </div>
      </div>

      {/* ── 流水 ── */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sh-border, #e5e7eb)' }}>
          <strong style={{ fontSize: 13 }}>积分流水</strong>
          <span style={{ fontSize: 12, color: 'var(--sh-dim, #6b7280)', marginLeft: 8 }}>
            共 {rows.length} 笔
          </span>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--sh-faint, #9ca3af)' }}>
            {dateOn ? '这段时间没有积分记录。换个日期看看，或看全部。' : '还没有积分记录。签到一次就有第一笔了。'}
          </div>
        ) : isMobile ? (
          /* ── 手机：卡片式 ────────────────────────────────────────
             ★ 为什么不在手机上用表格：
               5 列在 390px 屏上每列约 70px，「每日签到赠送 · pm_agent」
               这种说明会被挤成三行甚至截断。横向滚动更糟 ——
               客户得左右来回划才能把一笔账看全。
             ⇒ 手机上一笔一张卡：上面说明+类别，下面时间/变动/到期。
          */
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((r) => (
              <div key={r.id} style={{
                padding: '11px 14px',
                borderTop: '1px solid var(--sh-border, #f3f4f6)',
              }}>
                {/* 第一行：说明 + 变动（最重要，放一起） */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>
                    <span>{r.title || r.reason}</span>
                    {r.expired && <span style={tagStyle('#9ca3af')}>已过期</span>}
                    {r.revoked && <span style={tagStyle('#dc2626')}>已作废</span>}
                  </div>
                  <div style={{
                    fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                    color: r.dir === 'in' ? '#059669' : '#dc2626',
                  }}>
                    {r.dir === 'in' ? '+' : '−'}{r.amount}
                  </div>
                </div>
                {/* 第二行：类别 · 时间 · 到期 */}
                <div style={{
                  marginTop: 5, fontSize: 11.5,
                  color: 'var(--sh-dim, #6b7280)',
                  display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                }}>
                  <span style={kindTagStyle(r.kindLabel)}>{r.kindLabel || '积分'}</span>
                  <span>{fmtTime(r.ts)}</span>
                  {r.dir === 'in' && r.expiresAt !== null && r.expiresAt !== '' && (
                    <span style={{ color: 'var(--sh-faint, #9ca3af)' }}>
                      · {fmtTime(r.expiresAt)} 到期
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--sh-surface, #f9fafb)' }}>
                <th style={thStyle}>时间</th>
                <th style={thStyle}>类别</th>
                <th style={thStyle}>说明</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>变动</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>到期</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--sh-border, #f3f4f6)' }}>
                  <td style={{ ...tdStyle, color: 'var(--sh-dim, #6b7280)', whiteSpace: 'nowrap' }}>
                    {fmtTime(r.ts)}
                  </td>
                  <td style={tdStyle}>
                    <span style={kindTagStyle(r.kindLabel)}>{r.kindLabel || '积分'}</span>
                  </td>
                  <td style={tdStyle}>
                    <span>{r.title || r.reason}</span>
                    {r.expired && (
                      <span style={tagStyle('#9ca3af')}>已过期</span>
                    )}
                    {r.revoked && (
                      <span style={tagStyle('#dc2626')}>已作废</span>
                    )}
                  </td>
                  <td style={{
                    ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap',
                    color: r.dir === 'in' ? '#059669' : '#dc2626',
                    fontWeight: 600,
                  }}>
                    {r.dir === 'in' ? '+' : '−'}{r.amount}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--sh-dim, #6b7280)', whiteSpace: 'nowrap' }}>
                    {r.dir === 'in' && r.expiresAt !== null && r.expiresAt !== ''
                      ? fmtTime(r.expiresAt)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/*
        ★ 底部说明条（阿开 2026-11-24 第二次调）：
          「左侧栏是否也能固定到底部？现在看起来不是很好看」

        上一版是 `left: SIDE_W`（只盖右侧内容区）—— 左侧栏底边虽与右侧齐平，
        但右边有灰底收尾、左边是大片白，视觉上左边「掉了一块」。
        ⇒ 拉成整页宽，左边被同一条灰底接住，左右才成为一个整体。

        位移量全部收进 PageFooterNote，与 Key 管理页共用一个来源（防漂移）。
      */}
      <PageFooterNote>
        签到获得的积分 3 天有效；只要每天签到，过期时间会一起往后顺延。
        充值积分长期有效。消耗时优先用赠送积分，充值积分留到最后。
      </PageFooterNote>
    </div>
  )
}

function StatBox(props: {
  label: string
  value: number
  tone: string
  signed?: boolean
}): React.ReactElement {
  const { label, value, tone, signed } = props
  const text = signed && value > 0 ? `+${value}` : String(value)
  return (
    <div style={{
      border: '1px solid var(--sh-border, #e5e7eb)',
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 12, color: 'var(--sh-dim, #6b7280)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: tone, lineHeight: 1.1 }}>
        {text}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sh-dim, #6b7280)', marginLeft: 4 }}>分</span>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--sh-surface, #fff)',
  border: '1px solid var(--sh-border, #e5e7eb)',
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--sh-accent, #2563eb)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
}

const ghostBtn: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 12,
  color: 'var(--sh-text, #374151)',
  background: 'transparent',
  border: '1px solid var(--sh-border, #e5e7eb)',
  borderRadius: 6,
  cursor: 'pointer',
}

const dateInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--sh-text, #374151)',
  background: 'var(--sh-bg, #fff)',
  border: '1px solid var(--sh-border, #e5e7eb)',
  borderRadius: 6,
}

const thStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sh-dim, #6b7280)',
  textAlign: 'left',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'top',
}

function tagStyle(color: string): React.CSSProperties {
  return {
    marginLeft: 6,
    padding: '1px 6px',
    fontSize: 11,
    color,
    border: `1px solid ${color}`,
    borderRadius: 4,
  }
}

/** 类别标签：充值积分=蓝，赠送积分=绿 */
function kindTagStyle(label: string): React.CSSProperties {
  const paid = label === '充值积分'
  const color = paid ? '#2563eb' : '#059669'
  return {
    padding: '1px 6px',
    fontSize: 11,
    color,
    border: `1px solid ${color}`,
    borderRadius: 4,
    whiteSpace: 'nowrap',
  }
}
