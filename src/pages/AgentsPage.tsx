/**
 * AgentsPage —— 「我的 Agent」（2026-11-24 合并页）
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 这一页是「雇人」+「派活看板」两页合并而来（阿开 2026-11-24 拍板）
 *
 *   阿开原话：「雇人页面一个 Agent 的一栏很长，可以把状态展示在右边的空间，
 *             且每一栏右边增加一个派活按钮自动跳到项目页面是否体验感更好」
 *
 *   他选定的方案 A：合并成一页，左 Agent 名单 + 右侧状态，
 *   每行末尾「派活」按钮 → 直接带这个 Agent 跳到项目派活面板（进去就选中它）。
 *   派活看板从导航消失。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 布局（桌面：三列；手机：两行）
 *
 *   桌面  ┌──────────────────────────────────────────────────┐
 *         │ [头像] 名字 席位 在职状态            │ 在场 │ 派活 │
 *         │        在 N 个项目：A、B · 雇于 …    │ 状态 │      │
 *         └──────────────────────────────────────────────────┘
 *
 *   手机  ┌─────────────────────────┐
 *         │ [头像] 名字 席位        │
 *         │ ● 干活中 · 项目名       │
 *         │ 在 2 个项目 · 雇于 …    │
 *         │              [派活 →]   │
 *         └─────────────────────────┘
 *
 *   ★ 为什么手机不并成一行：390px 放不下「名字+状态+项目+按钮」四项，
 *     硬塞必然要么文字截断、要么按钮小到点不准。
 *     手机上「名字一行、状态一行、按钮右下角」是唯一能点准的排法。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 仍然保留的两条铁律（合并了页面，但语义不能混）
 *
 *   ① **建 ≠ 邀**（古茶定案 011）
 *      本页雇的人**不属于任何项目**。建完只提示去派活，绝不顺手塞进项目。
 *
 *   ② **status 与 presence 是两回事，必须分两处显示**
 *      `status`   = 账号层面 在职 / 停用（数据库真字段）
 *      `presence` = 此刻在不在干活（由任务状态推导，不落库）
 *      混成一个 ⇒「已停用」和「今天没活」都显示成灰点，客户分不清坏了还是闲着。
 *      ⇒ 名字旁边是 status，右侧那一列才是 presence。合并页也分开放。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { T, VERDICT_TONE, PRESENCE_TONE, ACCOUNT_STATE_TONE } from '../styles/tokens'
import { PresenceDot } from '../components/PresenceDot'
import { EmptyState } from '../components/base'
import { AgentRowMenu } from '../components/AgentRowMenu'
import { RenameDialog, ArchiveConfirm, ArchiveBlocked } from '../components/AgentLifecycleDialogs'
import type { OpenTask } from '../components/AgentLifecycleDialogs'
import {
  createAgent, listAgents, listProjects, listProjectAgents, setAgentRole,
  renameAgent, setAgentStatus,
} from '../lib/api'
import type { AgentAccountStatus } from '../lib/api'
import type { Agent, Presence, AgentRole } from '../lib/contract'
import { fmtDateTime } from '../lib/datetime'
import { useIsMobile } from '../lib/breakpoint'

interface Props {
  token: string | null
  /**
   * 点「派活」后去哪。
   *
   * ★ 为什么把跳转做成回调而不是在本页内派活：
   *   Agent 不属于任何项目（古茶定案 011），派活是**项目里**的动作，
   *   要选项目、写任务名、看冻结额 —— 那是项目详情页的派活面板。
   *   本页只负责「带着这个人过去」，不复制一套派活表单（同一事实两处维护必漂移）。
   *
   * ★ `agentId` 传下去让面板**预选**这个人 —— 阿开原话「点哪条，进去就选中它」。
   *   `projectId` 只在「他已经在这个项目里」时才有值（可直接进那个项目）。
   */
  onDispatch: (agentId: string, projectId: string | null) => void
}

interface AgentUsage {
  projectCount: number
  projectNames: string[]
  projectIds: string[]
}

/**
 * 此刻状态的一句话解释。
 *
 * ★★★ 2026-11-25 修一个实测真 bug（小砚 V1.0 稿 §四 报的）：
 *   这里原写 `blocked: '账号已停用'`，而 tokens.ts 的 PRESENCE_TONE
 *   把同一个 `blocked` 译成「等你拍板」⇒ 页面上拼出
 *   「**等你拍板 · 账号已停用**」，商户以为账号被封了。
 *
 *   根因不是笔误，是 `presence='blocked'` 承担了两个语义：
 *     账号 suspended    → blocked（账号级）
 *     有 delivered 任务 → blocked（此刻级）
 *   ⇒ 已把「账号停用」移到 accountState（见 tokens.ACCOUNT_STATE_TONE），
 *     这里 retained 的 blocked **只表示「等你验收」**。
 */
const PRESENCE_HINT: Record<Presence, string> = {
  busy: '正在处理任务',
  idle: '手上没有活，不是坏了',
  blocked: '交了件，等你验收',
  offline: '很久没有活动',
}

export function AgentsPage({ token, onDispatch }: Props) {
  const isMobile = useIsMobile()

  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [usage, setUsage] = useState<Record<string, AgentUsage>>({})

  /** 新建表单 */
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [seat, setSeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await listAgents(token)
    if (r.ok) {
      setAgents(r.data.agents)
      setLoadErr(null)
    } else {
      // ★ 对外文案纪律：不甩技术细节（404 / fetch failed 不给客户看）
      const kind = r.failure.kind
      if (kind === 'auth') setLoadErr('凭据无效或已过期')
      else if (kind === 'network') setLoadErr('网络不通，检查一下连接')
      else setLoadErr('读取 Agent 失败，稍后再试')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 算「每个 Agent 在几个项目里」+ 留着项目列表给「派活」用。
   *
   * ★ 为什么要拉项目 + 每个项目的 Agent 列表：
   *   后端没有「某 Agent 在哪些项目」的反向查询端点。
   *   在这里现算，比新加一个端点便宜，而且不会让「同一事实两处维护」。
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
          const cur = next[pa.agentId] ?? { projectCount: 0, projectNames: [], projectIds: [] }
          cur.projectCount += 1
          cur.projectNames.push(p.name)
          cur.projectIds.push(p.projectId)
          next[pa.agentId] = cur
        }
      }
      if (alive) setUsage(next)
    })()
    return () => { alive = false }
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
      //   2026-11-23 修：原来只判 kind==='auth'（401），
      //   而用户拿项目 Key 建 Agent 得到的是 403 ⇒ 落到 else ⇒「没建成，稍后再试」。
      const kind = r.failure.kind
      if (kind === 'forbidden') {
        setErr('当前登录的是「项目通行证」，它不能建 Agent（项目通行证只能派活）。建 Agent 要用铺主凭据 —— kp_own_ 开头那枚。')
      } else if (kind === 'auth') {
        setErr('凭据已失效，请重新登录（用 kp_own_ 开头那枚铺主凭据）。')
      } else if (kind === 'conflict') {
        setErr(r.failure.message)
      } else {
        const msg = 'message' in r.failure ? r.failure.message : ''
        setErr(msg !== '' ? `没建成：${msg}` : '没建成，稍后再试')
      }
    }
  }

  /**
   * 点「派活」。
   *
   * ★ 三种情况三种动作（不能一律弹「选项目」）：
   *   ① 已在 1 个项目里 → 直接进那个项目，预选这个人（最少一步）
   *   ② 在多个项目里   → 让他先选项目（不能替他猜该去哪个）
   *   ③ 还没进任何项目 → 提示「先去项目里邀它进来」，不能直接派
   *      因为不在项目里的人没有该项目通行证，派了它也领不到。
   */
  const [picking, setPicking] = useState<string | null>(null)  // 正在选项目的 agentId

  function handleDispatch(a: Agent): void {
    const u = usage[a.agentId]
    const ids = u?.projectIds ?? []
    if (ids.length === 1) {
      onDispatch(a.agentId, ids[0] ?? null)
      return
    }
    if (ids.length > 1) {
      setPicking(picking === a.agentId ? null : a.agentId)
      return
    }
    // 0 个 —— 不进项目就派不了，如实说
    setPicking(null)
    setJustCreated(null)
    setErr(null)
    setNoProjectAgent(a.agentId)
  }

  /** 「还没进项目」的提示对象 */
  const [noProjectAgent, setNoProjectAgent] = useState<string | null>(null)

  /**
   * ── 角色（项目经理）下拉 ──
   *
   * ★★★ 为什么是「每行一个下拉」而不是单独一栏「设置项目经理」（阿开 2026-11-24 问的）：
   *   「改谁」和「改成什么」放在**同一处**，是防误操作最有效的手段。
   *   单开一栏要先把 Agent 再选一遍 —— 多一步、多一次选错的机会。
   *
   * ★ 为什么下拉而不是开关：开关只有两态但语义不清（开=？关=？），
   *   下拉直接写出角色名（执行方 / 项目经理），不需要记哪个方向是什么。
   *   而且下拉有**明确选项边界**，不会像开关那样被误点。
   */
  const [roleBusy, setRoleBusy] = useState<string | null>(null)  // 正在改的 agentId
  const [roleErr, setRoleErr] = useState<string | null>(null)
  const [roleHint, setRoleHint] = useState<string | null>(null)

  async function doSetRole(a: Agent, next: AgentRole): Promise<void> {
    if (a.role === next) return
    setRoleBusy(a.agentId)
    setRoleErr(null)
    setRoleHint(null)
    const r = await setAgentRole(token, a.agentId, next)
    setRoleBusy(null)
    if (r.ok) {
      // ★ 用服务端返回的角色更新本地，**不自己猜**改成什么了
      setAgents((prev) => prev === null ? prev : prev.map((x) =>
        x.agentId === a.agentId
          ? { ...x, role: r.data.role, roleGrantedAt: r.data.grantedAt ?? x.roleGrantedAt }
          : x,
      ))
      if (r.data.changed) {
        setRoleHint(
          next === 'manager'
            ? `「${a.displayName}」现在是项目经理：能建项目、能建派任务、能看项目内全部任务和附件。`
            : `「${a.displayName}」已恢复为执行方：只能干派给他的活。`,
        )
      }
    } else {
      // ★ 每种失败给不同下一步，不笼统说「再试」
      const kind = r.failure.kind
      if (kind === 'forbidden') {
        setRoleErr('只有铺主凭据能设角色（项目经理自己不能给别人升权）。')
      } else if (kind === 'conflict') {
        const msg = 'message' in r.failure ? r.failure.message : ''
        setRoleErr(msg !== '' ? msg : '这个 Agent 当前不能设角色。')
      } else if (kind === 'auth') {
        setRoleErr('凭据已失效，请重新登录。')
      } else {
        setRoleErr('没设成，稍后再试。')
      }
    }
  }

  /** 角色说明文案 —— 唯一口径，中文说人话 */
  const ROLE_META: Record<AgentRole, { label: string; hint: string }> = {
    worker: { label: '执行方', hint: '只能干派给他的活' },
    manager: { label: '项目经理', hint: '可建项目、建派任务、看项目内全部任务' },
  }

  // ══════════════════════════════════════════════════════════════════
  // Agent 生命周期：改名 / 停用 / 恢复 / 归档（2026-11-24）
  // ══════════════════════════════════════════════════════════════════
  //
  // ★★★ 古茶定案：**不做「删除」，做「停用 + 归档」**
  //   「删除＝烧档案，停用＝裁员。公司从不烧档案，只裁员。」
  //   物理删除在数据库层就被触发器 `agent_status_no_delete` 拦死 ——
  //   **不是界面上藏起来**，是「谁都删不掉」。这一页只是不去提供那个动作。
  //
  // ★ 三档语义：
  //   在用 active      日常列表
  //   停用 suspended   「请假」，可恢复（项目要重新邀请）
  //   归档 revoked     「离职」，**不可恢复**（档案留着）

  /** 正在处理生命周期动作的 agentId —— 防重复点、按钮置灰 */
  const [lcBusy, setLcBusy] = useState<string | null>(null)
  /** 顶部提示（停用成功 / 恢复成功） */
  const [lcHint, setLcHint] = useState<string | null>(null)
  /** 顶部错误 */
  const [lcErr, setLcErr] = useState<string | null>(null)

  /** 改名对话框 */
  const [renameTarget, setRenameTarget] = useState<Agent | null>(null)
  const [renameErr, setRenameErr] = useState<string | null>(null)
  /** 归档确认对话框 */
  const [archiveTarget, setArchiveTarget] = useState<Agent | null>(null)
  /** 归档被拒（闸二）—— 带具体任务清单 */
  const [archiveBlocked, setArchiveBlocked] = useState<{ name: string; tasks: OpenTask[] } | null>(null)

  /**
   * 提交通用的「失败翻译」—— 每种 409 给**不同的下一步动作**。
   *
   * ★ 为什么不笼统说「操作失败，稍后再试」：
   *   归档被拒要做的是「去改派任务」，刷新一万次也没用；
   *   已归档改回来是**死路**，该说的是「雇个新的」。
   *   同一句兜底文案套在三种情况下，等于三种都没说。
   */
  function describeLifecycleFailure(
    f: { kind: string; message?: string; code?: string; detail?: Record<string, unknown> },
    name: string,
  ): string {
    if (f.kind === 'auth') return '凭据已失效，请重新登录（用 kp_own_ 开头那枚铺主凭据）。'
    if (f.kind === 'forbidden') return '只有铺主凭据能改 Agent 状态。'
    if (f.kind === 'conflict') {
      if (f.code === 'archived_irreversible') {
        return f.message ?? `${name} 已归档，不能恢复。要重新用这个人，请雇一个新的 Agent。`
      }
      if (f.code === 'has_open_tasks') {
        return f.message ?? `${name} 手上还有没干完的活，不能归档。`
      }
      // ★ 状态机不允许的转换（active → revoked 必须经 suspended）。
      //   前端已经不让用户走到这里（菜单在 active 时改走「先停用」），
      //   但状态可能被别处改动（另一个窗口、经理的操作）⇒ 仍要说清怎么走。
      if (f.code === 'illegal_transition') {
        return (
          f.message ??
          `${name} 现在不能直接改成这个状态。` +
          '归档要先「停用（离职）」再归档 —— 中间留一步可回退的余地。'
        )
      }
      return f.message ?? '这个 Agent 当前不能改成这个状态。'
    }
    return f.message !== undefined && f.message !== '' ? f.message : '没做成，稍后再试。'
  }

  /** 改名提交 */
  async function doRename(a: Agent, next: string): Promise<void> {
    setLcBusy(a.agentId)
    setRenameErr(null)
    const r = await renameAgent(token, a.agentId, next)
    setLcBusy(null)
    if (r.ok) {
      setRenameTarget(null)
      setLcHint(
        r.data.changed
          ? `已改名为「${r.data.displayName}」。工牌号没变（…${r.data.idTail}），项目履历不受影响。`
          : '名字没变，没有改动。',
      )
      await load()
    } else {
      setRenameErr(describeLifecycleFailure(r.failure, a.displayName))
    }
  }

  /**
   * 停用 / 恢复 / 归档统一入口。
   *
   * ★ 停用 → 后端自动移出所有项目并返回 `removedFrom`（项目名清单）。
   *   古茶要求「弹窗逐个列项目名」，不能只说「3 个项目」——
   *   因为用户需要知道**是哪 3 个**，才能判断这次停用的影响范围。
   *
   * ★ 恢复 → 只恢复账号状态，**项目关系不恢复、旧凭据不复活**（古茶硬约束）。
   *   后端在 `note` 里带一句说明，直接展示，不自己另编一套话术。
   */
  async function doSetStatus(a: Agent, to: AgentAccountStatus): Promise<void> {
    setLcBusy(a.agentId)
    setLcErr(null)
    setLcHint(null)
    setArchiveBlocked(null)
    const r = await setAgentStatus(token, a.agentId, to)
    setLcBusy(null)

    if (r.ok) {
      setArchiveTarget(null)

      if (to === 'suspended') {
        const moved = r.data.removedFrom ?? []
        setLcHint(
          moved.length > 0
            ? `「${a.displayName}」已停用，并从 ${moved.length} 个项目移出：${moved.join('、')}。`
            : `「${a.displayName}」已停用。它当前不在任何项目里。`,
        )
      } else if (to === 'active') {
        // ★ 用后端给的 note（它写的就是「要重新邀请、旧凭据不复活」），不自己重写
        setLcHint(r.data.note !== undefined && r.data.note !== ''
          ? `「${a.displayName}」${r.data.note}`
          : `「${a.displayName}」已恢复启用。`)
      } else {
        setLcHint(`「${a.displayName}」已归档。档案和任务记录仍然保留，可查。`)
      }
      await load()
      return
    }

    // ── 失败分支 ──
    // ★ 归档被拒（有未结任务）要**弹清单**，不是顶部一行字（古茶闸二）
    if (r.failure.kind === 'conflict' && r.failure.code === 'has_open_tasks') {
      const raw = r.failure.detail?.['openTasks']
      const tasks: OpenTask[] = Array.isArray(raw)
        ? raw
            .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
            .map((x) => ({
              taskId: String(x['taskId'] ?? ''),
              title: String(x['title'] ?? '(无标题)'),
              status: String(x['status'] ?? ''),
            }))
        : []
      setArchiveTarget(null)
      setArchiveBlocked({ name: a.displayName, tasks })
      return
    }

    // ★ 归档被拒但拿不到清单（如恰好被别处改动）—— 至少把那句话说出来
    if (r.failure.kind === 'conflict' && r.failure.code === 'archived_irreversible') {
      setArchiveTarget(null)
      setLcErr(describeLifecycleFailure(r.failure, a.displayName))
      await load()
      return
    }

    setLcErr(describeLifecycleFailure(r.failure, a.displayName))
  }

  /**
   * 三档分区（古茶闸三：「归档不是藏起来，是沉下去」）。
   *
   * ★ 为什么不在渲染时 filter 三次：那样每个 Agent 会被比较三遍，
   *   而且「哪些人在哪个区」的事实散在三处。用一次分组算清。
   * ★ 排序：在用区按原有顺序（后端给的顺序），停用区排后面
   *   —— 「可能回来的人」不该和「正在干活的人」抢注意力。
   */
  const groups = useMemo(() => {
    const active: Agent[] = []
    const suspended: Agent[] = []
    const archived: Agent[] = []
    for (const a of agents ?? []) {
      if (a.status === 'revoked') archived.push(a)
      else if (a.status === 'suspended') suspended.push(a)
      else active.push(a)
    }
    return { active, suspended, archived }
  }, [agents])

  /** 归档区是否展开 —— 默认收起（「沉下去」，不占日常视线） */
  const [showArchived, setShowArchived] = useState(false)

  /**
   * 渲染一行 Agent（桌面五列 / 手机两行）。
   *
   * ★ 为什么提取成函数而不是内联在 JSX 里：
   *   三档分区（在用 / 停用 / 归档）各自要渲染同一套行，
   *   复制三份必然漂移（列宽、按钮状态、禁用逻辑任一处改漏就错位）。
   *   ⇒ 一份渲染，三个区共用。**同一事实只有一处实现。**
   */
  function renderRow(a: Agent) {
          const u = usage[a.agentId]
          const tone = PRESENCE_TONE[a.presence]
          const accountTone = ACCOUNT_STATE_TONE[a.status === 'active' ? 'active' : a.status === 'suspended' ? 'suspended' : 'revoked']
          const isSuspended = a.status !== 'active'
          const isPicking = picking === a.agentId

          /**
           * ★ 两轴编码（小砚 §一之2）：
           *   · 账号级 `accountTone`  → chip + 行底色 + 按钮置灰
           *   · 此刻级 `tone.shape`   → 形状 + 颜色 + 文字
           *   **停用的账号不再显示「离线」** —— 它不在场，不是失联。
           */
          const presenceCells = isSuspended ? null : (
            <>
              <PresenceDot shape={tone.shape} color={tone.bg} />
              <span style={{ color: T.text, fontSize: 12 }}>{tone.label}</span>
              {/*
                ★ 状态细节用后端真给的 `currentAction`（如「干事中」「等你验收」），
                   **不自己猜时间** —— `Agent`（来自 /agents）没有 idleMinutes，
                   那是 /agent/presence 的字段。编一个字段出来 = 假数据。
                ★ 离线时不写「很久没有活动」占位：留白比假精确更诚实。
              */}
              <span style={{
                color: T.faint, fontSize: 11.5, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {` ${PRESENCE_HINT[a.presence]}`}
              </span>
            </>
          )

          return (
            <div
              key={a.agentId}
              style={{
                background: accountTone.rowBg === 'transparent' ? T.surface : accountTone.rowBg,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                // ★ 70px 行高：5 个 Agent 一屏看完（改前 122px 要滚）
                minHeight: isMobile ? undefined : 70,
                padding: isMobile ? '12px 14px' : '12px 14px',
                opacity: isSuspended ? 0.72 : 1,
              }}
            >
              {isMobile ? (
                /* ═══ 手机：两行 ═══ */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: T.accentSoft, color: T.accent,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 600, flexShrink: 0,
                    }}>{a.displayName.slice(0, 1)}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{
                          fontSize: 13.5, fontWeight: 600, minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{a.displayName}</span>
                        {isSuspended && (
                          <span style={{
                            fontSize: 10.5, padding: '1px 5px', borderRadius: 4,
                            background: accountTone.chipBg, color: accountTone.chipFg,
                            border: `1px solid ${T.border}`, flexShrink: 0,
                          }}>{accountTone.label}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
                        {a.seat !== null && a.seat !== '' ? `席位 ${a.seat}` : '无席位'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12 }}>
                    {presenceCells ?? (
                      <span style={{ color: T.faint, fontSize: 12 }}>已停用的账号不在场</span>
                    )}
                  </div>
                  {u !== undefined && u.projectCount > 0 && (
                    <div style={{
                      fontSize: 11.5, color: T.dim, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      在 {u.projectCount} 个项目：{u.projectNames.join('、')}
                    </div>
                  )}
                  {/* ★ 手机：角色 + 派活同排，统一 42px 高（不把按钮缩到点不准） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <select
                      value={a.role}
                      disabled={roleBusy === a.agentId || isSuspended}
                      onChange={(e) => void doSetRole(a, e.target.value as AgentRole)}
                      style={{
                        flex: 1, minWidth: 0, height: 42,
                        padding: '0 8px', fontSize: 13,
                        color: a.role === 'manager' ? T.accent : T.text,
                        background: T.bg,
                        border: '1px solid #e7e8ed',
                        borderRadius: 6,
                        cursor: roleBusy === a.agentId || isSuspended ? 'not-allowed' : 'pointer',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    >
                      <option value="worker">执行方</option>
                      <option value="manager">项目经理</option>
                    </select>
                    <button
                      onClick={() => handleDispatch(a)}
                      disabled={isSuspended || a.status === 'revoked'}
                      style={{
                        height: 42, minWidth: 88, padding: '0 14px', fontSize: 13,
                        border: '1px solid #e7e8ed',
                        background: 'transparent',
                        color: isSuspended || a.status === 'revoked' ? '#a4abb8' : '#4b5563',
                        borderRadius: 6,
                        cursor: isSuspended || a.status === 'revoked' ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >派活</button>
                    {/* ★ 手机也给「⋯」：没有它，手机上就改不了名、停不了人 */}
                    <div style={{ width: 48, flexShrink: 0, height: 42, display: 'flex', alignItems: 'center' }}>
                      <AgentRowMenu
                        agent={a}
                        archived={a.status === 'revoked'}
                        busy={lcBusy === a.agentId}
                        onRename={(x) => { setRenameErr(null); setRenameTarget(x) }}
                        onSuspend={(x) => void doSetStatus(x, 'suspended')}
                        onRestore={(x) => void doSetStatus(x, 'active')}
                        onArchive={(x) => setArchiveTarget(x)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* ═══ 桌面：五列横排 ═══ */
                <div style={{
                  display: 'grid',
                  // ★ 必须与表头 gridTemplateColumns 逐字一致，否则列错位
                  gridTemplateColumns: '190px 176px minmax(0, 1fr) 112px 128px',
                  gap: 16,
                  alignItems: 'center',
                }}>
                  {/* ① 名字 / 席位 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: T.accentSoft, color: T.accent,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 600, flexShrink: 0,
                    }}>{a.displayName.slice(0, 1)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{
                          fontSize: 13.5, fontWeight: 600, minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{a.displayName}</span>
                        {isSuspended && (
                          <span style={{
                            fontSize: 10.5, padding: '1px 5px', borderRadius: 4,
                            background: accountTone.chipBg, color: accountTone.chipFg,
                            border: `1px solid ${T.border}`, flexShrink: 0,
                          }}>{accountTone.label}</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 11, color: T.faint, marginTop: 2, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.seat !== null && a.seat !== '' ? `席位 ${a.seat}` : '无席位'}
                        {' · 雇于 '}{fmtDateTime(a.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* ② 此刻状态（形状编码） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12 }}>
                    {presenceCells ?? (
                      <span style={{ color: T.faint, fontSize: 11.5 }}>不在场</span>
                    )}
                  </div>

                  {/* ③ 所在项目 */}
                  <div style={{
                    fontSize: 11.5, color: T.dim, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {u === undefined ? (
                      <span style={{ color: T.faint }}>…</span>
                    ) : u.projectCount === 0 ? (
                      <span style={{ color: VERDICT_TONE.conditional.fg }}>还没进任何项目</span>
                    ) : (
                      <>在 {u.projectCount} 个项目：{u.projectNames.join('、')}</>
                    )}
                  </div>

                  {/* ④ 角色（固定 216px；小字换到 select 下一行 —— 
                      改前与 select 同行，宽了把「角色」挤成竖排，手机端必现）*/}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <select
                      value={a.role}
                      disabled={roleBusy === a.agentId || isSuspended}
                      onChange={(e) => void doSetRole(a, e.target.value as AgentRole)}
                      style={{
                        width: '100%', padding: '4px 8px', fontSize: 12,
                        color: a.role === 'manager' ? T.accent : T.text,
                        background: T.bg,
                        border: '1px solid #e7e8ed',
                        borderRadius: 5,
                        cursor: roleBusy === a.agentId || isSuspended ? 'not-allowed' : 'pointer',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    >
                      <option value="worker">执行方</option>
                      <option value="manager">项目经理</option>
                    </select>
                    <span style={{
                      fontSize: 10.5, color: T.faint, minWidth: 0,
                      // ★★ 不用 ellipsis 截断，改成允许两行 —— 角色列从 216 收到 148 后
                      //    「可建项目、建派任务、看项目内全部任务」一行放不下。
                      //    截成「可建项目、建派任务、看项...」= 客户读不到完整的权限边界，
                      //    而这句话正是帮他判断「该不该给这个人经理权」的唯一说明。
                      //    ⇒ 宁可多占一行高度（行高由 minHeight 兜着，不会撑破），也不截断。
                      lineHeight: 1.45,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                    }}>
                      {roleBusy === a.agentId ? '正在改…' : ROLE_META[a.role].hint}
                    </span>
                  </div>

                  {/* ⑤ 派活 + 更多操作
                       ★ 两个按钮并排：派活 72px + gap 8 + ⋯ 48px = 128px 列宽。
                       ★ 派活是主操作（幽灵按钮，不抢状态视觉），⋯ 是次要操作。 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button
                      onClick={() => handleDispatch(a)}
                      disabled={isSuspended || a.status === 'revoked'}
                      style={{
                        padding: '6px 12px', fontSize: 12.5,
                        border: '1px solid #e7e8ed',
                        background: 'transparent',
                        // ★ 归档的人永远不能派活 —— 不是「灰掉」，是「这条路不存在」
                        color: isSuspended || a.status === 'revoked' ? '#a4abb8' : '#4b5563',
                        borderRadius: 6,
                        cursor: isSuspended || a.status === 'revoked' ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                      }}
                    >派活</button>

                    {/* 「⋯」改名 / 停用 / 归档（古茶定案：没有「删除」） */}
                    <div style={{ width: 48, flexShrink: 0 }}>
                      <AgentRowMenu
                        agent={a}
                        archived={a.status === 'revoked'}
                        busy={lcBusy === a.agentId}
                        onRename={(x) => { setRenameErr(null); setRenameTarget(x) }}
                        onSuspend={(x) => void doSetStatus(x, 'suspended')}
                        onRestore={(x) => void doSetStatus(x, 'active')}
                        onArchive={(x) => setArchiveTarget(x)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 多个项目时：就地展开选项目（沿用原逻辑，语义未改）── */}
              {isPicking && (
                <div style={{
                  marginTop: 10, paddingTop: 10,
                  borderTop: `1px solid ${T.border}`,
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                }}>
                  <span style={{ fontSize: 11.5, color: T.dim, marginRight: 2 }}>
                    这个人同时在几个项目，派到哪个：
                  </span>
                  {(u?.projectIds ?? []).map((pid, i) => (
                    <button
                      key={pid}
                      onClick={() => { setPicking(null); onDispatch(a.agentId, pid) }}
                      style={{
                        padding: '5px 10px', fontSize: 12,
                        color: T.text, background: T.bg,
                        border: `1px solid ${T.border}`, borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >{u?.projectNames[i] ?? pid}</button>
                  ))}
                  <button
                    onClick={() => setPicking(null)}
                    style={{
                      padding: '5px 10px', fontSize: 12, color: T.dim,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                    }}
                  >取消</button>
                </div>
              )}
            </div>
          )
  }


  // ── 加载中 ──
  if (agents === null && loadErr === null) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: T.dim, fontSize: 13 }}>
        正在读取 Agent…
      </div>
    )
  }

  const gap = isMobile ? 8 : 10

  // ★ 状态汇总（小砚 V1.0 稿：让商户一眼看到「几个人在干活、几个人在等他」）
  const counts = {
    busy: 0,
    idle: 0,
    blocked: 0,
    offline: 0,
  }
  for (const a of agents ?? []) {
    // ★ 停用的账号不计入「此刻状态」—— 它根本不在场，
    //   混进去会让「离线 4」变成「离线 5」而商户不知道多的那个是谁。
    if (a.status === 'suspended') continue
    counts[a.presence] += 1
  }

  return (
    /**
     * ★★★ 布局（2026-11-25 小砚 V1.0 稿落地）
     *
     * 改前：整页一起滚 ⇒ 往下翻时**标题和权限说明滚走了**，
     *       商户在列表底部看不到「验收和钱只认你本人」这条硬边界。
     * 改后：头部（标题/汇总/权限）在滚动容器**外**，只有列表内滚。
     *
     * ★ 为什么用「头部在外」而不是 `position:sticky`：
     *   sticky 的 `top` 依赖最近的滚动祖先，外层再有 flex/overflow 就容易失效
     *   —— 那种 bug 只在特定窗口高度下出现，最难查。分开更稳。
     *
     * ★ `minHeight:0` 是关键：flex 子项默认 `min-height:auto`，
     *   不写这行内滚**不生效**（内容会把容器撑开）。
     */
    /**
     * ★ 为什么是 `calc(100vh - Xpx)` 而不是 `height: '100%'`：
     *   AppShell 的外层写的是 `minHeight: '100vh'`（没有 `height`），
     *   所以子元素的 `height:100%` **没有参照高度** ⇒ 撑不开内滚，
     *   结果还是整页滚，头部照样跟着跑。
     *
     *   两种改法：
     *   ① 改 AppShell 加 `height:'100vh'` —— **不行**，其他页面靠「整页滚」，
     *      一改全站换滚动行为（一个页面的需求污染全站）。
     *   ② 本页自己扣掉顶栏高度 —— 只影响这一页。选②。
     *
     *   X 的来历：桌面顶栏 52px + 上下内边距；手机顶栏 46px + 底栏 56px。
     *   ★ 用 `100dvh` 兜手机浏览器地址栏（`100vh` 在移动端会被地址栏吃掉一截）。
     */
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      // 桌面：100vh − 顶栏 52 − 内容区上下 padding 40 = 92
      // 手机：100dvh − 顶栏 46 − 内容区 padding 28 − 底栏 64 = 138
      height: isMobile
        ? 'calc(100dvh - 138px)'
        : 'calc(100vh - 92px)',
      maxWidth: 1180,
    }}>
      {/* ── 头部：钉住不滚 ── */}
      <div style={{ flex: 'none', paddingBottom: isMobile ? 8 : 12 }}>
        {/* 标题区 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: isMobile ? 10 : 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: isMobile ? 15 : 16, fontWeight: 600 }}>我的 Agent</span>
              {agents !== null && (
                <span style={{ fontSize: 12, color: T.faint }}>{agents.length} 个</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 4, lineHeight: 1.7 }}>
              你雇的人都在这里。左边是谁、右边是他此刻在不在干活；想到有事，直接点「派活」。
            </div>
          </div>
          <button
            onClick={() => { setCreating((v) => !v); setErr(null) }}
            style={{
              padding: isMobile ? '7px 12px' : '7px 16px',
              fontSize: 13,
              color: creating ? T.dim : '#fff',
              background: creating ? 'transparent' : T.accent,
              border: `1px solid ${creating ? T.border : T.accent}`,
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {creating ? '取消' : '+ 雇一个'}
          </button>
        </div>

        {/* ── 状态汇总（小砚稿：四态计数常驻，不进列表）── */}
        {agents !== null && agents.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16,
            flexWrap: 'wrap', fontSize: 11.5, color: T.dim,
            marginBottom: 10,
          }}>
            {(['busy', 'idle', 'blocked', 'offline'] as const).map((k) => {
              const tone = PRESENCE_TONE[k]
              // 0 的不抢注意力（灰度降级），有数的才亮
              const isZero = counts[k] === 0
              return (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <PresenceDot shape={tone.shape} color={isZero ? T.faint : tone.bg} size={7} />
                  <span style={{ color: isZero ? T.faint : T.dim }}>{tone.label}</span>
                  <span style={{ color: isZero ? T.faint : T.text, fontWeight: isZero ? 400 : 600 }}>
                    {counts[k]}
                  </span>
                </span>
              )
            })}
            {/* ★ 停用的账号不进汇总 ⇒ 总数会对不上。
                不解释的话用户会以为「8 个怎么只算出 7 个」是 bug。 */}
            {(() => {
              const suspended = (agents ?? []).filter((a) => a.status === 'suspended').length
              return suspended > 0 ? (
                <span style={{ color: T.faint, fontSize: 11 }}>
                  另有 {suspended} 个已停用（不计入此刻状态）
                </span>
              ) : null
            })()}
          </div>
        )}

        {/* ── 权限说明（★★★ 本轮重点：从页底移到头部固定区）── */}
        {agents !== null && agents.length > 0 && (
          <PermissionNotice isMobile={isMobile} />
        )}

        {/* ═══ 提示区（钉在头部 · 不随列表滚动）═══
            ★★★ 阿开 2026-11-25 第 4 条：这些提示原来放在下面那个
              `overflowY:'auto'` 的列表容器里 ⇒ 用户往下滚看 Agent 列表时，
              点了「派活」弹出的提示出现在**滚动区顶部之外**（被滚上去了），
              等于提示弹了但人看不见。
            ⇒ 位置而不是文案的问题：提示必须在**不滚的那一层**。
            代价：提示展开会占掉列表高度（这是对的方向 —— 提示本来就该打断，
                  它说的正是「你现在做不成这件事」）。 */}
        {(justCreated !== null || noProjectAgent !== null || roleHint !== null || roleErr !== null || lcHint !== null || lcErr !== null) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: isMobile ? 8 : 10 }}>

            {/* ── 生命周期动作结果（停用/恢复/改名/归档）──
                 ★ 同样放在**滚动容器外**：用户点了「停用」之后可能在列表底部，
                   提示若在滚动区里，他滚上去才看得到（阿开第 4 条同族）。 */}
            {lcHint !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.accentSoft, border: `1px solid ${T.accent}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.7,
              }}>
                {lcHint}
                <button
                  onClick={() => setLcHint(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}
            {lcErr !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.7,
                color: VERDICT_TONE.fail.fg,
              }}>
                {lcErr}
                <button
                  onClick={() => setLcErr(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}
            {/* ── 刚建成：明确告诉下一步去哪 ── */}
            {justCreated !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.accentSoft, border: `1px solid ${T.accent}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.7,
              }}>
                <b>「{justCreated}」已加入你的库。</b>
                <br />
                下一步：点它右边的<b>「派活」</b>，或在项目里「邀请 Agent」把它拉进来。
                派活后它才会拿到该项目的通行证，才能在那里领活。
                <button
                  onClick={() => setJustCreated(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}

            {/* ── 「还没进项目」提示 ── */}
            {noProjectAgent !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.75,
              }}>
                这个人还没进任何项目，现在派不了活。
                <br />
                先去<b>项目</b> → 打开一个项目 → 用「邀请 Agent」把它拉进来，再回来点「派活」。
                <button
                  onClick={() => setNoProjectAgent(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}

            {/* ── 角色变更 / 失败的提示 ── */}
            {roleHint !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.accentSoft, border: `1px solid ${T.accent}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.7,
              }}>
                {roleHint}
                <button
                  onClick={() => setRoleHint(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}
            {roleErr !== null && (
              <div style={{
                padding: '10px 14px',
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: 6, fontSize: 12.5, lineHeight: 1.7,
                color: VERDICT_TONE.fail.fg,
              }}>
                {roleErr}
                <button
                  onClick={() => setRoleErr(null)}
                  style={{ marginLeft: 10, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}
                >知道了</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 列表：只有这里内滚 ── */}
      <div style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap,
      }}>

      {/* ★ 提示块（刚建成 / 还没进项目 / 角色变更 / 角色错误）已搬到头部固定区
          —— 阿开 2026-11-25：「点击派活，没有参与项目的 Agent 会有一个提示，
             假如滚动条下拉，提示就被遮住了看不到，需要把弹出的提示展示在标题栏上方，
             展开应该即使滚动条下拉也能看到」。
          放在内滚容器里 = 滚一下就出视野，提示等于没弹。现移到 <div overflowY:auto> 之外。 */}

      {/* ── 新建表单 ── */}
      {creating && (
        <div style={{
          marginBottom: 16, padding: 16,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>雇一个新 Agent 同事</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ fontSize: 11.5, color: T.dim }}>
                给它起个名字 <span style={{ color: T.faint }}>（方便你以后在协作里认出它，不对外）</span>
              </span>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(null) }}
                placeholder="例如：对账助手、老王、排版小张"
                maxLength={40}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: isMobile ? '1 1 100%' : '0 0 140px' }}>
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
                padding: '8px 20px', fontSize: 13, color: '#fff',
                background: busy || name.trim() === '' ? T.faint : T.accent,
                border: 'none', borderRadius: 6,
                cursor: busy || name.trim() === '' ? 'not-allowed' : 'pointer',
                flexShrink: 0,
              }}
            >{busy ? '正在建…' : '建好'}</button>
          </div>
          {err !== null && (
            <div style={{ marginTop: 10, fontSize: 12, color: VERDICT_TONE.fail.fg, lineHeight: 1.7 }}>{err}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11.5, color: T.faint, lineHeight: 1.7 }}>
            建好后点它右边的「派活」，或在项目里「邀请 Agent」把它拉进来。
          </div>
        </div>
      )}

      {/* ── 读取失败：说清是「拿不到」而不是「没有」 ── */}
      {loadErr !== null && (
        <div style={{
          padding: '14px 16px', background: T.surface,
          border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13,
          color: VERDICT_TONE.fail.fg, lineHeight: 1.8,
        }}>
          读取 Agent 列表失败：{loadErr}
          <div style={{ marginTop: 6, fontSize: 12, color: T.dim }}>
            ★ 这是「没读到」，不是「你没有 Agent」—— 两件事别混。
          </div>
          <button
            onClick={() => { setLoadErr(null); void load() }}
            style={{ marginTop: 8, background: 'transparent', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
          >重试</button>
        </div>
      )}

      {/* ── 空 ── */}
      {agents !== null && agents.length === 0 && (
        <EmptyState
          title="你还没有雇过 Agent"
          hint="先雇一个同事，再给它派活。"
          action={{ label: '+ 雇第一个 Agent', onClick: () => setCreating(true) }}
        />
      )}

      {/* ── 名单 ── */}
      {agents !== null && agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap }}>
          {/* 桌面表头 —— 手机不显示（手机上每行自带标签） */}
          {!isMobile && (
            <div style={{
              display: 'grid',
              // ★★★ 五列（阿开 2026-11-24 第二次调 · 全部按实测宽度重排）
              //
              // 上一版是 200/196/1fr/148/76，阿开看完还是嫌挤。这轮先量了真实文本宽度：
              //   · 状态列内容 = 圆点7 + gap6 + 「等你拍板」48 + gap6 + 「 交了件，等你验收」92
              //                = **159px**（196px 列扣掉 padding 后刚好贴着，一有滚动条就截断）
              //   · 「席位 S1 · 雇于 2026-11-24 06:41:24」= **201px**（200px 名字列装不下）
              //   · 角色下拉「项目经理」只需 **48px**，却给了 148px
              //   ⇒ 名字 200→**190**（席位那行改由 ellipsis 兜，简历不挤状态列）
              //     状态 196→**176**（比实测 159 留 17px 余量，滚动条也吃得下）
              //     角色 148→**112**（下拉 48 + 内边距/箭头 ≈ 76，再给说明文字留 36）
              //     派活  76→**68**
              //     项目列吃掉余量 1fr（桌面 1280 下约 530px，够放「在 2 个项目：…」）
              //
              // ★ 为什么留 17px 余量而不贴死 159：`overflow:auto` 出现滚动条时
              //   列宽会被再挤掉约 15px —— 贴着量的宽度写，一出现滚动条就截断。
              gridTemplateColumns: '190px 176px minmax(0, 1fr) 112px 128px',
              gap: 16,
              padding: '0 14px 6px',
              fontSize: 11,
              color: T.faint,
            }}>
              <span>名字 / 席位</span>
              <span>此刻状态</span>
              <span>所在项目</span>
              <span>角色</span>
              <span />
            </div>
          )}

          {groups.active.map((a) => renderRow(a))}

          {/* ═══ 停用区（古茶闸三：「停用是请假，可能回来」）═══
              ★ 有分隔线 + 小标题，不是简单接在后面 ——
                否则用户会把停用的人当成「状态显示成灰的活人」，
                点他派活又派不了。分区标题就是「这些人现在不算数」的提示。 */}
          {groups.suspended.length > 0 && (
            <>
              <div style={{
                marginTop: 14, marginBottom: 2,
                fontSize: 11.5, color: T.dim,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ whiteSpace: 'nowrap' }}>已停用 {groups.suspended.length} 个</span>
                <span style={{ flex: 1, height: 1, background: T.border }} />
                <span style={{ whiteSpace: 'nowrap', color: T.faint }}>
                  可能还会回来 · 恢复后项目要重新邀请
                </span>
              </div>
              {groups.suspended.map((a) => renderRow(a))}
            </>
          )}

          {/* ═══ 归档区（古茶闸三：「归档不是藏起来，是沉下去」）═══
              ★ 默认收起：日常看不占视线，查历史时点开。
              ★ 收起状态下**也显示人数** —— 否则客户会以为归档的人「消失了」，
                而实际上档案还在。让它「沉下去」不等于「查不到」。 */}
          {groups.archived.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setShowArchived((v) => !v)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 10px', fontSize: 11.5,
                  background: T.bg, color: T.dim,
                  border: `1px solid ${T.border}`, borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span>{showArchived ? '▾' : '▸'}</span>
                <span>已归档 {groups.archived.length} 个（永久封存，不可恢复）</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: T.faint }}>{showArchived ? '收起' : '展开查看'}</span>
              </button>
              {showArchived && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap }}>
                  {groups.archived.map((a) => renderRow(a))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      </div>
      {/* ── 底部一句指引（桌面）—— 权限说明已移到头部，这里只留「派活去哪」── */}
      {agents !== null && agents.length > 0 && !isMobile && (
        <div style={{
          flex: 'none', marginTop: 10, padding: '10px 14px',
          background: T.bg, border: `1px solid ${T.border}`,
          borderRadius: 6, fontSize: 11.5, color: T.dim, lineHeight: 1.7,
        }}>
          派活会把这个人带到项目的派活面板，进去自动选中他。若他还没进那个项目，先在项目里「邀请 Agent」。
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          对话框（fixed 定位，不受本页滚动容器影响）
          ★ 三张各司其职，互斥出现：
            · renameTarget   → 改名
            · archiveTarget  → 归档确认（闸一：说清不可恢复）
            · archiveBlocked → 归档被拒（闸二：列出还有哪些未结任务）
          ★ 停用**没有**确认框 —— 它可恢复，误点代价是「再点一次」。
            确认框只给不可逆的动作，否则用户会练成闭眼点确认 = 没有确认框。
          ══════════════════════════════════════════════════════════════ */}
      {renameTarget !== null && (
        <RenameDialog
          currentName={renameTarget.displayName}
          // ★ 工牌尾号：让用户亲眼看到「号不变，只换标签」（古茶：改名不改号）
          idTail={renameTarget.agentId.slice(-4)}
          busy={lcBusy === renameTarget.agentId}
          error={renameErr}
          onSubmit={(next) => void doRename(renameTarget, next)}
          onClose={() => { setRenameTarget(null); setRenameErr(null) }}
        />
      )}

      {archiveTarget !== null && (
        <ArchiveConfirm
          name={archiveTarget.displayName}
          projectNames={usage[archiveTarget.agentId]?.projectNames ?? []}
          busy={lcBusy === archiveTarget.agentId}
          onConfirm={() => void doSetStatus(archiveTarget, 'revoked')}
          onClose={() => setArchiveTarget(null)}
        />
      )}

      {archiveBlocked !== null && (
        <ArchiveBlocked
          name={archiveBlocked.name}
          tasks={archiveBlocked.tasks}
          onClose={() => setArchiveBlocked(null)}
        />
      )}
    </div>
  )
}

/**
 * 权限说明区 —— 从页底移到头部固定区（小砚 V1.0 稿 §三）
 *
 * ★★★ 为什么必须移：改前这段在**页底**，商户要滚到底才看得见
 *   「验收和钱永远只认你本人」。而**在做决策的那一刻（派活/改角色）他是看着列表的**，
 *   说明不在视野里等于没写。
 *
 * ★ 手机端取舍：默认收成一行「★ 验收和钱永远只认你本人 —— 硬边界」，
 *   点开原地展开全文（**措辞一字不改**）。
 *   理由：390px 宽被三行说明吃掉一半，列表就没法用了；但那句硬边界**始终在**。
 */
function PermissionNotice({ isMobile }: { isMobile: boolean }) {
  const [open, setOpen] = useState(false)

  const line1 = '项目经理能做什么：建项目、建派任务、看项目里全部任务和附件、传交付件。'
  const line2 = '不能做什么：验收任何任务（包括他自己干的）、动积分和账单、改需求书、改别的 Agent 凭据。'
  const line3 = '★ 验收和钱永远只认你本人 —— 这是硬边界，不是可配选项。'

  // ── 手机：收成一行，点开全文 ──
  if (isMobile) {
    return (
      <div style={{
        marginBottom: 10, padding: '8px 12px',
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
        fontSize: 11.5, lineHeight: 1.7,
      }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          }}
        >
          <span style={{ color: '#b45309', flexShrink: 0 }}>★</span>
          <span style={{ color: T.dim, flex: 1, minWidth: 0 }}>验收和钱永远只认你本人 —— 硬边界</span>
          <span style={{ color: T.faint, flexShrink: 0, fontSize: 11 }}>{open ? '收起' : '展开'}</span>
        </button>
        {open && (
          <div style={{ marginTop: 8, color: T.dim }}>
            <div>{line1}</div>
            <div style={{ marginTop: 4 }}>{line2}</div>
            <div style={{ marginTop: 6, color: '#b45309' }}>{line3}</div>
          </div>
        )}
      </div>
    )
  }

  // ── 桌面：恒显全文，硬边界单独一条浅橙 ──
  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px',
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
      fontSize: 11.5, color: T.dim, lineHeight: 1.75,
    }}>
      <div><b style={{ color: T.text }}>项目经理能做什么：</b>建项目、建派任务、看项目里全部任务和附件、传交付件。</div>
      <div style={{ marginTop: 3 }}><b style={{ color: T.text }}>不能做什么：</b>验收任何任务（包括他自己干的）、动积分和账单、改需求书、改别的 Agent 凭据。</div>
      <div style={{
        marginTop: 7, padding: '5px 9px',
        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 5,
        color: '#92400e',
      }}>
        ★ 验收和钱永远只认你本人 —— 这是硬边界，不是可配选项。
      </div>
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
