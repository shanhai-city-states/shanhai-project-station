/**
 * lib/api.ts —— 前端 ← → 服务端 唯一调用层
 * =====================================================================
 * ★★ 本文件是前端**唯一**发请求的地方。
 *
 *   为什么不让组件各自 fetch：
 *   ① 错误处理会各写各的（有的报「加载失败」，有的静默）—— 客户看到一个界面两种口径
 *   ② 402/401/500 的区分会漏掉某一处 ⇒ 客户点「充值」充了个寂寞
 *   ③ 换 baseURL / 加鉴权头要改 N 处
 *
 * ★ 401 / 402 / 500 必分（第 3 批定的纪律，前端照此显示）：
 *   - 401 凭据无效 ⇒ 引导「重新登录 / 换 Key」
 *   - 402 余额不足 ⇒ 引导「去充值」（**客户能自己解决**）
 *   - 500 系统问题 ⇒ 引导「联系我们」（**客户做什么都没用，不许让他白充钱**）
 */

import type { Agent, Project, Task, ApiFailure, Message, StateEvent, AgentRole } from './contract'

/** API 基址 —— ★ 一律相对路径，不写死域名（开发/生产同源） */
const BASE = '/api'

/** 带鉴权的请求。token 为空时仍发（让服务端返 401，前端统一处理） */
async function request<T>(path: string, init: { method?: string; token?: string | null; body?: unknown } = {}): Promise<
  { ok: true; data: T } | { ok: false; failure: ApiFailure }
> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch (e) {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: e instanceof Error ? e.message : '网络不通',
      },
    }
  }

  return toResult<T>(res)
}

/**
 * 把 Response 转成统一的 `{ok, data}` / `{ok, failure}`。
 *
 * ★ 抽出来的理由（2026-11-24）：附件上传走 multipart，**不能**被 `request()` 的
 *   `JSON.stringify(body)` 和 `Content-Type: application/json` 包住 ——
 *   要是两处各写一套错误分流，迟早漂移成「JSON 请求报得准、上传报得糊」。
 *   ⇒ 错误口径只有这一份。
 */
async function toResult<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; failure: ApiFailure }> {
  // ── 错误分流（★ 每一种都绝不能混）──
  if (res.status === 401) {
    return { ok: false, failure: { kind: 'auth', message: '凭据无效或已过期' } }
  }
  /**
   * ★★★ 403 = 鉴权通过了，但**这个身份没资格做这件事**。
   *
   * 2026-11-23 补：原来没有这一支 ⇒ 403 落进下面的 `server-error`，
   * 于是页面显示「没建成，稍后再试」。
   * **阿开实测就撞在这个上**：他拿项目 Key 点「新建 Agent」，
   * 后端明明回了 403 +「只有铺主凭据能建 Agent」，
   * 前端却把它变成一句「稍后再试」—— 他既不知道是自己拿错了 Key，
   * 也不知道该怎么办，只能反复点。
   *
   * ★ 与 401 的区别必须分清：
   *   401 = 这枚 Key 我们不认（可能过期/撤销/打错）
   *   403 = 认得出你是谁，但你没这个权限（换 Key 才有用，重试没用）
   * 这两种给客户的下一步动作完全不同，混了就是让人干错事。
   */
  if (res.status === 403) {
    const body = (await safeJson(res)) as Record<string, unknown> | null
    return {
      ok: false,
      failure: {
        kind: 'forbidden',
        message:
          typeof body?.['message'] === 'string'
            ? (body['message'] as string)
            : '当前身份没有这个权限',
      },
    }
  }
  if (res.status === 402) {
    // ★ 402 要取出「差多少」，资源卡失败态要用
    const body = (await safeJson(res)) as Record<string, unknown> | null
    const shortfall = typeof body?.['needed'] === 'number' && typeof body?.['available'] === 'number'
      ? (body['needed'] as number) - (body['available'] as number)
      : 0
    return { ok: false, failure: { kind: 'insufficient-credits', shortfall } }
  }
  // ★★ 424 = 「状态已改，钱没结完」—— 不能当普通 server-error：
  //    它对客户的含义完全不同（*事情已经生效了*，只是账还没落），
  //    若显示成「操作失败」，客户会重复点，反而制造问题。
  if (res.status === 424) {
    const body = (await safeJson(res)) as Record<string, unknown> | null
    return {
      ok: false,
      failure: {
        kind: 'settlement-pending',
        message:
          typeof body?.['message'] === 'string'
            ? (body['message'] as string)
            : '操作已生效，但费用结算还没完成（系统会自动重试，不用重复提交）',
      },
    }
  }
  // ★ 409 = 状态冲突（比如任务已经被别人验收过 / 进度变了）—— 让客户刷新，不是系统坏了
  if (res.status === 409) {
    const body = (await safeJson(res)) as Record<string, unknown> | null
    /**
     * ★★★ 2026-11-24 修：409 原来只带 `message`，把 `error` 码和结构化载荷**全丢了**。
     *
     *   为什么必须带出来（古茶拍板 · 闸二）：
     *     归档被拒时后端返回 `{error:'has_open_tasks', openTasks:[...]}`。
     *     前端只拿 message 只能显示一句「还有 3 件没干完」——**说不出是哪 3 件**，
     *     客户不知道该去改派哪个任务，只能反复试点。
     *     古茶原话：「只报『不能归档』不告诉原因，用户会反复试。要显示『还有 N 个未结任务』。」
     *
     *   同理 `archived_irreversible` 也要让前端认得出是「不可恢复」这一类，
     *     才能用重语气提示（而不是和普通冲突一样轻描淡写）。
     *
     * ★ 保留 `code` 与 `detail`：`detail` 原样放后端 body，
     *   避免为每一种 409 都在这里加分支（新增错误码不用改这里）。
     */
    const code = typeof body?.['error'] === 'string' ? (body['error'] as string) : undefined
    return {
      ok: false,
      failure: {
        kind: 'conflict',
        message:
          typeof body?.['message'] === 'string' ? (body['message'] as string) : '这条任务的状态刚被改动，请刷新后重试',
        ...(code !== undefined ? { code } : {}),
        ...(body !== null ? { detail: body } : {}),
      },
    }
  }
  if (!res.ok) {
    const body = (await safeJson(res)) as Record<string, unknown> | null
    const reqId = res.headers.get('x-request-id')
    return {
      ok: false,
      failure: {
        kind: 'server-error',
        message: typeof body?.['message'] === 'string' ? (body['message'] as string) : `服务返回 ${res.status}`,
        requestId: reqId,
      },
    }
  }

  return { ok: true, data: (await res.json()) as T }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * 健康探针（不鉴权）—— 用于顶部「服务正常」点 + 右上角版本号。
 *
 * ★ 版本号和健康状态走 **同一个请求**：分开请求会多一次往返，且两处可能不同步
 *   （一个成功了另一个超时，就会出现「服务正常但版本号空着」）。
 *
 * ★★ 版本号唯一来源是服务端 package.json（经 /api/health 透出）。
 *   前端**不许自己写一份** —— 两处手写必然漏一处，界面就会显示旧版本号。
 */
export async function health(): Promise<{ ok: boolean; version: string | null }> {
  try {
    const r = await fetch(BASE + '/health')
    if (!r.ok) return { ok: false, version: null }
    const b = (await r.json()) as { ok?: boolean; version?: string }
    return {
      ok: b.ok === true,
      // ★ 缺字段就给 null（界面显示占位），**不编 "0.0.0"**
      version: typeof b.version === 'string' && b.version !== '' ? b.version : null,
    }
  } catch {
    return { ok: false, version: null }
  }
}

/**
 * 当前登录的是谁（顶栏显示账号用）—— 2026-11-23 阿开要求
 *
 * ★ 为什么单开一个端点而不是复用 health：
 *   health 不鉴权、不知道身份，顶栏要显示邮箱只能另问一次。
 * ★ 只回「租户名 / 联系邮箱 / 建号时间」，**不回任何凭据信息**。
 * ★ 三态返回而不是抛错：
 *   · null      → 没登录 / 凭据失效（顶栏就不显示账号区）
 *   · contact 为 null → 老租户没留邮箱（显示「未留联系方式」，不编一个假的）
 */
export async function getMe(
  token: string | null,
): Promise<{ tenantId: string; name: string; contact: string | null } | null> {
  if (!token) return null
  try {
    const r = await request<{ tenantId: string; name: string; contact: string | null }>('/me', {
      method: 'GET',
      token,
    })
    if (!r.ok) return null
    return r.data
  } catch {
    return null
  }
}

export async function listAgents(token: string | null) {
  return request<{ agents: Agent[] }>('/agents', { token })
}

/**
 * 拉一个项目的预算止损预警（横幅用）。
 *
 * ★★★ 为什么用轮询而不是 SSE（2026-11-24 古茶/阿开定）：
 *   横幅必须**一直显示**。SSE 推送不重放、漏了就永远漏 ——
 *   那会出现「明明超支了但横幅没出来」，而这个横幅的全部价值就在「一直在」。
 *   轮询没有「漏」这个问题：每次问都拿到当前真值。
 *
 * ★ 为什么要返回 notActive：
 *   阿开定「除非项目结束结算后再自动消失」。
 *   服务端把「项目已非 active」翻译成 notActive=true，前端据此不显示 ——
 *   前端不自己猜项目状态（那是两处各判，必漂移）。
 */
export interface BudgetAlertPayload {
  level: 'warn' | 'over'
  actual: number
  frozen: number
  warnAt: number
  overAt: number
  title: string
  status: string
  options: string[]
  triggeredAt: string
}

export async function getProjectAlert(
  token: string | null,
  projectId: string,
): Promise<{
  alert: BudgetAlertPayload | null
  notActive: boolean
  projectStatus: string
} | null> {
  if (!token) return null
  try {
    const r = await request<{
      alert: BudgetAlertPayload | null
      notActive: boolean
      projectStatus: string
    }>(`/projects/${encodeURIComponent(projectId)}/alerts`, { method: 'GET', token })
    if (!r.ok) return null
    return r.data
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════
// 每日签到（2026-11-24）
// ══════════════════════════════════════════════════════════════════

export interface DailyClaimStatus {
  /** 今天签过没有 */
  claimedToday: boolean
  /** 当前可用余额 */
  balance: number
  /** 每签一次给多少（服务端给，前端不写死） */
  amountPerClaim: number
}

/**
 * 查今天签了没有（进页面就问，决定按钮显示「签到」还是「今天已签」）。
 *
 * ★ 为什么要有这个 GET：不能等客户点了才知道。
 *   客户看到「签到」按钮点了才发现「今天签过了」—— 那是一次白点。
 */
export async function getDailyClaimStatus(
  token: string | null,
): Promise<DailyClaimStatus | null> {
  if (!token) return null
  try {
    const r = await request<DailyClaimStatus>('/credits/daily-claim', {
      method: 'GET', token,
    })
    if (!r.ok) return null
    return r.data
  } catch {
    return null
  }
}

/** 一笔积分流水（入账或消耗） */
export interface CreditRow {
  /** L<数字> 入账 / S<数字> 消耗 */
  id: string
  ts: string
  dir: 'in' | 'out'
  kind: string
  /**
   * ★ 对外两类口径（阿开 2026-11-24）：「充值积分」/「赠送积分」。
   *   服务端翻好，前端直接用 —— 不做翻译表（否则加一类来源要改客户端）。
   */
  kindLabel: string
  amount: number
  remaining: number
  reason: string
  /** ★ 服务端翻好的中文说明，前端直接用，不做翻译表 */
  title: string
  refId: string
  expiresAt: string | null
  expired: boolean
  revoked: boolean
}

/**
 * 区间汇总（独立聚合，**不受分页影响**）。
 *
 * ★ 为什么必须由服务端算：
 *   拿当前页 rows 累加 ⇒ 翻页看到的「本月消耗」会变 ⇒ 客户以为账错了。
 */
export interface CreditSummary {
  /** 区间内充值入账 */
  inPaid: number
  /** 区间内赠送入账（新手礼金 + 签到） */
  inGift: number
  inTotal: number
  /** ★ 区间内消耗 —— 「本月消耗」就是它 */
  spent: number
  /** 净变动 = inTotal − spent */
  net: number
  /**
   * ★ 此刻冻结中（派活预算占着、还没结算的额度）。
   *
   * 「净变动」是**账面**口径，「当前可用余额」是**账面 − 冻结**。
   * 两者天然差一个 frozen —— 不把它摆出来，客户会以为账算错了。
   * 注意：冻结额是**此刻状态**，不随日期筛选变化。
   */
  frozen: number
}

/**
 * 查积分流水。
 *
 * ★ 分页用游标（beforeId），不用 offset：
 *   账本边写边翻，offset 分页会漏行/重行。
 * ★ since/until 只传 YYYY-MM-DD 即可，服务端负责补 23:59:59
 *   （否则「截止今天」会漏掉今天整天的流水）。
 */
export async function getCreditsStatement(
  token: string | null,
  opts?: {
    limit?: number
    beforeId?: string
    since?: string
    until?: string
  },
): Promise<{
  rows: CreditRow[]
  nextBefore: string
  balance: number
  summary: CreditSummary
} | null> {
  if (!token) return null
  try {
    const q: string[] = []
    if (opts?.limit !== undefined) q.push(`limit=${String(opts.limit)}`)
    if (opts?.beforeId !== undefined && opts.beforeId !== '') {
      q.push(`before=${encodeURIComponent(opts.beforeId)}`)
    }
    if (opts?.since !== undefined && opts.since !== '') {
      q.push(`since=${encodeURIComponent(opts.since)}`)
    }
    if (opts?.until !== undefined && opts.until !== '') {
      q.push(`until=${encodeURIComponent(opts.until)}`)
    }
    const qs = q.length > 0 ? `?${q.join('&')}` : ''
    const r = await request<{
      rows: CreditRow[]
      nextBefore: string
      balance: number
      summary: CreditSummary
    }>(`/credits/statement${qs}`, { method: 'GET', token })
    if (!r.ok) return null
    return r.data
  } catch {
    return null
  }
}

/**
 * 签到。
 *
 * ★ 服务端对「今天已签」返回 200 + alreadyClaimed（不是错误码）——
 *   所以这里不能靠 HTTP 状态判成败，要看 body。
 */
export async function claimDaily(
  token: string | null,
): Promise<{
  ok: boolean
  claimed: boolean
  alreadyClaimed: boolean
  amount: number
  total: number
  message: string
}> {
  if (!token) {
    return { ok: false, claimed: false, alreadyClaimed: false, amount: 0, total: 0,
             message: '未登录' }
  }
  const r = await request<{
    claimed?: boolean
    alreadyClaimed?: boolean
    amount?: number
    total?: number
    message?: string
  }>('/credits/daily-claim', { method: 'POST', token })
  if (!r.ok) {
    // ★ ApiFailure 是联合类型，不是所有分支都有 message
    //   （insufficient-credits 只有 shortfall）。
    //   直接取 .message 编译不过 —— 那是类型在提醒我「这里有几种不同的失败」。
    const f = r.failure
    const msg = 'message' in f ? f.message : '签到失败'
    return { ok: false, claimed: false, alreadyClaimed: false, amount: 0, total: 0,
             message: msg }
  }
  const d = r.data
  return {
    ok: true,
    claimed: d.claimed === true,
    alreadyClaimed: d.alreadyClaimed === true,
    amount: d.amount ?? 0,
    total: d.total ?? 0,
    message: d.message ?? '',
  }
}

/**
 * ★★★ 建一个 Agent（雇人）—— 2026-11-23
 *
 * 语义边界（古茶定案 011）：**建是雇人，邀是派活。**
 * 本函数只把人加进租户的 Agent 库，**不碰任何项目**。
 * 建完它不属于任何项目 —— 要进项目必须另外调 `inviteAgent()`。
 *
 * ★ 权限：此接口**只认铺主凭据**（`kp_own_...`）。
 *   项目 Key 调它会 401/403 —— 项目通行证不能雇人（权限方向不能反）。
 *   失败时组件要能区分「权限不足」和「其他错误」，否则用户不知道该换凭据还是重试。
 */
export async function createAgent(
  token: string | null,
  input: { displayName: string; seat?: string | null },
) {
  return request<{ agent: Agent }>('/agents', {
    token,
    method: 'POST',
    body: { displayName: input.displayName, seat: input.seat ?? null },
  })
}

/**
 * 设置 / 取消某个 Agent 的「项目经理」角色（2026-11-24 阿开定）。
 *
 * ★★★ 只认铺主凭据 —— 后端第一道就是 `ownerIdentityOrReject`。
 *   项目经理**不能**给别人升权（否则他自己就能造出无限个经理）。
 *   ⇒ 这个按钮只在铺主登录时显示，项目通行证看不到。
 *
 * ★ 幂等：设成同一个角色返回 `changed: false`，不报错
 *   （网络重发不该看到红色 —— 用户会以为改失败了）。
 *
 * ★ 停用的 Agent 返回 409 `agent_inactive` —— 先启用再设角色。
 *   不给它「有经理头衔但干不了活」的中间态，那只会误导人。
 */
export async function setAgentRole(token: string | null, agentId: string, role: AgentRole) {
  return request<{
    agentId: string
    displayName: string
    role: AgentRole
    changed: boolean
    grantedAt?: string
    /** 后端把「能干什么 / 不能干什么」一并返回，前端显示在下拉旁边 */
    summary?: string
  }>(`/agents/${encodeURIComponent(agentId)}/role`, {
    token,
    method: 'PATCH',
    body: { role },
  })
}


/**
 * 改名（★ 只改显示名，工牌号永不动）—— 古茶拍板三：「改名不改号」。
 *
 * ★ 上限 30 字、**允许重名**。后端永远回 `idTail`，前端靠它区分两个同名 Agent。
 * ★ 幂等：名字没变时 `changed:false`，不当失败。
 */
export async function renameAgent(token: string | null, agentId: string, displayName: string) {
  return request<{
    agentId: string
    displayName: string
    changed: boolean
    /** 工牌号尾 4 位 —— 重名时显示成「小助手（…a3f2）」 */
    idTail: string
  }>(`/agents/${encodeURIComponent(agentId)}/name`, {
    token,
    method: 'PATCH',
    body: { displayName },
  })
}

/** Agent 账号状态（三档 · 与数据库 CHECK 同源：active/suspended/revoked） */
export type AgentAccountStatus = 'active' | 'suspended' | 'revoked'

/**
 * 改 Agent 状态：停用 / 恢复 / 归档。
 *
 * ★★★ 三档语义（古茶定案）：
 *   active    → suspended   停用＝**请假**（可恢复）
 *   suspended → active      恢复只恢复账号，**项目关系不恢复**（要重新邀请）
 *   *         → revoked     归档＝**离职**（**不可恢复**，但档案留着）
 *
 * ★ 归档前必须「无未结任务」——被拒时返回 409 `has_open_tasks`，
 *   `detail.openTasks` 里有具体任务清单，前端要列出来（古茶闸二）。
 */
export async function setAgentStatus(token: string | null, agentId: string, status: AgentAccountStatus) {
  return request<{
    agentId: string
    displayName: string
    from: string
    to: string
    changed: boolean
    idTail: string
    /** 停用时被移出的项目名 —— 古茶要求「弹窗逐个列项目名」，不能只说「3 个项目」 */
    removedFrom?: string[]
    /** 恢复时后端给的提示（说明「项目要重新邀请、旧凭据不复活」） */
    note?: string
  }>(`/agents/${encodeURIComponent(agentId)}/status`, {
    token,
    method: 'PATCH',
    body: { status },
  })
}


// ─────────────────────────────────────────────────────────
// 邀请 Agent 进项目（2026-11-23 · 古茶定案 011）
// ─────────────────────────────────────────────────────────

/** 已在这个项目里的 Agent */
export interface ProjectAgent {
  inviteId: string
  agentId: string
  displayName: string
  seat: string | null
  status: string
  /** 只给 8 位尾号 —— 明文只在邀请那一刻出现过一次 */
  keyHint: string
  expiresAt: string
  invitedAt: string
  invitedBy: string
}

/** 这个项目里有谁 */
export async function listProjectAgents(token: string | null, projectId: string) {
  return request<{ agents: ProjectAgent[] }>(`/projects/${projectId}/agents`, { token })
}

/**
 * 邀一个 Agent 进项目，发一枚只对这个项目有效的 Key。
 *
 * ★★ 返回值里的 `apiKey` **只有这一次能拿到** ——
 *   服务端只存 sha256，之后任何接口都查不到明文。
 *   调用方必须立刻把它展示给用户抄下来，**不许存进任何状态里等着以后用**。
 */
export async function inviteAgent(
  token: string | null,
  projectId: string,
  agentId: string,
) {
  return request<{ inviteId: string; agentId: string; apiKey: string; expiresAt: string; message: string }>(
    `/projects/${projectId}/invite`,
    // ★ body 传对象，不传 stringify 后的字符串 ——
    //   `request()` 内部会 JSON.stringify；再 stringify 一次就变成双层编码，
    //   服务端解析不出 agentId（2026-11-23 踩过：curlu 通、浏览器必失败）。
    { token, method: 'POST', body: { agentId } },
  )
}

/** 把这个 Agent 从本项目移除（只吊销这一枚 Key，其他项目不受影响） */
export async function removeProjectAgent(
  token: string | null,
  projectId: string,
  agentId: string,
) {
  return request<{ ok: boolean; message: string }>(
    `/projects/${projectId}/agents/${agentId}`,
    { token, method: 'DELETE' },
  )
}

// ─────────────────────────────────────────────────────────
// 自助注册（2026-11-23）
// ─────────────────────────────────────────────────────────

export interface SignupInput {
  /** 联系方式（邮箱/手机）—— 服务端只存 hash，原文不进库 */
  contact: string
  /** 项目名 —— 注册即建第一个项目 */
  projectName: string
}

/** 注册成功的返回。★ `apiKey` 明文**只出现这一次**，库里只有 hash。 */
export interface SignupResult {
  tenantId: string
  projectId: string
  /**
   * ★★★ 2026-11-23 阿开定：「注册也给的就是铺主 key，不给项目 key 了」
   *
   * 这枚是**人的凭据**（`kp_own_`）：能进后台、能建 Agent、能看自己全部项目。
   * 项目 Key 不再在注册时发 —— 它是发给 Agent 的机器凭据，
   * 等 Agent 被派进项目时由那条流程发。
   */
  ownerKey: string
  message: string
}

/** 被闸拦下的原因（与 guard.ts 的 reason 一一对应） */
export type SignupBlockReason =
  | 'breaker' // 全局熔断：当日消耗超了，谁来都不该再注册
  | 'contact_limit' // 同一联系人一天一次
  | 'ip_limit' // 同一 IP 防换号刷
  | 'daily_cap' // 日总量防批量
  | string // 服务端将来新增的闸，前端不该崩

/**
 * 自助注册（**不鉴权** —— 这是入口本身）。
 *
 * ★★ 为什么不走 `request()` 的错误分流：
 *   `request()` 把 429 归进 `server-error`，但对注册来说 429 **不是故障**，
 *   是「你被闸拦了」—— 客户要看到的是「同一邮箱今天已经领过了」这种人话，
 *   而不是「服务异常」。所以这里单独处理 429，取出服务端给的 `error` 与 `message`。
 *
 * ★ 500 也不许把技术细节甩给客户（同 App.tsx 文件头纪律）。
 */
export async function signup(
  input: SignupInput,
): Promise<
  | { ok: true; data: SignupResult }
  | { ok: false; kind: 'blocked'; reason: SignupBlockReason; message: string }
  | { ok: false; kind: 'bad-request'; message: string }
  | { ok: false; kind: 'network' | 'server' | 'misconfigured'; message: string }
> {
  let res: Response
  try {
    res = await fetch(BASE + '/signup', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: input.contact.trim(), projectName: input.projectName.trim() }),
    })
  } catch {
    return { ok: false, kind: 'network', message: '网络不通，检查一下连接' }
  }

  const body = (await safeJson(res)) as Record<string, unknown> | null

  if (res.status === 201) {
    // ★★★ 2026-11-23 阿开定：「注册也给的就是铺主 key，不给项目 key 了」
    //   所以现在看的是 `ownerKey`，`apiKey` 服务端显式返回 null（兼容位）。
    const ownerKey = typeof body?.['ownerKey'] === 'string' ? (body['ownerKey'] as string) : ''
    if (ownerKey === '') {
      // 201 却没有凭据 = 服务端契约坏了。不能当成功（客户会存下空 Key，进来就 401）
      return { ok: false, kind: 'server', message: '注册返回不完整，请联系我们' }
    }
    return {
      ok: true,
      data: {
        tenantId: typeof body?.['tenantId'] === 'string' ? (body['tenantId'] as string) : '',
        projectId: typeof body?.['projectId'] === 'string' ? (body['projectId'] as string) : '',
        ownerKey,
        message: typeof body?.['message'] === 'string' ? (body['message'] as string) : '',
      },
    }
  }

  const msg = typeof body?.['message'] === 'string' ? (body['message'] as string) : ''

  // 429 ⇒ 被闸拦（不是故障，人话直出）
  if (res.status === 429) {
    const reason = typeof body?.['error'] === 'string' ? (body['error'] as string) : 'blocked'
    return { ok: false, kind: 'blocked', reason, message: msg !== '' ? msg : '今天已经领过了' }
  }
  // 400 ⇒ 填的东西不合格（服务端只做粗校验，真正格式校验在前端）
  if (res.status === 400) {
    return { ok: false, kind: 'bad-request', message: msg !== '' ? msg : '填的内容不合规' }
  }
  // 500 + server_misconfigured ⇒ 我方没配好（不是客户的错，但也不能叫他等）
  if (res.status === 500 && body?.['error'] === 'server_misconfigured') {
    return { ok: false, kind: 'misconfigured', message: '注册功能还没开，请联系我们' }
  }
  return { ok: false, kind: 'server', message: '服务暂时不通，稍后再试' }
}

export async function listTasks(token: string | null, filter?: { projectId?: string; assignee?: string }) {
  const qs = new URLSearchParams()
  if (filter?.projectId) qs.set('projectId', filter.projectId)
  if (filter?.assignee) qs.set('assignee', filter.assignee)
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`
  return request<{ tasks: Task[] }>('/tasks' + suffix, { token })
}

/**
 * 拉单条任务 + 它的状态变更事件。
 *
 * ★ 为什么单独一个函数而不复用 `listTasks`：
 *   `GET /tasks/:id` 除了任务本身还返回 `events`（哈希链状态变更），
 *   这是任务详情页「反馈时间线」的数据来源之一。用 list 拿不到 events。
 */
export async function getTask(token: string | null, taskId: string) {
  return request<{ task: Task; events: StateEvent[] }>(
    '/tasks/' + encodeURIComponent(taskId),
    { token },
  )
}

/** 一个交付件（Agent 交给铺主的产物） */
export interface TaskAttachment {
  attachmentId: string
  filename: string
  sha256: string
  bytes: number
  /** 交件方的 agentId（ag_xxx）；铺主补传的会是 key 指纹 */
  uploadedBy: string
  uploadedAt: string
  /**
   * ★ 2026-11-24：这份文件是谁传的。
   *
   * - `owner-input`：**铺主**在派活表单里传的输入件（要求/参考资料）
   * - `agent-delivery`：**Agent** 交回来的交付物
   *
   * ★ 为什么必须分开显示：两者性质完全不同 ——
   *   「输入」是干活的依据，「交付」是干完的结果。
   *   混在一个列表里，人分不清「这是我要它做的」还是「这是它做出来的」。
   *
   * ★ 为什么是可选：老后端不返回时前端按交付物处理（不显示成输入件），
   *   宁可少显示一个标签，也不要把交付物说成「你传的」。
   */
  source?: 'owner-input' | 'agent-delivery'
  /** 下载路径（★ 只对铺主可用；Agent 用 sha256 自查） */
  downloadPath: string
}

/**
 * 列某条任务的全部交付件（2026-11-24 加）。
 *
 * ★★★ 为什么这个函数此前不存在 —— 一个真实的「件交了看不见」：
 *   后端 `pm_task_attachments` 表里早就躺着真件了
 *   （小砚交的设计说明 + UI 改稿 zip + 截图，Codex 交的 README + ACCEPTANCE + zip），
 *   **但只有 Agent 侧有一个「列附件」端点，铺主侧没有**。
 *   ⇒ 客观后果：Agent 传了、库里有、**铺主界面上一个都看不见**。
 *   阿开原话：「Codex交付和小砚交付的附件没看到」。
 *
 * ★ 为什么不让后端加宽 Agent 那条：那条要求「这条活必须派给你」（assignee 匹配），
 *   铺主没有 assignee，物理上进不去。加宽它会让 Agent 能看别人交的件（越权）。
 *   ⇒ 后端另开了 `GET /tasks/:taskId/attachments`（owner 白名单），前端调这条。
 */
export async function listTaskAttachments(token: string | null, taskId: string) {
  return request<{
    taskId: string
    count: number
    /**
     * ★ 2026-11-24：派活时要求的附件份数。
     * `null` = 不校验完整性（老任务 / 派活时没选文件）。
     * 前端用它显示「2 / 3 份」和「还差 1 份 · 补齐后才能验收」。
     */
    attachmentsExpected: number | null
    attachments: TaskAttachment[]
  }>(
    '/tasks/' + encodeURIComponent(taskId) + '/attachments',
    { token },
  )
}

export async function listProjects(token: string | null) {
  return request<{ projects: Project[] }>('/projects', { token })
}

/**
 * 新建项目（2026-11-24 加）。
 *
 * ★ 为什么这个函数此前不存在：后端一直没有 `POST /projects`——
 *   项目只在自助注册时建一个，之后再无入口。前端空状态却写着
 *   「从「＋ 新建项目」开始」，指向一个做不到的动作。
 *
 * ★ 编号（P-001/P-002…）由**服务端**算，前端不传：
 *   两处各算一次编号必然撞号（本仓记过「同一事实两处各算」）。
 */
export async function createProject(token: string | null, name: string) {
  return request<{ project: Project }>('/projects', {
    token,
    method: 'POST',
    body: { name },
  })
}

/**
 * 改项目名称（2026-11-24 加）。
 *
 * ★ 只允许改 name —— 编号/ID/状态不让客户端碰。
 *   能改的东西越少，越不可能被拿来越权（后端 WHERE 里还带着 tenant_id）。
 */
export async function renameProject(token: string | null, projectId: string, name: string) {
  return request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`, {
    token,
    method: 'PATCH',
    body: { name },
  })
}

// ─────────────────────────────────────────────────────────
// 验收三动作（2026-11-23）
// ─────────────────────────────────────────────────────────

/**
 * 对任务施加一个验收动作。
 *
 * ★★ 为什么不暴露「改状态」而只暴露三个动作：
 *   状态是开放的（能改成任意值），动作是有限的（三个）。
 *   前端能传 status ⇒ 后端就得信客户端的合法性判断 ⇒ 客户端可以跳过验收直接 accepted。
 *   服务端也只接受 action（见 repo.ts 的 VERDICT_ACTIONS）。
 *
 * ★ 返回里 alreadyTerminal=true 表示「本来就是终态，这次没动钱」（双击幂等）。
 *   424 会被 api.ts 归一成 settlement-pending —— 那是「生效了但账没落」，不是失败。
 */
export async function verdict(
  token: string | null,
  taskId: string,
  action: 'accept' | 'reject' | 'cancel',
  reason?: string,
) {
  return request<{
    taskId: string
    status: string
    alreadyTerminal: boolean
    settlement: {
      mode: 'settled' | 'released'
      tokens: number
      charged: number
      refunded: number
      available: number
    } | null
  }>('/tasks/' + encodeURIComponent(taskId) + '/verdict', {
    method: 'POST',
    token,
    body: { action, ...(reason !== undefined && reason !== '' ? { reason } : {}) },
  })
}

// ─────────────────────────────────────────────────────────
// 对话消息（2026-11-22 · 第 5 批补完）
// ─────────────────────────────────────────────────────────

/**
 * 拉某个项目的对话。
 *
 * ★ 游标 `after` 用于「SSE 收到通知后补消息」：
 *   只取这条之后的，避免每次通知都把整个对话重拉一遍。
 */
export async function listMessages(
  token: string | null,
  opts: { projectId?: string; taskId?: string; limit?: number; after?: string; before?: string } = {},
) {
  const qs = new URLSearchParams()
  if (opts.projectId !== undefined) qs.set('projectId', opts.projectId)
  if (opts.taskId !== undefined) qs.set('taskId', opts.taskId)
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit))
  if (opts.after !== undefined) qs.set('after', opts.after)
  if (opts.before !== undefined) qs.set('before', opts.before)
  const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`
  return request<{ messages: Message[] }>('/messages' + suffix, { token })
}

/**
 * 发一条消息。
 *
 * ★★ 不传 role：**role 由服务端决定**（客户发的永远是 client）。
 *   请求体带 role 服务端也会忽略（已实测），但前端也不该带 ——
 *   带了会让读代码的人以为「前端能指定角色」。
 */
export async function sendMessage(
  token: string | null,
  input: { projectId: string; content: string; taskId?: string | null },
) {
  return request<{ messageId: string; createdAt: string }>('/messages', {
    method: 'POST',
    token,
    body: {
      projectId: input.projectId,
      content: input.content,
      ...(input.taskId !== undefined && input.taskId !== null ? { taskId: input.taskId } : {}),
    },
  })
}

export interface DispatchInput {
  title: string
  projectId: string
  estimatedCredits: number
  assignee?: string | null
  detail?: string
  /**
   * 附件期望数（份）。**不传 = 不校验完整性**。
   *
   * ★ 2026-11-24 阿开定 · 两段式派活：
   *   第 1 段（本接口）只记「这条活该有几份附件」；
   *   第 2 段 `uploadTaskAttachmentReq` 真把文件传上去。
   * ★ 为什么先记数再传文件：两段之间会失败。没有这个数，
   *   系统分不清「传了一半」和「本来就只要一份」，验收时也就没法挡。
   */
  attachmentsExpected?: number
}

/** 派活（含冻结预算）。★ 402 由上层显示为「资源卡失败态」 */
export async function dispatchTaskReq(token: string | null, input: DispatchInput) {
  return request<{ taskId: string; holdId: number; frozenCredits: number; availableCredits: number }>('/tasks', {
    method: 'POST',
    token,
    body: input,
  })
}

/**
 * 给任务补传一份附件（两段式派活的第 2 段 · 阿开 2026-11-24）。
 *
 * ★ 为什么是「补传」而不是「一次传完」：
 *   任务要先建出来才有 taskId，文件才能挂到它下面。
 *
 * ★ 这个接口**可以反复调** —— 这就是「显式补传入口」的后端支撑：
 *   传失败、漏了、后来想起还要补一份，都走这里。
 *
 * ★ 返回里带 `attachmentsActual` / `attachmentsExpected` / `attachmentsComplete`，
 *   前端补传完立刻能把「2/3」更新成「3/3」，不用再拉一次列表。
 */
export async function uploadTaskAttachmentReq(
  token: string | null,
  taskId: string,
  file: File,
) {
  const fd = new FormData()
  fd.append('file', file)

  // ★★★ 为什么这里不调 `request()`（本仓已栽过两次的同一个坑）：
  //   `request()` 会**无条件** `Content-Type: application/json` + `JSON.stringify(body)`。
  //   FormData 被 stringify 会变成 `"{}"`，multipart 边界信息（boundary）也丢了
  //   ⇒ 服务端收到一个 2 字节的 JSON，报「表单解析失败」。
  //   ⇒ multipart 必须自己 fetch，但**错误分流复用 toResult**，不另写一套。
  let res: Response
  try {
    res = await fetch(BASE + '/tasks/' + encodeURIComponent(taskId) + '/attachments', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      // ★ 不手写 Content-Type —— 让浏览器自己带 multipart boundary
      body: fd,
    })
  } catch (e) {
    return {
      ok: false as const,
      failure: { kind: 'network' as const, message: e instanceof Error ? e.message : '网络不通' },
    }
  }
  return toResult<{
    attachmentId: string
    taskId: string
    filename: string
    sha256: string
    bytes: number
    uploadedAt: string
    attachmentsActual: number
    attachmentsExpected: number | null
    attachmentsComplete: boolean
    duplicate?: boolean
    message?: string
  }>(res)
}

export interface UsageInput {
  taskId: string
  phase: string
  model: string
  promptTokens: number
  completionTokens: number
  durationMs: number
}

export async function recordUsageReq(token: string | null, input: UsageInput) {
  return request<{ id: number; priced: boolean }>('/usage', { method: 'POST', token, body: input })
}

// ─────────────────────────────────────────────────────────
// Key 生命周期（2026-11-23）
// ─────────────────────────────────────────────────────────

/** 一把 Key 的对外视图。★ `keyHint` 只有 8 位，**明文永不出现在这里**（库里也没有） */
export interface KeyInfo {
  keyHint: string
  projectId: string
  agentId: string
  scope: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

export async function listKeys(token: string | null) {
  return request<{ keys: KeyInfo[]; now: string }>('/keys', { token })
}

/** 续期。★ days 只接受 1~365 的整数（服务端会拒 0/999/字符串） */
export async function renewKeyReq(token: string | null, keyHint: string, days: number) {
  return request<{ keyHint: string; expiresAt: string; days: number }>(
    '/keys/' + encodeURIComponent(keyHint) + '/renew',
    { method: 'POST', token, body: { days } },
  )
}

/** 吊销（不可逆）。★ 服务端拒绝吊销「当前正在用的这一把」⇒ 409 */
export async function revokeKeyReq(token: string | null, keyHint: string) {
  return request<{ keyHint: string; revokedAt: string }>(
    '/keys/' + encodeURIComponent(keyHint) + '/revoke',
    { method: 'POST', token },
  )
}

/**
 * 换发：发新 + 吊销旧，一步。
 *
 * ★★ 为什么不拆成两步给前端调：拆开做，中间失败就留下「两把都能用」的窗口。
 *   而这正是客户最需要可靠的那一步（怀疑 Key 泄露时）。
 */
export async function rotateKeyReq(token: string | null) {
  return request<{
    apiKey: string
    keyHint: string
    expiresAt: string
    revokedHint: string
    message: string
    /** 这枚 Key 归属的项目 —— 供「复制时带接入说明」拼出「只能用于哪个项目」 */
    projectId?: string
    projectName?: string | null
    agentId?: string
  }>('/keys/rotate', { method: 'POST', token })
}

// ══════════════════════════════════════════════════════════════════════
// 基线文件（附件）—— 需求说明书 / 技术方案
//
// ★ 后端端点早就建好了（2026-11-23 A 形态：字节写盘、按 sha256 命名），
//   但**前端一直没有入口** ⇒ 客户手上那份 Word 需求书传不进来，
//   于是「发布任务」这一步事实上卡住（阿开 2026-11-24 原话：
//   「需求页面应该支持上传附件还没实现。所以我还没发布任务。」）。
// ══════════════════════════════════════════════════════════════════════

/** 附件种类 —— ★ 只这两种（后端写死校验，多一个都会被 400 拒） */
export type BaselineKind = 'requirement' | 'adr'

/** 一个基线文件的元信息（★ 不含字节，字节要单独下载） */
export interface BaselineFile {
  fileId: string
  kind: BaselineKind
  version: number
  filename: string
  sha256: string
  bytes: number
  uploadedBy: string
  uploadedAt: string
  /** 已被新版取代时指向新版的 fileId；为 null 表示这是当前版 */
  supersededBy: string | null
  /** 锁定时刻；null = 未锁定。★ 锁定后不可覆盖、不可删除 */
  lockedAt: string | null
  /** 是否已锁定（后端算好的布尔，前端不再自己从 lockedAt 推） */
  locked: boolean
  /** 是否已作废（作废≠删除：字节和记录都还在） */
  voided: boolean
  /** 作废理由（作废时必填） */
  voidReason: string | null
}

/**
 * 上传项目附件。
 *
 * ★★ 用 `FormData` 而不是 JSON —— 不是风格选择，是能力边界：
 *   Word/图片塞不进 JSON（要么 base64 撑大 33%，要么读全文件进内存卡死标签页）。
 *
 * ★ 不设 `Content-Type`：浏览器要自己带 `multipart/form-data; boundary=...`。
 *   手动设了反而丢掉 boundary，服务端解析直接失败。
 *
 * ★★★ 2026-11-24 改：`kind` 从必填变成**可不传**。
 *
 *   阿开原话：「项目详情页：附件不是说合并成一个类型都往里传吗？」
 *   ⇒ 界面上只有一个框，不传 kind 时由后端 `src/baseline/classify.ts`
 *     按文件名自动归类（需求说明书 / 技术方案），**版本链不串**。
 *
 *   ★ 为什么仍允许传：自动归类是默认值，不是强制。若哪天要做「上传后手工改类」，
 *     或者 Agent 侧明确知道自己传的是什么，直接指定比让后端猜更准。
 *
 *   ★ 返回里带 `classifiedBy` / `matched` —— 前端据此显示「已归入 X（按文件名）」，
 *     人才能发现猜错并纠正。**没有这两个字段的归类是不可信的。**
 */
export async function uploadBaselineReq(
  token: string | null,
  projectId: string,
  kind: BaselineKind | undefined,
  file: File,
) {
  const form = new FormData()
  if (kind !== undefined) form.append('kind', kind)
  form.append('file', file)

  let res: Response
  try {
    res = await fetch(
      BASE + '/projects/' + encodeURIComponent(projectId) + '/baseline',
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      },
    )
  } catch (e) {
    return {
      ok: false as const,
      failure: { kind: 'network' as const, message: e instanceof Error ? e.message : '网络不通' },
    }
  }
  return toResult<{ file: BaselineFile }>(res)
}

/** 看这个项目有哪些基线文件（含历史版本，按 kind + version 倒序） */
/**
 * 确认锁定某一类附件（阿开 2026-11-24）。
 *
 * ★ 为什么要有这一步：上传 ≠ 确认。锁定之后不能再覆盖、不能再删除 ——
 *   这是「项目上下文不断片」的唯一保障。要改只能「作废」并写理由。
 */
export async function lockBaselineReq(
  token: string | null,
  projectId: string,
  kind: BaselineKind,
) {
  return request<{
    kind: BaselineKind
    fileId: string
    version: number
    lockedAt: string
    alreadyLocked: boolean
  }>('/projects/' + encodeURIComponent(projectId) + '/baseline/'
      + encodeURIComponent(kind) + '/lock', {
    method: 'POST',
    token,
  })
}

/**
 * 作废某一类附件的现行版（锁定后仍可作废，因为「锁只防手滑，不防改主意」）。
 *
 * ★ reason 必填，且**前端也要挡住空理由** —— 后端有 400 兜底，
 *   但让用户填完再被拒是很差的体验；更重要是「理由」这个动作本身要显式。
 */
export async function voidBaselineReq(
  token: string | null,
  projectId: string,
  kind: BaselineKind,
  reason: string,
) {
  return request<{
    kind: BaselineKind
    fileId: string
    version: number
    voidedAt: string
    voidReason: string
    note: string
  }>('/projects/' + encodeURIComponent(projectId) + '/baseline/'
      + encodeURIComponent(kind) + '/void', {
    method: 'POST',
    token,
    body: { reason },
  })
}

export async function listBaselineReq(token: string | null, projectId: string) {
  return request<{ files: BaselineFile[] }>(
    '/projects/' + encodeURIComponent(projectId) + '/baseline',
    { token },
  )
}

/**
 * 删掉某一类附件的**全部版本**（含历史），用于「传错了、重传」。
 *
 * ★ 为什么按种类整删而不是按 fileId 删：客户的动作是「这份传错了，换一份」，
 *   他要的是这一格清空，不是「挑出第 3 版删掉」。按 fileId 删要按三次，
 *   而且删中间版本会让版本链断。
 */
export async function deleteBaselineReq(
  token: string | null,
  projectId: string,
  kind: BaselineKind,
) {
  return request<{
    kind: BaselineKind
    rowsDeleted: number
    bytesDeleted: number
    bytesMissing: number
    warnings?: string[]
  }>('/projects/' + encodeURIComponent(projectId) + '/baseline/' + encodeURIComponent(kind), {
    method: 'DELETE',
    token,
  })
}

/** 从「我的 Agent」跳过来时带的预选人 —— 见 App.tsx Route.dispatchTo */

