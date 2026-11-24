/**
 * 097 · 山海 PM Agent · 前端 ← → 服务端 数据契约
 * =====================================================================
 * ★★ 本文件是**前端唯一的数据形状来源**，字段逐字对齐服务端 `src/db/schema.sql`。
 *
 *   ★ 纪律：不在组件里现编字段名。改契约先改这里，再改服务端，两边同一份。
 *     理由：同族事故 —— 前端写 `taskId`、后端给 `task_id`，报错是 `undefined`，
 *     不报错、不崩、只是什么都不显示。这类 bug 查起来最费时间。
 *
 * ★ 命名转换：DB 用 snake_case，前端用 camelCase。
 *   **转换只在一个地方做**（见 lib/api.ts 的 mapTask/mapAgent 等），
 *   绝不在组件里各自解构 —— 否则改一个字段要改 N 处。
 */

// ─────────────────────────────────────────────────────────
// 状态枚举（与服务端 CHECK 约束逐字对应）
// ─────────────────────────────────────────────────────────

/** `pm_tasks.status` —— 与服务端 CHECK 一致 */
export type TaskStatus =
  | 'pending'    // 待派
  | 'dispatched' // 已派出
  | 'running'    // 干活中
  | 'delivered'  // 已交件
  | 'accepted'   // 验收通过
  | 'rejected'   // 打回
  | 'cancelled'  // 取消

/** `pm_agents.status` */
/**
 * `pm_agents.status` —— Agent **账号**状态（三档 · 2026-11-24 订正）
 *
 * ★★★ 这里曾经写的是 `'retired'`，那是个**数据库里不存在的值**。
 *
 *   数据库 CHECK 实际是：
 *     `status IN ('active','suspended','revoked')`
 *
 *   而前端类型写 `'retired'` ⇒ 两处枚举对不齐，且是**静默的**：
 *     · 判 `a.status === 'revoked'` ⇒ TS 报「两个类型没有重叠」，
 *       看着像误报，实际是真错 —— 类型里根本没有 revoked 这一支。
 *     · 判 `a.status !== 'active'` 虽然能跑（剩下就只有 suspended），
 *       但一旦库里真的出现 revoked，所有 `!== 'active'` 的地方会把它
 *       当成「停用」处理 ⇒ **归档的人会出现在停用区，还可能被恢复**。
 *
 *   ⇒ 这不是笔误，是「代码有的值和 schema 有的值不是同一套」。
 *     同族的那次错在 `repo.ts`（`AND status != 'retired'` 恒为真，全库 32 条误导成客户可见 32 条）。
 *     **那次只修了过滤条件，没扫类型定义 —— 这次补上。**
 *
 * ★ 三档语义（古茶定案）：
 *   active    在用
 *   suspended 停用（请假，可恢复；**恢复不恢复项目关系**）
 *   revoked   归档（离职，**不可恢复**；档案保留）
 *
 * ★★ 改这个类型前，先去数据库读 CHECK：
 *      `SELECT sql FROM sqlite_master WHERE name='pm_agents'`
 *    后端是从 sqlite_master 反推表结构的，
 *    不硬编码 —— 那里才是真值来源，本行只是它的前端投影。
 */
export type AgentStatus = 'active' | 'suspended' | 'revoked'

/**
 * `pm_agents.role` —— Agent 角色（2026-11-24 阿开定）
 *
 * ★★ 必须与后端 `tasks/agent-roles.ts` 的 `AGENT_ROLES` 逐字一致。
 *   两处枚举对不齐是**静默**的：后端存 'manager'，前端判 'admin'
 *   ⇒ 界面永远显示「执行方」，而权限其实已经给了 —— 最坏那种错。
 *
 * ★ worker = 执行方（默认，只能干自己被派的活）
 *   manager = 项目经理（可建项目、可建派任务、可看项目内全部任务与附件、可传交付件）
 *
 * ★★★ 两条硬边界（写进类型注释，防止以后有人往这儿加值）：
 *   manager **不能**验收任何任务（自己的也不行）、**不能**动积分/账单、
 *   **不能**改需求书、**不能**改别的 Agent 凭据。
 *   ⇒ 所以这里永远只有两个值，不要再加 'admin' / 'owner'。
 */
export type AgentRole = 'worker' | 'manager'


/** `projects.status` */
export type ProjectStatus = 'active' | 'archived'

/**
 * ★ Agent 在场状态（前端展示用，非 DB 字段）
 *
 * ★★ 与 `AgentStatus` 的区别（容易混，写清）：
 *   - `AgentStatus` = **账号层面** 有效/停用/退役（数据库里真有这个字段）
 *   - `Presence`    = **此刻在不在干活**（由任务状态推导，不落库）
 *   把两个混成一个 ⇒ 「已退役」和「今天没任务」都显示成灰点，客户分不清是坏了还是闲着。
 */
export type Presence = 'busy' | 'idle' | 'blocked' | 'offline'

// ─────────────────────────────────────────────────────────
// 实体
// ─────────────────────────────────────────────────────────

/** `pm_agents` + 前端推导字段 */
export interface Agent {
  agentId: string
  tenantId: string
  /** 客户看到的名字（★ DB 注释原文：「客户看到的名字」） */
  displayName: string
  /** 席位标识，可空 */
  seat: string | null
  /** 账号状态（DB 真字段） */
  status: AgentStatus
  createdAt: string

  /**
   * ── 角色（2026-11-24 阿开定「项目经理」）──
   *
   * ★★ worker = 执行方（默认）／manager = 项目经理。
   *
   * ★ 为什么是 Agent 的属性而不是「项目里的身份」：
   *   阿开原话「增加一个设置管理员的权限的开关或者按钮，这样可以任意指定项目经理」。
   *   身份跟着人走，不跟着项目走 —— 同一人在 A 项目当经理、B 项目当执行方，
   *   是两张通行证的事，不是两个角色的事。
   *
   * ★ 未知值一律按 worker 算（后端已兜底，前端再兜一层）——
   *   权限判断默认必须往小的一边倒，绝不能因为字段没读到就当经理。
   */
  role: AgentRole
  /** 谁授的（铺主凭据 hash）；worker 时为 null */
  roleGrantedBy: string | null
  /** 何时授的 */
  roleGrantedAt: string | null

  // ── 以下由前端从任务推导，不落库 ──
  /** 此刻在干什么（由正在跑的任务推出） */
  presence: Presence
  /** 正在干的项目名（无任务时 null） */
  currentProject: string | null
  /**
   * 正在干的项目 **ID**（2026-11-22 补）
   * ★ 拉对话要用它（GET /messages?projectId=），只有名字不够 —— 名字可能重复
   */
  currentProjectId: string | null
  /** 正在干的事（「取数」「填表」），与 presence 配套 */
  currentAction: string | null
  /**
   * ★ 多项目并行时的额外项目数（阿开 2026-11-22 甲案）
   *   一个 Agent 同时在 N 个项目 ⇒ 显示主要那个 + `+N`
   *   ★ 为 0 时不显示徽标 —— 单项目客户不该看到「重复的项目名」
   */
  extraProjectCount: number
}

/** `projects` */
export interface Project {
  projectId: string
  tenantId: string
  name: string
  /**
   * 人类可读编号（P-001）。★ 2026-11-23 阿开定
   *
   * 为什么允许 null：老库的项目是加列后回填的，回填前是 NULL。
   * ⇒ 前端必须兜住 null（显示「编号待分配」），**不许显示 "null"**。
   */
  code: string | null
  status: ProjectStatus
  createdAt: string
  /**
   * ★★ 项目级任务计数（2026-11-23 新增，服务端聚合）
   *
   *   为什么需要：按 Agent 可见性过滤后 `/tasks` 只返回自己名下的任务，
   *   项目卡若用「可见任务数」当进度，铺主会看到「0 / 1」而库里其实有 3 个，
   *   于是误以为活没派。
   *
   *   ⇒ 计数与内容分开：**计数是同租户内真实值，内容仍受可见性约束。**
   *   ★ 老服务端不返回这几个字段时为空，前端必须用 `?? 0` 兜底（不许显示 NaN）
   */
  taskTotal?: number | undefined
  taskDone?: number | undefined
  taskPendingAccept?: number | undefined
  taskUnassigned?: number | undefined
}

/** `pm_tasks` */
export interface Task {
  taskId: string
  tenantId: string
  projectId: string
  title: string
  detail: string | null
  status: TaskStatus
  /** 指派的 Agent；null = 未指派（公共池） */
  assignee: string | null
  /**
   * ★ 2026-11-24 加：被派 Agent 的**显示名**（`pm_agents.display_name`）。
   *
   * 为什么要有它：`assignee` 是 `ag_mwtbd4si_yrr3ylgf` 这种内部 ID，
   * 客户看不懂。阿开实测报「Agent 列显示的不是名字」——「雇人」时起的名字全丢了。
   *
   * ★ 可空。取不到时前端**退回显示 `assignee`**，不是显示空白：
   *   空白会让客户以为「这活没派出去」，比看到 ID 更误导。
   */
  assigneeName: string | null
  /**
   * ★ 2026-11-24 加：所属项目名（服务端 JOIN 带出）。
   *
   * 为什么加：前端做了 URL 路由后，直接打开 `/tasks/tk_xxx` 时只知任务 id，
   * 面包屑「项目 / ? / 任务」中间那段无从得知 —— 实测显示成 `项目 / / 任务`
   * （中间空一段，看着像坏了）。
   * ★ 可空：老后端不返回这个字段时退化为 undefined，面包屑退回「任务」。
   */
  projectName?: string | null
  /**
   * ★ 2026-11-24 加：这条任务挂了几份附件。
   *
   * 阿开原话：「按 A 走这样干净，但是在每个任务背后增加（XX个附件）
   * 你觉得有没有必要，方便人类识别」——**有必要，人不用点进去就知道里面有没有东西。**
   *
   * ★ 为什么由后端算：任务列表 N 行，前端逐行拉附件就是 N 次请求（N+1）。
   *   后端 `listTasks` 用聚合子查询顺手带出，零额外往返。
   * ★ 可选：老后端不返回时退化 undefined，前端按 0 处理（不显示标签）。
   */
  attachmentCount?: number
  /** 凭据 ID（谁派的） */
  createdBy: string
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  acceptedAt: string | null
  /** ★ 谁验收的 —— 与 assignee 分离（AC 保证：派活的人不能自己签字） */
  acceptedBy: string | null
  archivedAt: string | null
}

/** `acceptance_criteria` */
export interface AcceptanceCriterion {
  id: string
  projectId: string | null
  /** null = 项目级判据 */
  taskId: string | null
  level: 'project' | 'task'
  /** 结构化判据（JSON 字符串，服务端已校验过格式） */
  criteria: string
  /**
   * ★★ 判据来源 —— 只许 `library:<id>`
   *   这是「PM 不得自编验收标准」的落地证据：
   *   前端只要看到 source 不是 `library:` 开头 ⇒ 应当拒绝显示（服务端更该拒绝存）
   */
  source: string
  createdAt: string
}

/** `state_events` —— 状态轨迹（含 sha 链） */
export interface StateEvent {
  eventId: string
  tenantId: string
  projectId: string
  entityType: string
  entityId: string
  fromState: string | null
  toState: string
  /** ★ 谁改的（服务端注入，不来自请求体） */
  actor: string
  at: string
  /** 链式指纹 —— 可 diff / 可回溯 */
  prevSha256: string | null
  thisSha256: string
}

/** `llm_usage` —— 成本记录（第 5 批之前已建，用于定价实测） */
export interface LlmUsage {
  id: number
  taskId: string
  /** 阶段标识（如 `plan` / `decompose` / `verify`） */
  phase: string
  /** ★ 必填：不同模型单价差几十倍 */
  model: string
  promptTokens: number
  completionTokens: number
  durationMs: number
  /** 单价（元/千 token），null = 尚未定价 */
  priceIn: number | null
  priceOut: number | null
  at: string
}

/** `artifacts` —— 交付件 */
export interface Artifact {
  artifactId: string
  projectId: string
  taskId: string | null
  agentId: string
  sha256: string
  path: string
  createdAt: string
}

// ─────────────────────────────────────────────────────────
// 对话流（界面主形态：右对话 + 对话内卡片）
// ─────────────────────────────────────────────────────────

/**
 * ★ 对话条目 —— 「聊天是常态，卡片是插曲」（README §3.2）
 *   三种卡片只在**需要人拍板时**插入对话流，不常驻。
 */
export type ChatItem =
  | { kind: 'message'; at: string; from: 'human' | 'pm'; text: string }
  /**
   * 资源确认卡 —— **含预算段**（★ 不是单独一张预算卡）
   *   阿开定案：预算并入资源确认卡；「预算冻结失败」是本卡就地转的失败终态。
   */
  | {
      kind: 'resource-confirm'
      at: string
      /** 预估费用（元）。null = 还没算出来 ⇒ 不许显示「¥0」冒充「免费」 */
      estimatedCost: number | null
      /** 预估消耗 token 数 */
      estimatedTokens: number | null
      /** 冻结结果；null = 还没冻结 */
      freeze: FreezeResult | null
    }
  /** API Key 卡 —— 交付给客户的接入凭据 */
  | {
      kind: 'api-key'
      at: string
      /** ★ 只在签发那一刻显示一次全文；之后只显示前缀 */
      keyPrefix: string
      /** 完整 key —— 只在**刚签发**的这一条里存在，刷新后必须为 null */
      fullKey: string | null
      expiresAt: string
    }
  /** 验收红绿灯 */
  | {
      kind: 'acceptance'
      at: string
      taskId: string
      verdict: VerdictKey | null
      /** 逐条判据结果 */
      checks: Array<{ id: string; label: string; pass: boolean; detail: string | null }>
    }

/** 资源确认卡的冻结结果（★ 失败是终态，不是另一张卡） */
export interface FreezeResult {
  ok: boolean
  /** 已冻结金额 */
  frozen: number
  /** 差多少（失败时才有意义） */
  shortfall: number | null
  /** 失败原因码 —— 与后端 FreezeFailureCode 一致 */
  code: string | null
}

import type { VerdictKey } from '../styles/tokens'

// ─────────────────────────────────────────────────────────
// API 响应包封
// ─────────────────────────────────────────────────────────

/**
 * ★★ 402 必须与 500 分开（第 3 批已定的纪律，前端也照此显示）
 *   - 余额不足（402）：客户**能自己充值解决** ⇒ 给「去充值」的引导
 *   - 部署问题（500）：客户**做什么都没用** ⇒ 给「联系我们」，不许让他白充钱
 */
export type ApiFailure =
  | { kind: 'insufficient-credits'; shortfall: number }
  | { kind: 'server-error'; message: string; requestId: string | null }
  | { kind: 'auth'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'network'; message: string }
  /**
   * 424：操作**已生效**、费用结算未完成。
   * ★ 与 server-error 语义相反 —— server-error 是「没做成」，
   *   这个是「做成了，账还没落」。文案必须能区分，否则客户会重复点。
   */
  | { kind: 'settlement-pending'; message: string }
  /** 409：状态冲突（任务已被别人验收 / 状态刚变）—— 引导刷新，不是系统坏了 */
  | {
      kind: 'conflict'
      message: string
      /**
       * 后端错误码（如 `has_open_tasks` / `archived_irreversible`）。
       *
       * ★ 为什么 409 也要带码（2026-11-24 补）：
       *   「冲突」是一大类，但客户要做的动作完全不同 ——
       *     `has_open_tasks`      ⇒ 去改派任务，**不是刷新**
       *     `archived_irreversible` ⇒ 死路，只能雇新人
       *   只给一句 message，前端只能一律说「刷新后重试」，
       *   而归档被拒时刷新一万次也没用。
       */
      code?: string
      /** 后端原始 body —— 放结构化载荷（如 openTasks 清单），新增错误码不必改类型 */
      detail?: Record<string, unknown>
    }
  /**
   * 403：**身份认得出，但没这个权限**（2026-11-23 补）
   *
   * ★ 与 `auth`(401) 的区别是给客户的下一步动作完全不同：
   *   401 ⇒ 换 Key（这枚不认了）
   *   403 ⇒ 换**身份**（这枚 Key 有效，但它不该做这件事）
   *
   * ★ 少了这一支会怎样（实证）：403 落进 `server-error` 兜底，
   *   页面显示「没建成，稍后再试」⇒ 用户拿着项目 Key 反复点「新建 Agent」，
   *   永远建不出来，而且永远不知道原因。**隐藏真因比报错更有害。**
   */
  | { kind: 'forbidden'; message: string }

// ─────────────────────────────────────────────────────────
// 对话消息（与后端 MessageRow 逐字段对应 · 2026-11-22）
// ─────────────────────────────────────────────────────────

/**
 * 一条消息。
 *
 * ★★ role 三值必须与后端 CHECK 一致：client / pm / system
 *   后端 `pm_messages.role` 的 CHECK 就是这三个，前端类型若写成别的
 *   （比如 'human'），会在运行时发现「有消息但渲染不出来」——
 *   类型对不齐是**静默**的，所以这里逐字对齐后端。
 */
export interface Message {
  messageId: string
  tenantId: string
  projectId: string
  taskId: string | null
  role: 'client' | 'pm' | 'system'
  content: string
  usageId: number | null
  createdAt: string
}

/**
 * 任务上「Agent」这一列该显示什么 —— **唯一口径**。
 *
 * ★★ 为什么抽成函数而不是三处各写一遍：
 *   任务列表、任务详情、项目卡三处都要显示「这活派给谁了」。
 *   三处各写 `t.assigneeName ?? t.assignee ?? '未派'`，
 *   改一次口径要改三处 ⇒ 必漂移（本仓记为「同一语义 ≥2 处实现必漂移」）。
 *
 * ★ 优先级：显示名 > 内部 ID > 「未派」
 *   · 取不到名字时**退回 ID 而不是空**：空白让客户以为没派出去，比看到 ID 更误导
 *   · 真的没人（assignee 为 null）才说「未派」——这是「公共池」，语义不同
 */
export function assigneeLabel(t: { assignee: string | null; assigneeName?: string | null }): string {
  if (t.assignee === null) return '未派'
  const name = t.assigneeName
  if (typeof name === 'string' && name.trim() !== '') return name.trim()
  return t.assignee
}

/**
 * 任务状态 → 胶囊色调 + 中文标签 —— **唯一口径**。
 *
 * ★★ 为什么搬到 contract 而不是留在 ProjectDetailPage：
 *   项目页的任务列表、任务详情页的状态条、状态变更记录三处都要显示状态。
 *   三处各写一份中文表 ⇒ 必漂移（本仓已记多次：「同一语义 ≥2 处实现必漂移」）。
 *
 * ★ 2026-11-24 阿开实测：任务详情页的「状态变更」直接显示
 *   `pending:ag_xxx → delivered` 这种代码 —— 客户看不懂，也不知道发生了什么。
 */
export const STATUS_CHIP: Record<
  TaskStatus,
  { tone: 'pass' | 'warn' | 'fail' | 'info' | 'muted'; label: string }
> = {
  pending: { tone: 'muted', label: '待认领' },
  dispatched: { tone: 'muted', label: '已派出' },
  running: { tone: 'info', label: '进行中' },
  delivered: { tone: 'warn', label: '待验收' },
  accepted: { tone: 'pass', label: '已通过' },
  rejected: { tone: 'fail', label: '已打回' },
  cancelled: { tone: 'muted', label: '已取消' },
}

/**
 * 把 `state_events` 里的状态串翻成中文 —— **容忍未知值**。
 *
 * ★ 为什么不能直接 `STATUS_CHIP[s].label`：
 *   `state_events` 是**多实体共用**的轨迹表（entity_type 有 project/task/phase/agent/template），
 *   里面真实存在 `active` / `rotated` / `expires:2026-12-23T10:45:40.899Z` 这类值。
 *   用任务状态表硬查 ⇒ 拿不到 ⇒ 显示 undefined 或英文原码。
 *
 * ★ 未知值不丢：返回原串。宁可显示一个客户看不懂的词，
 *   也好过显示空白 —— 空白会让人以为「这一步没发生」。
 */
export function statusLabel(s: string | null): string {
  if (s === null || s === '') return '—'
  if (s in STATUS_CHIP) return STATUS_CHIP[s as TaskStatus].label
  // ★ 凭据状态的两种额外值（真实存在于 state_events）
  if (s === 'active') return '有效'
  if (s === 'rotated') return '已轮换'
  if (s === 'revoked') return '已撤销'
  // `expires:<ISO>` ⇒ 「到期 2026-12-23」
  const m = /^expires:(.+)$/.exec(s)
  if (m !== null) {
    // ★ `m[1]` 在 noUncheckedIndexedAccess 下是 `string | undefined` —— 必须显式取。
    //   直接 `new Date(m[1])` 编译不过，而 `m[1]!` 是把「可能没有」硬蹾掉，
    //   这里是判过 m 非 null 之后才取，取到 undefined 时下面的 isNaN 会兜住。
    const raw = m[1]
    const d = new Date(raw ?? '')
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `到期 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    return '到期时间已更新'
  }
  // `pending:ag_xxx` 这类「状态:附属信息」⇒ 只翻状态部分，附属信息不丢但收在后面
  const colon = s.indexOf(':')
  if (colon > 0) {
    const head = s.slice(0, colon)
    if (head in STATUS_CHIP) return STATUS_CHIP[head as TaskStatus].label
  }
  return s
}

/**
 * 状态变更里的「谁做的」→ 能看懂的短串。
 *
 * ★ 2026-11-24 阿开实测：这一列原来是完整 sha256（64 字符），
 *   单独一个值就把右栏撑出横向滚动条，而且人读不出这是谁。
 *
 * ★ 三种真实形态：
 *   · `tenant:t1`              → 原样显示（本来就短且可读）
 *   · 64 位十六进制（凭据哈希）→ 露前 8 位 + 「…」，完整值放 title 悬停看
 *   · 其他                     → 超过 16 字才截
 *
 * ★ 为什么只截显示不丢数据：这是**审计轨迹**，完整值必须留在 DOM 的 title 里，
 *   将来要追责时还能拿到原值。截断只是排版，不是删数据。
 */
export function actorLabel(actor: string | null): string {
  if (actor === null || actor === '') return '—'
  if (actor.startsWith('tenant:')) return actor
  if (/^[0-9a-f]{32,}$/i.test(actor)) return `${actor.slice(0, 8)}…`
  if (actor.length > 16) return `${actor.slice(0, 16)}…`
  return actor
}
