/**
 * ProjectAgentsPanel —— 项目里的 Agent（邀请 / 移除）
 *
 * ══════════════════════════════════════════════════════════════════
 * 语义（2026-11-23 古茶定案 011，不许走偏）
 * ══════════════════════════════════════════════════════════════════
 *
 *   **「建是雇人，邀是派活，两步不能合成一步。」**
 *
 * ★ 本组件**只做「派活/发工牌」**，不建 Agent。
 *   下拉里只能选「已经在租户 Agent 库里、且还没进这个项目」的 Agent。
 *   库里没有 ⇒ 提示「先去 Agent 库建它」，**绝不顺手建一个** ——
 *   顺手建就把两步合成一步了，Agent 就变成项目附件，不再是可以复用的资产。
 *
 * ★★ 一 Agent 一项目一 Key：
 *   同一个 Agent 进另一个项目 = 另一次邀请 = 另一枚 Key。
 *   移除时只吊销本项目那枚，**其他项目不受影响**（这是隔离的物理保证）。
 *
 * ★★★ 明文只出现一次：
 *   邀请成功后，新 Key 只在这一屏出现。用户勾「我已保存」才收起。
 *   之后列表只显示尾号 —— 能随时查明文，就等于钥匙挂在墙上。
 */

import { useCallback, useEffect, useState } from 'react'
import { T } from '../styles/tokens'
import { EmptyState } from './base'
import { ConfirmBar } from './ConfirmBar'
import {
  listProjectAgents,
  inviteAgent,
  removeProjectAgent,
  renewKeyReq,
  type ProjectAgent,
} from '../lib/api'
import type { Agent } from '../lib/contract'
import { fmtDateTime, fmtDate, daysLeft, humanLeft } from '../lib/datetime'
import { apiBaseUrl, buildIntegrationDoc, renderIntegrationText } from '../lib/agent-integration'

interface Props {
  token: string | null
  projectId: string
  /** 租户 Agent 库里所有人（用来算「还能邀谁」） */
  libraryAgents: Agent[]
  /**
   * 跳去「Agent 库」。
   *
   * ★ 为什么由父层传而不是这里自己改 hash：
   *   路由在 `App.tsx` 里（nav state），本组件不该知道路由怎么实现。
   *   传一个回调，将来路由改了（换 hash / 换 router 库）这里不用动。
   */
  onGoToLibrary: () => void
  /**
   * 项目名 —— 用于接入说明里写「这枚通行证只对『某某项目』有效」。
   *
   * ★ 为什么必须写进说明：不写清楚，对方会拿它去调别的项目，
   *   然后收到 403 以为我们坏了。**边界要提前讲，不要等撞了才解释。**
   */
  projectName: string
}

/**
 * 通行证续期窗口：距今 ≤ 3 天才允许续（阿开 2026-11-24 定）。
 *
 * ★ 为什么不能随时续：
 *   随时能续 ⇒ 用户会把它当「延长保存期」的日常动作，一到期就点，慢慢把
 *   30 天的通行证续成半年一年。通行证是**机器的身份**，有效期越短泄露面越小。
 *   ⇒ 只在「快到期」这个真正需要它的时刻亮起来。**提前亮的按钮不是搭架子，是失约。**
 *
 * ★ 为什么已过期（负数）也算「可续」：
 *   灰掉反而更糟 —— 过期那天他没空，第二天来续就永远续不了了，只能重新发一把
 *   （配置全要改，旧的还得记得吊销）。`renewKey` 本来就能把过期 Key 救回来。
 */
const RENEW_WINDOW_DAYS = 3

function canRenew(expiresAt: string, now: string): boolean {
  return daysLeft(expiresAt, now) <= RENEW_WINDOW_DAYS
}

/**
 * 续期 30 天后的到期日 —— **必须和服务端算法逐字一致**。
 *
 * 服务端 `router.ts` 写的是：
 *   `newExp = new Date(Date.parse(deps.now()) + days * 24 * 3600 * 1000)`
 * 即 **从此刻起 + 30×24 小时**，不是在原到期日上累加。
 *
 * ★ 为什么前端也要算一遍：
 *   确认条上要提前告诉用户「新到期日是哪天」，让他点之前就知道结果。
 *   但如果前端写「原到期日 + 30 天」，而服务端是「今天 + 30 天」——
 *   已过期 5 天的 Key，用户看到的是 12-20，实际变成 12-25，**差 5 天**。
 *   ⇒ 两边用同一个算式。将来服务端改算法，这里必须同步改。
 */
function newRenewExpiry(now: string, days = 30): string {
  return new Date(Date.parse(now) + days * 24 * 3600 * 1000).toISOString()
}

export function ProjectAgentsPanel({
  token,
  projectId,
  libraryAgents,
  onGoToLibrary,
  projectName,
}: Props) {
  const [agents, setAgents] = useState<ProjectAgent[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  /**
   * 已邀请 Agent 名单的展开态（2026-11-24 阿开提的第 5 条）。
   *
   * ★ 阿开原话：「派活下方展示的 2 个 Agent 名称栏目是否也折叠进【派活】按钮
   *   页面空间就更多？」
   *
   * ★ 我为什么做成「默认收起 + 标题行显示人数」而不是「完全塞进派活弹窗」：
   *   这两张卡片里装着**两个只能在卡片上做的动作** ——
   *   ① 「移出项目」（把某个 Agent 从这个项目摘掉）
   *   ② 通行证尾号 + 到期时间（排查「它为什么调不通」时第一眼看这个）
   *   全塞进「派活」里，语义就错了：派活是**加人**，不是**查人/减人**。
   *   ⇒ 折叠保留，但标题行常驻显示「N 人」，做不到「眼不见为净、
   *     却又随时知道有几个人」。
   *
   * ★ 默认收起：阿开要的是「页面空间更多」，默认展开就等于没折。
   */
  const [listOpen, setListOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  /**
   * 正在确认续期的通行证尾号（null = 没有打开确认条）。
   *
   * ★ 与 `pendingRemove` 分开存，而不是合成一个 `{kind, id}`：
   *   两者可能同时指向不同 Agent（一个在确认移出、另一个在确认续期）。
   *   合成一个对象会让「打开 B 的续期」把「A 的移出确认」冲掉 —— 用户会以为
   *   自己点错了。**两个独立意图，两个独立的坑位。**
   */
  const [pendingRenew, setPendingRenew] = useState<string | null>(null)
  /**
   * 续期成功后的回执（尾号 + 新到期日）。
   *
   * ★ 为什么要留回执而不是「静默刷新列表」：
   *   续期后卡片上只是日期从 11-25 变成 12-25。用户刚点完，视线还在按钮附近，
   *   不告诉他就等于「点了没反应」。而且这个动作**改了机器的身份有效期**，
   *   必须给一个明确的「改成了什么」。
   */
  const [renewed, setRenewed] = useState<string | null>(null)

  /** 刚发出的新 Key —— 只存在这一屏，勾了「已保存」就清空 */
  const [issued, setIssued] = useState<{ agentName: string; apiKey: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  /** 是否展开「要交给它的说明」预览 —— 让用户复制前先知道交出的是什么 */
  const [showDoc, setShowDoc] = useState(false)

  const load = useCallback(async () => {
    const r = await listProjectAgents(token, projectId)
    if (r.ok) {
      setAgents(r.data.agents)
      setErr(null)
    } else {
      setErr('读取项目 Agent 失败，稍后再试')
    }
  }, [token, projectId])

  /**
   * 「现在」—— 用来算剩余天数 / 是否进入续期窗口。
   *
   * ★ 为什么要有它，不直接 `new Date()`：
   *   直接调的话，只有重渲染时才会重算。页面开着不动，凌晨跨过「到期前 3 天」
   *   那条线时按钮不会自己亮；跨过「已过期」时也不会变红。
   *   ⇒ 每分钟推一次，让窗口边界自己生效。
   *
   * ★ 为什么 60 秒而不是 1 秒：这是「天」级判断，秒级刷新纯耗电。
   */
  const [now, setNow] = useState<string>(() => new Date().toISOString())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 还能邀谁 = 库里有、且不在这个项目里的
  const inProject = new Set((agents ?? []).map((a) => a.agentId))
  const available = libraryAgents.filter((a) => !inProject.has(a.agentId) && a.status === 'active')

  async function doInvite(agent: Agent) {
    setBusy(true)
    setErr(null)
    const r = await inviteAgent(token, projectId, agent.agentId)
    setBusy(false)
    setPicking(false)
    if (r.ok) {
      // ★ 明文立刻进 issued，交给用户抄；不进 localStorage、不进 URL
      setIssued({ agentName: agent.displayName, apiKey: r.data.apiKey, expiresAt: r.data.expiresAt })
      setCopied(false)
      await load()
    } else {
      setErr(
        r.failure.kind === 'conflict'
          ? r.failure.message
          : r.failure.kind === 'auth'
            ? '凭据无效或已过期'
            : '邀请没成功，稍后再试',
      )
    }
  }

  async function doRemove(agentId: string) {
    setBusy(true)
    setErr(null)
    const r = await removeProjectAgent(token, projectId, agentId)
    setBusy(false)
    setPendingRemove(null)
    if (r.ok) {
      await load()
    } else {
      setErr('移除没成功，稍后再试')
    }
  }

  /**
   * 续期 30 天。
   *
   * ★ 走的是租户级 `/keys/:keyHint/renew`（同一把 Key，只推时间），
   *   不是「重新邀请一把」—— 重新邀请会作废旧通行证，Agent 那边的配置
   *   全要改。**续期的价值就在于「对方无感」。**
   *
   * ★ 服务端是「从此刻起 +30 天」，不是「在原到期日上 +30 天」。
   *   所以确认条上写的是「到期时间变为 X 月 X 日」，不写「往后推 30 天」——
   *   后者会让人以为 11-25 到期续完是 12-25（若今天就是 11-24 恰好一致，
   *   但若已过期 5 天来续，实际是 30 天后而不是 25 天后）。**文案要跟实际算法一致。**
   */
  async function doRenew(keyHint: string) {
    setBusy(true)
    setErr(null)
    const r = await renewKeyReq(token, keyHint, 30)
    setBusy(false)
    setPendingRenew(null)
    if (r.ok) {
      setRenewed(`${keyHint}… 已续期，新到期日 ${fmtDate(r.data.expiresAt)}（30 天）`)
      await load()
    } else {
      setErr(
        r.failure.kind === 'auth'
          ? '凭据无效或已过期'
          : r.failure.kind === 'conflict'
            ? r.failure.message
            : '续期没成功，稍后再试',
      )
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>项目里的 Agent</div>
          <div style={{ fontSize: 11.5, color: T.dim, marginTop: 3, lineHeight: 1.6 }}>
            邀请一个 Agent 进来，它会拿到一枚<b>只对这个项目有效</b>的通行证。
            同一个 Agent 进别的项目，是另一枚 —— 从一个项目移除，不影响其他项目。
          </div>
        </div>
        <button
          onClick={() => setPicking((v) => !v)}
          disabled={busy || agents === null}
          style={{
            padding: '7px 13px',
            fontSize: 12.5,
            border: picking ? `1px solid ${T.border}` : 'none',
            borderRadius: 6,
            background: picking ? 'transparent' : T.accent,
            color: picking ? T.dim : '#fff',
            cursor: busy ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {picking ? '取消' : '派活'}
        </button>
      </div>

      {err !== null && (
        <div style={{
          padding: '10px 12px', marginBottom: 10, background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 6, fontSize: 12.5, color: '#b91c1c',
        }}>
          {err}
        </div>
      )}

      {/*
        ★ 续期成功回执（2026-11-24）：
          续期后卡片上只有日期变了，不给回执等于「点了没反应」。
          而且这个动作动了机器的身份有效期，必须明确说清「改成了什么」。
          带关闭按钮 —— 它是一时的确认，不是常驻状态。
      */}
      {renewed !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 12px', marginBottom: 10, background: '#f0fdf4',
          border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12.5, color: '#15803d',
        }}>
          <span style={{ flex: 1 }}>{renewed}</span>
          <button
            onClick={() => setRenewed(null)}
            aria-label="关闭"
            style={{
              padding: '1px 6px', fontSize: 13, background: 'transparent',
              border: 'none', color: '#15803d', cursor: 'pointer', lineHeight: 1.2,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── 选人 ── */}
      {picking && (
        <div style={{
          padding: 12, marginBottom: 12, background: T.surfaceSoft,
          border: `1px solid ${T.border}`, borderRadius: 8,
        }}>
          {available.length === 0 ? (
            // ★ 不提供「顺手建一个」的入口 —— 那会把「雇人」和「派活」合成一步
            //
            // ★★★ 2026-11-23 改：原来这里只说「你的 Agent 库里没有可以邀请的 Agent」，
            //   阿开就是卡在这句话上 —— 他知道要建，但**不知道去哪儿建**（左栏没有那一栏）。
            //   光说「要先去库里建」等于给了一个做不到的指令。
            //   ⇒ 现在给一条**真能点的路**，并且说清左栏在哪。
            <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.8 }}>
              {libraryAgents.length === 0 ? (
                <>
                  你的 <b>Agent 库</b>还是空的 —— 里面一个人都没有，所以没得邀。
                  <div style={{ marginTop: 6, color: T.faint, fontSize: 12 }}>
                    先去<b>左栏「Agent 库」</b>雇一个同事，回来这里再派活给它。
                  </div>
                  <a
                    href="#agent-library"
                    onClick={(e) => {
                      e.preventDefault()
                      onGoToLibrary()
                    }}
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      fontSize: 12.5,
                      color: T.accent,
                      textDecoration: 'none',
                      borderBottom: `1px dashed ${T.accent}`,
                    }}
                  >
                    → 去 Agent 库雇一个
                  </a>
                </>
              ) : (
                <>
                  库里的人<b>都已经在这个项目里了</b>。
                  <div style={{ marginTop: 4, color: T.faint, fontSize: 12 }}>
                    同一个 Agent 在一个项目里只发一枚通行证。要加新的人，先去<b>左栏「Agent 库」</b>雇；
                    要让它进别的项目，去那个项目里邀。
                  </div>
                  <a
                    href="#agent-library"
                    onClick={(e) => {
                      e.preventDefault()
                      onGoToLibrary()
                    }}
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      fontSize: 12.5,
                      color: T.accent,
                      textDecoration: 'none',
                      borderBottom: `1px dashed ${T.accent}`,
                    }}
                  >
                    → 去 Agent 库看看
                  </a>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {available.map((a) => (
                <button
                  key={a.agentId}
                  onClick={() => void doInvite(a)}
                  disabled={busy}
                  style={{
                    padding: '7px 12px',
                    fontSize: 12.5,
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    cursor: busy ? 'default' : 'pointer',
                    color: T.text,
                  }}
                >
                  {a.displayName}
                  {a.seat !== null && a.seat !== '' && (
                    <span style={{ color: T.faint, marginLeft: 5, fontSize: 11 }}>{a.seat}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 刚发出的 Key：唯一的展示机会 ── */}
      {issued !== null && (
        <div style={{
          padding: 14, marginBottom: 12, background: '#fffbeb',
          border: '1px solid #fde68a', borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            已邀请 {issued.agentName} —— 这是它的通行证
          </div>
          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 8, lineHeight: 1.7 }}>
            <b>只显示这一次</b>，关掉就再也看不到了（我们只存尾号，不存明文）。
            请立刻复制交给这个 Agent。
          </div>
          <div style={{
            padding: '9px 11px', background: '#fff', border: '1px solid #fde68a',
            borderRadius: 6, fontFamily: 'monospace', fontSize: 12.5,
            wordBreak: 'break-all', marginBottom: 8,
          }}>
            {issued.apiKey}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                // ★★★ 复制的不是「只有一串 Key」，是**一整份自包含的接入说明**
                //
                //   阿开 2026-11-23：「点击复制 key 应该自带 Agent 如何配置、
                //   如何接入山海·项目台的提示语，以及 KB 详细配置说明才对。」
                //
                //   ★ 为什么必须要这样：用户点「复制」之后，这串东西是要**交给另一个 AI
                //     或另一个开发者**的。只给 Key，对方不知道往哪发、怎么带、怎么领活
                //     ⇒ 那枚 Key 等于废的，还得再来问一遍。
                //
                //   ★ 所以复制内容 = Key + 端点 + 鉴权 + 最小跑通顺序 + 错误码怎么办。
                //     自包含 = 粘到任何地方都能读懂，不依赖我们的界面。
                void navigator.clipboard
                  ?.writeText(
                    renderIntegrationText(
                      buildIntegrationDoc(apiBaseUrl(), projectName),
                      issued.apiKey,
                      issued.agentName,
                    ),
                  )
                  .then(
                    () => setCopied(true),
                    // ★ 复制失败也要能看见明文 —— 不许静默失败
                    () => setCopied(false),
                  )
              }}
              style={{
                padding: '6px 12px', fontSize: 12, border: 'none', borderRadius: 5,
                background: copied ? '#16a34a' : T.accent, color: '#fff', cursor: 'pointer',
              }}
            >
              {copied ? '已复制（含接入说明）' : '复制（含接入说明）'}
            </button>
            <button
              onClick={() => setShowDoc((v) => !v)}
              style={{
                padding: '6px 12px', fontSize: 12,
                background: 'transparent', border: `1px solid #fde68a`,
                borderRadius: 5, color: '#92400e', cursor: 'pointer',
              }}
            >
              {showDoc ? '收起说明' : '先看看要交给它什么'}
            </button>
            <span style={{ fontSize: 11.5, color: '#92400e' }}>
              {fmtDate(issued.expiresAt)} 到期（30 天）
            </span>
            <button
              onClick={() => setIssued(null)}
              style={{
                marginLeft: 'auto', padding: '6px 12px', fontSize: 12,
                background: 'transparent', border: '1px solid #fde68a',
                borderRadius: 5, color: '#92400e', cursor: 'pointer',
              }}
            >
              我已经保存好了
            </button>
          </div>

          {/* ── 说明预览：让用户在复制前就知道「交出去的是什么」── */}
          {showDoc && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11.5, color: '#92400e', marginBottom: 6, lineHeight: 1.7 }}>
                复制给它的内容长这样 —— 包含接入地址、鉴权方式、能调哪些接口、
                出错了怎么办。<b>对方（人或 AI）拿着这一段就能接上，不用再回来问你。</b>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  background: '#fff',
                  border: '1px solid #fde68a',
                  borderRadius: 6,
                  fontSize: 10.5,
                  lineHeight: 1.6,
                  color: '#78350f',
                  maxHeight: 260,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {renderIntegrationText(
                  buildIntegrationDoc(apiBaseUrl(), projectName),
                  issued.apiKey,
                  issued.agentName,
                )}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── 列表 ── */}
      {agents === null && err === null && (
        <div style={{ fontSize: 12.5, color: T.faint, padding: '14px 0' }}>加载中…</div>
      )}

      {agents !== null && agents.length === 0 && (
        <EmptyState
          title="还没有 Agent 进这个项目"
          hint="点右上「派活」，从你雇的 Agent 里选一个。"
        />
      )}

      {agents !== null && agents.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <button
            onClick={() => setListOpen((v) => !v)}
            aria-expanded={listOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              marginLeft: -8,
              background: 'transparent',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12.5,
              color: T.dim,
            }}
          >
            <span style={{ fontSize: 10 }}>{listOpen ? '▾' : '▸'}</span>
            {/* ★ 人数常驻显示：折叠不等于「不知道有谁」。
                阿开要的是省空间，不是失去感知。 */}
            <span>{listOpen ? '收起名单' : `已在项目 ${agents.length} 人`}</span>
          </button>
        </div>
      )}

      {agents !== null && agents.length > 0 && listOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map((a) => (
            <div
              key={a.inviteId}
              style={{
                padding: '11px 13px', background: T.surface,
                border: `1px solid ${T.border}`, borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {a.displayName}
                    {a.seat !== null && a.seat !== '' && (
                      <span style={{ fontSize: 11, color: T.faint, marginLeft: 6 }}>{a.seat}</span>
                    )}
                    {a.status !== 'active' && (
                      <span style={{
                        marginLeft: 8, fontSize: 11, color: '#b91c1c',
                        border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 5px',
                      }}>
                        {a.status === 'suspended' ? '已停用' : '已吊销'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.dim, marginTop: 3 }}>
                    通行证 <code style={{ fontSize: 11 }}>{a.keyHint}…</code>
                    {' · '}{fmtDate(a.expiresAt)} 到期
                    {/* ★ 剩余天数必须写出来：否则「续期按钮是灰的」没有解释，
                        用户会以为功能坏了。灰按钮旁边必须有一个「为什么现在不能点」。 */}
                    {a.status === 'active' && (
                      <span
                        style={{
                          color: canRenew(a.expiresAt, now)
                            ? daysLeft(a.expiresAt, now) <= 1
                              ? '#b91c1c'
                              : '#b45309'
                            : T.faint,
                        }}
                      >
                        {' · '}{humanLeft(a.expiresAt, now)}
                      </span>
                    )}
                    {' · '}邀于 {fmtDateTime(a.invitedAt)}
                  </div>
                </div>
                <button
                  onClick={() => setPendingRemove(a.agentId)}
                  disabled={busy || pendingRemove !== null}
                  style={{
                    padding: '5px 11px', fontSize: 12,
                    background: 'transparent', border: `1px solid ${T.border}`,
                    borderRadius: 5, color: '#b91c1c',
                    cursor: busy ? 'default' : 'pointer', flexShrink: 0,
                  }}
                >
                  移出项目
                </button>

                {/*
                  ★ 通行证续期（2026-11-24 阿开提）：
                    只在「剩 ≤3 天（含已过期）」时可点，其余时间灰掉。

                  ★ 灰色不是禁用而是 `disabled` + `title` 说明理由 ——
                    用户看到灰按钮的第一反应是「是不是坏了」，必须能问出为什么。
                    `title` 在鼠标悬停时给出「还剩 N 天，到期前 3 天才可续期」。

                  ★ 已停用/已吊销的通行证不给续期：续期只改时间、不解状态。
                    那种情况要的是重新邀请，不是续命。
                */}
                {(() => {
                  const renewable = a.status === 'active' && canRenew(a.expiresAt, now)
                  const why = a.status !== 'active'
                    ? '通行证已失效，不能续期 —— 请移出后重新邀请'
                    : renewable
                      ? `把到期时间延到 30 天后（同一枚通行证，对方不用改配置）`
                      : `还剩 ${daysLeft(a.expiresAt, now)} 天，到期前 ${RENEW_WINDOW_DAYS} 天才可续期`
                  return (
                    <button
                      onClick={() => setPendingRenew(a.keyHint)}
                      disabled={busy || !renewable || pendingRenew !== null}
                      title={why}
                      style={{
                        padding: '5px 11px', fontSize: 12,
                        background: renewable ? '#eff6ff' : 'transparent',
                        border: `1px solid ${renewable ? '#93c5fd' : T.border}`,
                        borderRadius: 5,
                        color: renewable ? '#1d4ed8' : T.faint,
                        cursor: busy || !renewable ? 'default' : 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      通行证续期
                    </button>
                  )
                })()}
              </div>

              {pendingRemove === a.agentId && (
                <ConfirmBar
                  tone="danger"
                  confirmLabel="移出"
                  busy={busy}
                  consequence={
                    <>
                      把 <b>{a.displayName}</b> 移出本项目，它这枚通行证当场作废。
                      <div style={{ color: T.dim, marginTop: 2 }}>
                        它<b>在其他项目里的通行证不受影响</b>。Agent 本身也不会被删除。
                      </div>
                    </>
                  }
                  onCancel={() => setPendingRemove(null)}
                  onConfirm={() => void doRemove(a.agentId)}
                />
              )}

              {/*
                ★ 续期确认条 —— 挂在这张卡片的外层（与移出确认条同级、横跨整行）。
                  阿开 2026-11-24：「点击要先有一个确认续期的弹出提示确认」。
                  续期改了机器身份的有效期，不能一点就执行。
              */}
              {pendingRenew === a.keyHint && (
                <ConfirmBar
                  tone="normal"
                  confirmLabel="确认续期 30 天"
                  busy={busy}
                  consequence={
                    <>
                      把 <b>{a.displayName}</b> 的通行证
                      <code style={{ fontSize: 11, margin: '0 4px' }}>{a.keyHint}…</code>
                      续期 30 天，<b>新到期日 {fmtDate(newRenewExpiry(now))}</b>。
                      <div style={{ color: T.dim, marginTop: 2 }}>
                        通行证本身不变，<b>Agent 那边不用改任何配置</b>，正在跑的任务不受影响。
                      </div>
                    </>
                  }
                  onCancel={() => setPendingRenew(null)}
                  onConfirm={() => void doRenew(a.keyHint)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 对外接口基址 —— 接入说明里要写的那个地址。
 *
 * ★ 为什么用当前页面的 origin，而不是写死 `https://pm.ak2029.com`：
 *   写死就绑死了一个域名。将来换域名、或者客户在测试环境试，说明里的地址就是错的。
 *   用 `window.location.origin` ⇒ 用户在哪个环境打开，说明就指哪个环境。
 *
 * ★ 为什么不带 `/api` 后缀到 baseUrl 里：
 *   端点列表里已经写了 `/agent/claim` 这样的路径，
 *   基址给到 `https://host/api` 才拼得成完整调用。**拼法只有一处，不能两处各拼一次。**
 */
