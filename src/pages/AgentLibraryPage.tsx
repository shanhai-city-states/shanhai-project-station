/**
 * AgentLibraryPage —— Agent 库（雇人）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这一页只做一件事：**把人雇进来**（2026-11-23）
 * ══════════════════════════════════════════════════════════════════
 *
 * ★★★ 为什么要有这一页（阿开实测卡住的根因）
 *
 *   阿开原话：「我还没找到邀请 Agent 进来的功能啊」。
 *   查下来的根因不是「按钮藏得深」——是**他找不到「在哪雇人」**。
 *   左栏原来只有「Agent 状态」，进去是只读的在场看板，连一个「新建」都没有。
 *   ⇒ 项目里那个「邀请 Agent」的下拉永远是空的，因为库里根本没有人。
 *
 * ★★★ 与「Agent 状态」页的分工（别搞混，混了将来一定要拆）
 *
 *   | 页面        | 动词 | 语义                         |
 *   |-------------|------|------------------------------|
 *   | **Agent 库** | 改   | 雇人 / 看这个租户有哪些人     |
 *   | Agent 状态   | 看   | 此刻谁在忙、谁空闲、在哪个项目 |
 *
 *   本页**不显示实时在场状态** —— 那是状态页的事。
 *   本页显示的是**人事档案**：名字、席位、什么时候雇的、在几个项目里。
 *
 * ★★★ 建 ≠ 邀（古茶定案 011，不许走偏）
 *
 *   本页雇的人**不属于任何项目**。要让它干活，去项目详情页「邀请 Agent」。
 *   两步分开做，Agent 才能同时服务多个项目，才不是某个项目的附件。
 *
 *   所以本页建完只提示「已加入库，去项目里邀它进来」，
 *   **绝不在这里顺手把它塞进任何项目**。
 */

import { useCallback, useEffect, useState } from 'react'
import { T, FONT, VERDICT_TONE } from '../styles/tokens'
import { EmptyState } from '../components/base'
import { createAgent, listAgents, listProjects, listProjectAgents } from '../lib/api'
import type { Agent } from '../lib/contract'
import { fmtDateTime } from '../lib/datetime'

interface Props {
  token: string | null
}

/** 某个 Agent 参与了几个项目（懒算：只在这个 Agent 出现时算，不打全量请求） */
interface AgentUsage {
  projectCount: number
  projectNames: string[]
}

export function AgentLibraryPage({ token }: Props) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  /** 新建表单 */
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [seat, setSeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 刚建成的 —— 给一句「去项目里邀它」的引导，而不是干巴巴消失 */
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const [usage, setUsage] = useState<Record<string, AgentUsage>>({})

  const load = useCallback(async () => {
    const r = await listAgents(token)
    if (r.ok) {
      setAgents(r.data.agents)
      setLoadErr(null)
    } else {
      // ★ 对外文案纪律：不甩技术细节（404 / fetch failed 不给客户看）
      setLoadErr('读取 Agent 库失败，稍后再试')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 算「每个 Agent 在几个项目里」。
   *
   * ★ 为什么要拉项目 + 每个项目的 Agent 列表：
   *   后端没有「某 Agent 在哪些项目」的反向查询端点。
   *   在这里现算，比新加一个端点便宜，而且不会让「同一事实两处维护」。
   *
   * ★ 失败不报错：这只是辅助信息，拉不到就不显示，不影响雇人主流程。
   */
  useEffect(() => {
    if (agents === null || agents.length === 0) return
    let alive = true
    void (async () => {
      const pr = await listProjects(token)
      if (!pr.ok || !alive) return
      const next: Record<string, AgentUsage> = {}
      for (const p of pr.data.projects) {
        const ar = await listProjectAgents(token, p.projectId)
        if (!ar.ok) continue
        for (const pa of ar.data.agents) {
          const cur = next[pa.agentId] ?? { projectCount: 0, projectNames: [] }
          cur.projectCount += 1
          cur.projectNames.push(p.name)
          next[pa.agentId] = cur
        }
      }
      if (alive) setUsage(next)
    })()
    return () => {
      alive = false
    }
  }, [agents, token])

  async function doCreate() {
    const n = name.trim()
    if (n === '') {
      setErr('给它起个名字吧')
      return
    }
    setBusy(true)
    setErr(null)
    const r = await createAgent(token, { displayName: n, seat: seat.trim() || null })
    setBusy(false)
    if (r.ok) {
      setJustCreated(r.data.agent.displayName)
      setName('')
      setSeat('')
      setCreating(false)
      await load()
    } else {
      // ★★★ 每种失败必须给出**不同的下一步动作**（不能都笼统说「再试」）
      //
      //   2026-11-23 修：原来只判 kind==='auth'（401），
      //   而用户拿项目 Key 建 Agent 得到的是 403 ⇒ 落到 else ⇒「没建成，稍后再试」。
      //   他反复点、永远建不出来、也永远不知道为什么。
      const kind = r.failure.kind
      if (kind === 'forbidden') {
        // 403：Key 有效，但身份不对。**重试无用，必须换身份。**
        setErr(
          '当前登录的是「项目通行证」，它不能建 Agent（项目通行证只能派活）。建 Agent 要用铺主凭据 —— kp_own_ 开头那枚。',
        )
      } else if (kind === 'auth') {
        setErr('凭据已失效，请重新登录（用 kp_own_ 开头那枚铺主凭据）。')
      } else if (kind === 'conflict') {
        setErr(r.failure.message)
      } else {
        // ★ 兜底也要带上真实原因，不能只说「稍后再试」
        const msg = 'message' in r.failure ? r.failure.message : ''
        setErr(msg !== '' ? `没建成：${msg}` : '没建成，稍后再试')
      }
    }
  }

  // ── 加载中 ──
  if (agents === null && loadErr === null) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: T.dim, fontSize: 13 }}>
        正在读取 Agent 库…
      </div>
    )
  }

  return (
    <div>
      {/* ── 标题区 ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>雇人</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 4, lineHeight: 1.7 }}>
            给你的新 Agent 同事起个名字，它就是你的人了。要派活，进项目点「派活」。
          </div>
        </div>
        <button
          onClick={() => {
            setCreating((v) => !v)
            setErr(null)
          }}
          style={{
            padding: '7px 16px',
            fontSize: 13,
            color: creating ? T.dim : '#fff',
            background: creating ? 'transparent' : T.accent,
            border: `1px solid ${creating ? T.border : T.accent}`,
            borderRadius: 6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {creating ? '取消' : '+ 雇一个'}
        </button>
      </div>

      {/* ── 刚建成：明确告诉下一步去哪 ── */}
      {justCreated !== null && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: T.accentSoft,
            border: `1px solid ${T.accent}`,
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.7,
          }}
        >
          <b>「{justCreated}」已加入你的库。</b>
          <br />
          下一步：进<b>项目</b> → 点「派活」→ 选它。派活后它才会拿到该项目的通行证，
          才能在那里领活。
          <button
            onClick={() => setJustCreated(null)}
            style={{
              marginLeft: 10,
              background: 'transparent',
              border: 'none',
              color: T.accent,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            知道了
          </button>
        </div>
      )}

      {/* ── 新建表单 ── */}
      {creating && (
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>雇一个新 Agent 同事</div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px' }}>
              <span style={{ fontSize: 11.5, color: T.dim }}>
                给它起个名字 <span style={{ color: T.faint }}>（方便你以后在协作里认出它，不对外）</span>
              </span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setErr(null)
                }}
                placeholder="例如：对账助手、老王、排版小张"
                maxLength={40}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '0 0 140px' }}>
              <span style={{ fontSize: 11.5, color: T.dim }}>席位（可不填）</span>
              <input
                value={seat}
                onChange={(e) => setSeat(e.target.value)}
                placeholder="如 S1"
                maxLength={16}
                style={inputStyle}
              />
            </label>

            <button
              onClick={() => void doCreate()}
              disabled={busy || name.trim() === ''}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                color: '#fff',
                background: busy || name.trim() === '' ? T.faint : T.accent,
                border: 'none',
                borderRadius: 6,
                cursor: busy || name.trim() === '' ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? '正在建…' : '建好'}
            </button>
          </div>

          {err !== null && (
            <div style={{ marginTop: 10, fontSize: 12, color: VERDICT_TONE.fail.fg, lineHeight: 1.7 }}>
              {err}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11.5, color: T.faint, lineHeight: 1.7 }}>
            建好后去项目详情页，点「派活」把它拉进来干活。
          </div>
        </div>
      )}

      {/* ── 读取失败 ── */}
      {loadErr !== null && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: VERDICT_TONE.fail.fg, fontSize: 13 }}>
          {loadErr}
          <button
            onClick={() => {
              setLoadErr(null)
              void load()
            }}
            style={{
              marginLeft: 10,
              background: 'transparent',
              border: 'none',
              color: T.accent,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            重试
          </button>
        </div>
      )}

      {/* ── 空库 ── */}
      {agents !== null && agents.length === 0 && (
        <EmptyState
          title="你还没有雇过 Agent"
          hint="先雇一个同事，再去项目里派活给它。"
          action={{ label: '+ 雇第一个 Agent', onClick: () => setCreating(true) }}
        />
      )}

      {/* ── 名单 ── */}
      {agents !== null && agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map((a) => {
            const u = usage[a.agentId]
            // ★ 账号状态（DB 真字段）与在场状态（推导）是两件事，这里只显示账号状态。
            //   在场状态是「Agent 状态」页的事 —— 混在一起客户分不清「停用」和「离线」。
            const statusTone =
              a.status === 'active' ? T.text : a.status === 'suspended' ? VERDICT_TONE.conditional.fg : T.faint
            const statusLabel =
              a.status === 'active' ? '在职' : a.status === 'suspended' ? '已停用' : '已退役'

            return (
              <div
                key={a.agentId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                }}
              >
                {/* 首字头像 —— 没有任何图标资源，用首字最稳 */}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: T.accentSoft,
                    color: T.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 15,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {a.displayName.slice(0, 1)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.displayName}</span>
                    {a.seat !== null && a.seat !== '' && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: T.bg,
                          border: `1px solid ${T.border}`,
                          color: T.dim,
                        }}
                      >
                        席位 {a.seat}
                      </span>
                    )}
                    <span style={{ fontSize: 11.5, color: statusTone }}>{statusLabel}</span>
                  </div>

                  <div style={{ fontSize: 11.5, color: T.dim, marginTop: 4 }}>
                    {u === undefined ? (
                      <span style={{ color: T.faint }}>…</span>
                    ) : u.projectCount === 0 ? (
                      <span style={{ color: VERDICT_TONE.conditional.fg }}>
                        还没进任何项目 —— 去项目里邀它，它才会拿到通行证
                      </span>
                    ) : (
                      <>
                        在 <b>{u.projectCount}</b> 个项目里：
                        {u.projectNames.join('、')}
                      </>
                    )}
                    <span style={{ color: T.faint, marginLeft: 10 }}>
                      雇于 {fmtDateTime(a.createdAt)}
                    </span>
                  </div>
                </div>

                <code
                  style={{
                    fontSize: 10.5,
                    color: T.faint,
                    fontFamily: FONT.mono,
                    flexShrink: 0,
                  }}
                  title={a.agentId}
                >
                  {a.agentId.slice(-8)}
                </code>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 底部：只留一句操作指引（不解释为什么这么设计） ── */}
      {agents !== null && agents.length > 0 && (
        <div
          style={{
            marginTop: 18,
            padding: '12px 16px',
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            fontSize: 11.5,
            color: T.dim,
            lineHeight: 1.8,
          }}
        >
          要给新同事派活：进项目详情页 → 点「派活」→ 选它 → 把通行证交给它。
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: 13,
  background: T.bg,
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
