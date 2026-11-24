/**
 * AgentRowMenu —— Agent 行尾的「⋯」操作菜单（2026-11-24）
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 古茶拍板定案（阿开四问之第 3 条）：
 *    「不做『删除』，做『停用 + 归档』。删除＝烧档案，停用＝裁员。
 *      公司从不烧档案，只裁员。」
 *
 *    三项：① 改名  ② 停用（离职）  ③ 归档（永久封存）
 *    **没有「删除」这一项** —— 物理删除在数据库层就被触发器拦死
 *    （`agent_status_no_delete`），不是「界面上藏起来」。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 为什么「停用」和「归档」要分成两档（古茶原话）：
 *    「停用是『请假』，归档是『离职』。
 *      只有请假没有离职，请假区迟早变成坟场。」
 *    ⇒ 停用区里应该都是「可能回来」的；永久不干的沉到归档区。
 *
 * ★ 为什么菜单不直接写「删除」但给「归档」：
 *    「危险的动作，字眼要重，不能轻。轻了，客户会误点。」
 *    归档必须二次确认 + 说清「不可恢复」。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 组件边界（单一职责）：
 *   本组件**只负责「收集意图」和「二次确认」**，不直接调 API、不改页面状态。
 *   真正的请求与状态刷新由 AgentsPage 做（菜单不知道也不该知道
 *   「移出了哪些项目」「列表怎么排序」这些页面级事实）。
 *
 *   这是「接口通信而非内部状态通信」：父传 4 个回调，子不读父的 state。
 */
import { useEffect, useRef, useState } from 'react'
import { T, VERDICT_TONE } from '../styles/tokens'
import type { Agent } from '../lib/contract'

interface Props {
  agent: Agent
  /** 改名的工牌尾号（重名时显示成「小助手（…a3f2）」）*/
  idTail?: string
  /** 已被归档 ⇒ 菜单只剩「看档案」，不能做任何变更 */
  archived: boolean
  /** 正在忙碌（改名/停用/归档请求在途）*/
  busy?: boolean
  onRename: (agent: Agent) => void
  onSuspend: (agent: Agent) => void
  onRestore: (agent: Agent) => void
  onArchive: (agent: Agent) => void
}

export function AgentRowMenu({
  agent, idTail, archived, busy = false,
  onRename, onSuspend, onRestore, onArchive,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  /**
   * 点外面关闭。
   *
   * ★ 为什么用 mousedown 而不是 click：
   *   click 在「按下与抬起之间」触发 —— 用户按住拖出去松手也会算一次 click，
   *   菜单会在用户没想点的时候关掉。mousedown 更贴近「点了一下别处」的直觉。
   * ★ 必须判断 `contains`，否则点菜单自己也会先触发关闭（旧版经典坑）。
   */
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      const el = wrapRef.current
      if (el !== null && e.target instanceof Node && !el.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Esc 关闭 —— 键盘用户不该被一个打不开关不掉的浮层困住
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const isSuspended = agent.status === 'suspended'

  function pick(fn: () => void): void {
    setOpen(false)
    fn()
  }

  const itemStyle = (tone?: 'danger'): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: 12.5,
    background: 'transparent',
    border: 'none',
    cursor: busy ? 'not-allowed' : 'pointer',
    color: tone === 'danger' ? VERDICT_TONE.fail.fg : T.text,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    opacity: busy ? 0.5 : 1,
  })

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '6px 0',
          fontSize: 13,
          lineHeight: 1.2,
          color: busy ? '#a4abb8' : T.text,
          background: 'transparent',
          border: '1px solid #e7e8ed',
          borderRadius: 6,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >⋯</button>

      {open && (
        /**
         * ★ 定位用 right:0 + 向下展开（不是向上）。
         *   行尾靠右 ⇒ 用 `right:0` 让菜单右对齐，不会顶出容器右边被裁掉。
         *   若用 left:0，菜单会向右溢出到列表外（窄屏必现横向滚动条）。
         */
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 168,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(16,24,40,0.12)',
            padding: '4px 0',
            overflow: 'hidden',
          }}
        >
          {archived ? (
            /* 归档后：没有任何变更入口 —— 只说明现状，避免用户在这里反复找 */
            <div style={{ padding: '10px 12px', fontSize: 11.5, color: T.faint, lineHeight: 1.7, whiteSpace: 'normal' }}>
              已归档，不能再变更。
              <br />
              档案与任务记录仍然保留可查。
            </div>
          ) : (
            <>
              <button role="menuitem" style={itemStyle()} onClick={() => pick(() => onRename(agent))}>
                改名
                {idTail !== undefined && (
                  <span style={{ color: T.faint, fontSize: 11 }}>（{idTail}）</span>
                )}
              </button>

              {isSuspended ? (
                <button role="menuitem" style={itemStyle()} onClick={() => pick(() => onRestore(agent))}>
                  恢复启用
                </button>
              ) : (
                <button role="menuitem" style={itemStyle()} onClick={() => pick(() => onSuspend(agent))}>
                  停用（离职）
                </button>
              )}

              {/* ★★★ 归档：最后一项、危险色 —— 位置和颜色都在说「这一步更重」
                  ★★ 但 active 状态下**不能直接归档**（后端状态机：active → suspended → revoked）。
                     两条设计后果：
                       ① 直接给一个点了会报错的按钮 = 把用户的正常意图变成一次失败
                       ② 藏掉它 = 用户永远不知道「归档」这条路存在
                     ⇒ 第三条：**显示但引导**。active 时点它先走「停用」，
                       并说清「停用之后可以归档」。这是唯一不骗人的做法。 */}
              <div style={{ height: 1, background: T.border, margin: '4px 0' }} />
              {agent.status === 'active' ? (
                <button
                  role="menuitem"
                  style={{ ...itemStyle(), color: T.dim, whiteSpace: 'normal' }}
                  onClick={() => pick(() => onSuspend(agent))}
                >
                  归档…
                  <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2, lineHeight: 1.5 }}>
                    要先停用才能归档
                  </div>
                </button>
              ) : (
                <button role="menuitem" style={itemStyle('danger')} onClick={() => pick(() => onArchive(agent))}>
                  归档（永久封存）
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
