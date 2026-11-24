/**
 * AgentList —— 左栏 Agent 好友列表
 * =====================================================================
 * ★ 形态依据（README §3.2.1，阿开 2026-11-22 定 · 甲案）：
 *   「Agent 行加项目徽标，不加『按项目看』切换」
 *
 * ★★ 三条约束（照 README 原文落地，不许自由发挥）：
 *   ① 徽标 = `Agent名 · 职能 · 项目名`，**一行不带换行**
 *   ② **一级仍是 Agent，不改**（尊重阿开定的飞书式形态）
 *   ③ 一个 Agent 同时在多项目 ⇒ 显示主要那个 + `+N`
 *
 * ★ 单项目时徽标**降级为不显示** —— 阿开原话：「单项目客户看到徽标里有个
 *   『重复的项目名』不是 bug，但单项目时徽标应降级为不显示」。
 */

import type { Agent } from '../lib/contract'
import { PRESENCE_TONE } from '../styles/tokens'

interface Props {
  agents: Agent[]
  activeId: string | null
  onSelect: (id: string) => void
  loading: boolean
}

export function AgentList({ agents, activeId, onSelect, loading }: Props) {
  return (
    <aside className="left" aria-label="Agent 列表">
      <div className="left-head">
        <span className="left-title">我的 Agent</span>
        {agents.length > 0 && <span className="left-count">{agents.length}</span>}
      </div>

      {loading && <div className="left-empty">加载中…</div>}

      {!loading && agents.length === 0 && (
        <div className="left-empty">
          <p>还没有 Agent 在为你干活。</p>
          <p className="hint">派第一个任务之后，它会出现在这里。</p>
        </div>
      )}

      <ul className="agent-list" role="listbox" aria-label="选择 Agent">
        {agents.map((a) => {
          const tone = PRESENCE_TONE[a.presence]
          const selected = a.agentId === activeId
          return (
            <li key={a.agentId}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`agent-row${selected ? ' selected' : ''}`}
                onClick={() => onSelect(a.agentId)}
              >
                <span
                  className="presence-dot"
                  style={{ background: tone.bg }}
                  aria-hidden="true"
                />
                <span className="agent-main">
                  {/* ★ 约束①：徽标一行不换行（CSS: white-space nowrap + ellipsis）*/}
                  <span className="agent-name">{a.displayName}</span>
                  {/* ★ 约束③ + 单项目降级：extraProjectCount > 0 才显示项目徽标 */}
                  {a.currentProject && a.extraProjectCount > 0 && (
                    <span className="agent-badge" title={`在 ${a.extraProjectCount + 1} 个项目中`}>
                      · {a.currentProject}
                      {a.extraProjectCount > 0 && ` +${a.extraProjectCount}`}
                    </span>
                  )}
                  <span className="agent-action">
                    {a.currentAction ?? tone.label}
                  </span>
                </span>
                {/* ★ 可访问性：状态不只用颜色表达，文字兜底 */}
                <span className="sr-only">{tone.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
