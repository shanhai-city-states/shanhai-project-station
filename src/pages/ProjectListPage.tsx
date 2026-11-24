/**
 * P1 项目列表页（首页）
 * =====================================================================
 * 设计依据：设计稿 §三 P1 + 与后端数据契约核对后的可做性判定
 *
 * ★★★ 本页的取舍（设计稿 10 项需求，核对后端数据后只有 2 项能完整落地）
 *
 *   设计稿要的                  → 本页做法         原因
 *   ──────────────────────────────────────────────────────────
 *   项目名 / 状态胶囊            ✅ 做了
 *   4 段 mini 状态条             ✅ 做了            从任务聚合
 *   进度 5/7 任务                ✅ 做了            从任务聚合
 *   预算条 + 百分比              ❌ 不做            **零预算字段**（小D 拍丙）
 *   「要你处理 →」橙竖线          ✅ 做了            聚合可算
 *   三读数（拍板/进行中/消耗）    ⚠️ 只做前两个      **消耗在 credits.db，跨库无接口**
 *   「要你拍板 N 件」横条         ✅ 做了            聚合可算（无需新端点）
 *   顶栏余额                     ❌ 不做            **跨库无接口**
 *   角色切换（客户/铺主）        ❌ 不做            **无角色概念**（产品语义待定）
 *
 * ★★ 「要你拍板」横条为什么自己算，不等新端点
 *   小D 拍板说加 `GET /pm/pending-decisions/count`，我也同意加（明细版）。
 *   但**本页不能等它** —— 数据已经在 /api/tasks 里了，前端聚合一次就够。
 *   ⇒ 现在自己算（零新依赖，立刻可用）；等端点上了再换成服务端算（省一次全量拉取）。
 *   ★ 这不是「先做假的」，是**真实数据，只是算在前端**。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, Task, TaskStatus } from '../lib/contract'
import { listProjects, listTasks, getCreditsStatement, createProject } from '../lib/api'
import { useIsMobile } from '../lib/breakpoint'
import { T } from '../styles/tokens'
import { StatusBar } from './../components/StatusBar'
import { StatusChip, StatCard, EmptyState } from '../components/base'
import { ProjectNameForm } from '../components/ProjectNameForm'

/** 项目聚合视图：项目 + 它下面任务的统计 */
interface ProjectView {
  project: Project
  tasks: Task[]
  stage: TaskStatus
  done: number
  total: number
  /** 需要人动手的事（未派 / 待验收） */
  needAction: boolean
  needText: string | null
}

function buildView(project: Project, tasks: Task[]): ProjectView {
  const mine = tasks.filter((t) => t.projectId === project.projectId)
  // ★★ 进度用**服务端计数**，不用「我可见的任务数」——
  //   Agent 可见性过滤后我只看得到自己名下那几条，用它当进度会让铺主误以为活没派。
  //   见 contract.ts `Project.taskTotal` 的注释。
  const total = project.taskTotal ?? mine.length
  const done = project.taskDone ?? mine.filter((t) => t.status === 'accepted').length
  const pendingAccept = project.taskPendingAccept ?? mine.filter((t) => t.status === 'delivered').length
  const unassigned = project.taskUnassigned ?? mine.filter((t) => t.status === 'pending' && t.assignee === null).length

  // 项目阶段：用服务端计数推，避免「我看不到就以为没开始」
  let stage: TaskStatus = 'pending'
  if (total > 0) {
    if (pendingAccept > 0) stage = 'delivered'
    else if (done === total) stage = 'accepted'
    else if (mine.some((t) => t.status === 'running')) stage = 'running'
  }

  // 「要你处理」的判定：优先待验收（球在人手上），其次未派活
  let needText: string | null = null
  if (pendingAccept > 0) needText = `${pendingAccept} 个任务待你验收`
  else if (unassigned > 0) needText = `${unassigned} 个任务还没派 Agent`

  return {
    project,
    tasks: mine,
    stage,
    done,
    total,
    needAction: needText !== null,
    needText,
  }
}

function ProjectCard({ view, onOpen }: { view: ProjectView; onOpen: () => void }) {
  const { project, stage, done, total, needAction, needText } = view
  return (
    <div
      onClick={onOpen}
      style={{
        position: 'relative',
        padding: '14px 16px 12px',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        cursor: 'pointer',
        // ★ 需要处理的项目用左侧橙竖线，不点进去也能看出来（设计稿加的，理由充分）
        borderLeft: needAction ? '3px solid #b45309' : `1px solid ${T.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ★ 项目编号小标题（2026-11-23 阿开：「方便识别」）
              为什么放名字上方而不是下方：编号是**识别码**，要先被看见；
              放下面会被当成脚注跳过。
              为什么 null 时显示「编号待分配」而不是隐藏：老库项目没回填时，
              整行消失会让人以为卡片结构变了；显示占位说明「这东西该有」。
              ★ 不许显示 "null" 字面量 —— String(null) 的经典坑。 */}
          <div style={{ fontSize: 11, color: T.faint, letterSpacing: 0.3, marginBottom: 3 }}>
            {project.code ?? '编号待分配'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{project.name}</div>
        </div>
        <StatusChip
          tone={
            stage === 'accepted' ? 'pass' : stage === 'delivered' ? 'warn' : stage === 'rejected' ? 'fail' : 'info'
          }
          label={
            stage === 'accepted'
              ? '已通过'
              : stage === 'delivered'
                ? '待验收'
                : stage === 'running'
                  ? '进行中'
                  : '待认领'
          }
        />
      </div>

      {/* 4 段 mini 状态条 */}
      <div style={{ margin: '12px 0 10px' }}>
        <StatusBar status={stage} size="sm" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
        {/* ★★ 文案修正（2026-11-23 截图复查）：
            原来写 `{done} / {total} 任务`，在「进行中」项目上显示「0 / 3 任务」——
            用户会读成「这个项目只有 0 个任务 / 3 个任务？」两种都不对。
            真实语义是「完成 done / 共 total」。⇒ 加「完成」二字，歧义消失。 */}
        <span style={{ color: T.dim }}>
          完成 {done} / 共 {total}
        </span>
        {needAction && needText !== null && (
          <span style={{ color: '#b45309' }}>{needText} →</span>
        )}
      </div>
    </div>
  )
}

export interface ProjectListPageProps {
  token: string
  onOpenProject: (p: Project) => void
}

export function ProjectListPage({ token, onOpenProject }: ProjectListPageProps) {
  const isMobile = useIsMobile()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<'all' | 'action' | 'running' | 'done'>('all')
  // ★ 本月消耗（阿开 2026-11-24）。null = 拿不到 ⇒ 显示「—」而不是 0
  //   ★ 关键：拿不到时**不许显示 0** —— 0 是一个确定的读数，会被当成真的花了 0 分。
  const [monthSpent, setMonthSpent] = useState<number | null>(null)

  // ── 新建项目（2026-11-24 加）──
  //
  // ★ 为什么用页面内联表单而不是 window.confirm/prompt：
  //   本仓定过「不许用原生 confirm()」——原生弹窗样式不受控、
  //   在手机上还会被浏览器拦（下拉刷新时弹不出来）。一条纪律走到底。
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      // ★★ `request()` 返回 Result 联合类型，必须判 ok 再取 data
      const [ps, ts] = await Promise.all([listProjects(token), listTasks(token)])
      if (!ps.ok || !ts.ok) {
        setState('error')
        return
      }
      setProjects(ps.data.projects)
      setTasks(ts.data.tasks)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [token])

  // 本月消耗：走积分账单的 summary（服务端独立聚合），只取 spent 一个数
  const loadMonthSpent = useCallback(async () => {
    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const since = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`
    const until = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    const st = await getCreditsStatement(token, { since, until, limit: 1 })
    // 拿不到就保持 null（显示「—」），不编 0
    setMonthSpent(st === null ? null : (st.summary?.spent ?? null))
  }, [token])

  useEffect(() => {
    void load()
    void loadMonthSpent()
  }, [load, loadMonthSpent])

  const doCreate = useCallback(async () => {
    const name = newName.trim()
    if (name === '' || createBusy) return
    setCreateBusy(true)
    setCreateErr(null)
    const r = await createProject(token, name)
    setCreateBusy(false)
    if (!r.ok) {
      // ★ 报服务端原话，不自己编。用户看得懂「项目名称最长 80 字」这类话。
      //   ★ 注意 `ApiFailure` 是联合类型：`insufficient-credits` 那一支没有 message
      //     （它给的是 shortfall 数字）。直接取 `.message` 会让 tsc 编译不过，
      //     强行 as 则会运行时拿到 undefined —— 必须显式分支。
      setCreateErr(
        'message' in r.failure
          ? r.failure.message
          : `积分不足，还差 ${r.failure.shortfall} 分`,
      )
      return
    }
    // 成功：清空表单、收起、重拉列表（编号和统计都由服务端给，不自己往数组里塞）
    setNewName('')
    setCreating(false)
    await load()
  }, [newName, createBusy, token, load])

  const views = useMemo(
    () => projects.map((p) => buildView(p, tasks)),
    [projects, tasks],
  )

  // 三读数（★ 只两个：消耗要跨库）
  const needActionCount = views.filter((v) => v.needAction).length
  const runningCount = views.filter((v) => v.stage === 'running' || v.stage === 'delivered').length
  const taskTotal = views.reduce((s, v) => s + v.total, 0)

  // 「要你拍板」明细（★ 真实数据，只是算在前端）
  const decisionItems = useMemo(() => {
    const out: { text: string; projectId: string }[] = []
    for (const v of views) {
      if (!v.needAction) continue
      const pendingAccept = v.tasks.filter((t) => t.status === 'delivered').length
      if (pendingAccept > 0) {
        out.push({ text: `${v.project.name} · ${pendingAccept} 个任务等你验收`, projectId: v.project.projectId })
      } else if (v.needText !== null) {
        out.push({ text: `${v.project.name} · ${v.needText}`, projectId: v.project.projectId })
      }
    }
    return out
  }, [views])

  const shown = useMemo(() => {
    switch (filter) {
      case 'action':
        return views.filter((v) => v.needAction)
      case 'running':
        return views.filter((v) => v.stage === 'running' || v.stage === 'delivered')
      case 'done':
        return views.filter((v) => v.stage === 'accepted' || v.tasks.every((t) => t.status === 'cancelled'))
      default:
        return views
    }
  }, [views, filter])

  if (state === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: T.faint }}>加载中…</div>
  }
  if (state === 'error') {
    return (
      <EmptyState
        title="项目列表没加载出来"
        hint="重试一下"
        action={{ label: '重试', onClick: () => void load() }}
      />
    )
  }
  if (projects.length === 0) {
    // ★ 2026-11-24：空状态原来写「从「＋ 新建项目」开始」，但那个按钮根本不存在
    //   （没有 POST /projects 端点）。现在真做了，空状态直接给表单。
    return (
      <div style={{ padding: '40px 0' }}>
        <EmptyState
          title="还没有项目"
          hint="给项目起个名字，把需求丢给 PM 就行"
          action={{ label: '＋ 新建项目', onClick: () => setCreating(true) }}
        />
        {creating && (
          <div style={{ maxWidth: 420, margin: '20px auto 0' }}>
            <ProjectNameForm
              value={newName}
              onChange={setNewName}
              onSubmit={() => void doCreate()}
              onCancel={() => {
                setCreating(false)
                setCreateErr(null)
              }}
              busy={createBusy}
              error={createErr}
              submitLabel="创建"
            />
          </div>
        )}
      </div>
    )
  }

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `全部 ${views.length}` },
    { key: 'action', label: `要你拍板 ${needActionCount}` },
    { key: 'running', label: `进行中 ${runningCount}` },
    { key: 'done', label: '已结束' },
  ]

  return (
    <>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>项目</h1>
        <span style={{ fontSize: 12, color: T.dim }}>
          全部 {views.length} 个 · 进行中 {runningCount} 个
        </span>
        {/* ★ 2026-11-24 加：新建项目入口。阿开实测「项目页没有创建新项目的按钮」——
            之前只有注册时自动建的那一个，客户永远只有一个项目。 */}
        <button
          type="button"
          onClick={() => {
            setCreating(true)
            setCreateErr(null)
          }}
          style={{
            marginLeft: 'auto',
            padding: '6px 14px',
            fontSize: 13,
            border: '1px solid #e7e8ed',
            borderRadius: 6,
            background: 'transparent',
            color: '#4b5563',
            cursor: 'pointer',
            fontWeight: 400,
          }}
        >
          ＋ 新建项目
        </button>
      </div>

      {creating && (
        <div style={{ marginBottom: 16 }}>
          <ProjectNameForm
            value={newName}
            onChange={setNewName}
            onSubmit={() => void doCreate()}
            onCancel={() => {
              setCreating(false)
              setCreateErr(null)
              setNewName('')
            }}
            busy={createBusy}
            error={createErr}
            submitLabel="创建"
          />
        </div>
      )}

      {/* 三读数（★ 两个：消耗缺跨库接口）*/}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <StatCard
          label="待我拍板"
          value={needActionCount}
          tone={needActionCount > 0 ? 'warn' : 'muted'}
          sub={needActionCount > 0 ? `共 ${decisionItems.length} 项待处理` : '暂无'}
        />
        <StatCard label="进行中" value={runningCount} sub={`共 ${taskTotal} 个任务`} />
        {/* ★ 2026-11-24：本月消耗接上了（走 /credits/statement 的 summary）。
            服务端独立聚合，不受分页影响。
            ★ 拿不到时显示「—」不是 0 —— 0 是确定读数，会被当成真花了 0 分。 */}
        <StatCard
          label="本月消耗"
          value={monthSpent === null ? '—' : monthSpent}
          sub={monthSpent === null ? '账单页可看明细' : '本月已用积分'}
          tone={monthSpent === null ? 'muted' : 'info'}
        />
      </div>

      {/* 过滤 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <span
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '4px 12px',
              borderRadius: 14,
              fontSize: 12,
              cursor: 'pointer',
              background: filter === f.key ? T.text : T.surfaceSoft,
              color: filter === f.key ? T.bg : T.dim,
            }}
          >
            {f.label}
          </span>
        ))}
      </div>

      {/* 「要你拍板」横条（★ 最多 3 条，多了折叠）*/}
      {decisionItems.length > 0 && (
        <div
          style={{
            padding: '10px 14px',
            background: '#fdf6ec',
            border: '1px solid #f0dcc0',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <div style={{ color: '#b45309', fontWeight: 600, marginBottom: 6 }}>
            要你拍板 {decisionItems.length} 件
          </div>
          {decisionItems.slice(0, 3).map((d, i) => (
            <div
              key={i}
              style={{ display: 'flex', gap: 8, padding: '2px 0', color: T.text }}
            >
              <span style={{ flex: 1 }}>{d.text}</span>
              <span style={{ color: T.accent, cursor: 'pointer' }}>去处理 →</span>
            </div>
          ))}
          {decisionItems.length > 3 && (
            <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>
              还有 {decisionItems.length - 3} 件
            </div>
          )}
        </div>
      )}

      {/* 项目卡栅格 */}
      {shown.length === 0 ? (
        <EmptyState title="这个筛选下没有项目" hint="换个筛选看看" />
      ) : (
        <div
          style={{
            display: 'grid',
            // ★ 手机用 minmax(0,1fr)：300px 最小宽在 390 屏上会横向溢出（实测会顶出去）
            gridTemplateColumns: isMobile
              ? '1fr'
              : 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 14,
          }}
        >
          {shown.map((v) => (
            <ProjectCard key={v.project.projectId} view={v} onOpen={() => onOpenProject(v.project)} />
          ))}
        </div>
      )}
    </>
  )
}
