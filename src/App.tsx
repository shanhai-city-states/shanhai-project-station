/**
 * 097 · App 主壳 —— 任务大厅（列表为主，对话为辅）
 * =====================================================================
 * ★★★ 本文件是**换壳**，不是改壳。看这段注释的人需要知道为什么。
 *
 *   旧壳（至 2026-11-23）：「左 Agent 列表 + 右对话」，依据是阿开 2026-11-22 口述
 *     「参考 Grok bot / 飞书，左侧 Agent 好友列表，右边沟通」——
 *     **那是 stub 期的形态判断**（当时后端还没有 HTTP 层，先搭个壳看效果）。
 *
 *   新产品形态（小D 2026-11-23 拍板）：「**列表为主，对话为辅**」
 *     理由原文：「097 的核心是『PM 派发任务 → Agent 领活 → 交活 → 质检』，
 *               这是**任务流**，不是聊天流。『对话为主』是聊天工具的形态。」
 *
 *   ⇒ 所以旧的「右对话」不再是主界面，降级为 **P3 任务详情页里的「反馈」区**。
 *     这不是把东西删了，是**把它放到该在的位置**。
 *
 * ★★ 本文件从旧壳保留了什么（都是踩过坑换来的，不许丢）
 *
 *   ① 没凭据时**不发请求**、直接进「接入」态
 *      旧注释原文：「原实现先发请求再按 401 分流 ⇒ 网络不通时落到『服务不可达』，
 *                   客户看不到『填入 Key』的入口，只看到报错 —— 第一次进来的人直接卡死。」
 *   ② 401 / 402 / 网络 **分别处理**
 *      旧注释原文：「402 不能落进『服务异常』，否则客户看到『服务异常』，
 *                   不知道其实是自己余额不够 —— 会去反复重试而不是充值。」
 *   ③ 版本号来自 /api/health，**取不到就不显示**（不编 0.0.0）
 *   ④ 服务健康探针与数据加载**分开**（一个挂了不掩盖另一个）
 *
 * ★ 凭据放哪：localStorage（★ stub 期临时方案，正式版要走登录换短期票据 —— 见 README §九）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from './lib/contract'
import { health, listAgents, getMe, listProjects, getTask } from './lib/api'
// ★ URL ↔ 路由状态的唯一映射（2026-11-24）。别处不许自己拼 URL。
import { pathOf, parsePath, parseHash } from './lib/router'
import type { UrlRoute } from './lib/router'
import { T } from './styles/tokens'
import { AppShell } from './components/AppShell'
import type { NavKey } from './components/AppShell'
// ★ EmptyState 已不用（积分/账单页做出来了，最后一个占位消失）
import { ProjectListPage } from './pages/ProjectListPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { SignupPage } from './pages/SignupPage'
import { KeysPage } from './pages/KeysPage'
import { AgentsPage } from './pages/AgentsPage'
// ★ 2026-11-24：AgentLibraryPage（雇人）已并入 AgentsPage（我的 Agent），
//   不再 import。文件保留在磁盘上（内容已被合并页吸收，留作历史参照），
//   删文件要走归档流程，不在这次改动里做。
import { BillingPage } from './pages/BillingPage'

const TOKEN_KEY = 'pm097.token'

type Route =
  | { name: 'projects' }
  | {
      name: 'project'
      project: Project
      /**
       * ★ 从「我的 Agent」点「派活」带过来的预选人（2026-11-24 阿开定）。
       *   项目详情页把它透传给 DispatchTaskPanel 的 initialAgentId。
       *   ★ 只在派活跳转时存在；正常从项目列表进来是 undefined。
       */
      preselectAgentId?: string | undefined
    }
  | { name: 'task'; taskId: string; projectName: string }
  /** ★ 注册页是**未鉴权**的路由（没有 Key 才走得到这里），所以它不在 AppShell 里 */
  | { name: 'signup' }

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // 隐私模式/禁用 storage ⇒ 不崩，当作没登录
    return null
  }
}

export function App() {
  const [token, setTokenState] = useState<string | null>(readToken())
  const [route, setRoute] = useState<Route>({ name: 'projects' })
  const [nav, setNav] = useState<NavKey>('projects')

  /**
   * 待恢复的路由（来自 URL，需要拉数据才能补齐的：项目详情 / 任务详情）。
   *
   * ★ 为什么单独放一个 state 而不是直接在 popstate 里 setRoute：
   *   `Route.project` 要完整 Project 对象，URL 里只有 id。
   *   拉数据是异步的，而且**要等凭据验过**（没验过拉了也 401）。
   *   ⇒ 先把「要恢复成什么」记下来，等 `gate === 'ok'` 那个 effect 去兑现。
   */
  const [pendingRestore, setPendingRestore] = useState<UrlRoute | null>(null)

  /**
   * URL 恢复是否已完成（只做一次）。
   *
   * ★★★ 为什么需要这个 ref（2026-11-24 实测踩的坑）：
   *   第一版没有它，effect 逻辑是「pendingRestore 为 null ⇒ 读 URL 设 pendingRestore」。
   *   跑起来变成**死循环**：
   *     挂载 → pendingRestore=null → 读 URL(/tasks/x) → setPendingRestore(task)
   *      → effect 再跑 → 兑现恢复 → setPendingRestore(null)
   *      → effect 再跑 → pendingRestore 又是 null → **又读 URL → 又 setPendingRestore(task)**
   *   症状：`/api/tasks/tk_xxx` 被请求两次，页面数据闪一下，
   *   而且 `onLoaded` 回填的项目名**下一秒又被恢复流程覆盖成空串**（面包屑永远是「任务」）。
   *   ⇒ 用 ref 记住「已经恢复过」，恢复流程只走一次。
   */
  const urlRestoredRef = useRef(false)

  // ══════════════════════════════════════════════════════════════════
  // URL 同步（2026-11-24 阿开实测「URL 永远是根路径」）
  // ══════════════════════════════════════════════════════════════════
  //
  // 【改前】状态全在 useState，URL 永远 `/`。后果：刷新回首页、链接不能分享、
  //   后退键没用。而这直接决定「复制任务 ID 发给对方」能不能闭环 ——
  //   对方打开落不到那条任务上，ID 的价值就打折。
  //
  // 【做法】不改那 13 处 setRoute 调用，而是在它外面包一层：
  //   · `goRoute(next)` = 设 state + 推 URL（一处收口，13 处调用点全部受益）
  //   · 后退/前进 → popstate → 解析 URL → 设 state
  //   · 首次挂载 → 解析当前 URL（刷新能落回原处）
  //
  // 【为什么不直接把 `route` 当唯一真相、URL 由它派生】
  //   `Route.project` 是整个 Project 对象，URL 里只有 id。
  //   刷新时 URL 里没有对象 ⇒ 必须去服务端拉。所以 state 仍是内存真相，
  //   URL 是**它的投影**；恢复时反向「id → 拉数据 → 补齐对象」。
  // ══════════════════════════════════════════════════════════════════

  /** 把 state 里的 route 投影成 URL（不触发渲染） */
  const urlOfRoute = useCallback((r: Route): string => {
    switch (r.name) {
      case 'projects':
        return pathOf({ name: 'projects' })
      case 'project':
        return pathOf({ name: 'project', projectId: r.project.projectId })
      case 'task':
        return pathOf({ name: 'task', taskId: r.taskId })
      case 'signup':
        return pathOf({ name: 'signup' })
    }
  }, [])

  /**
   * ★ 改路由的唯一入口。
   *
   *   `replace=true` 用于「同一逻辑页内的参数变化」（比如改名后重拉），
   *   不往历史里塞一条 —— 否则用户要按好几次后退才出得去。
   */
  const goRoute = useCallback(
    (next: Route, opts?: { replace?: boolean }) => {
      setRoute(next)
      const url = urlOfRoute(next)
      if (window.location.pathname === url) return
      try {
        if (opts?.replace === true) window.history.replaceState({}, '', url)
        else window.history.pushState({}, '', url)
      } catch {
        // ★ 某些沙箱 iframe 里 history 会被拒。**不让它影响页面切换** ——
        //   URL 没变只是不能分享，页面该走还得走。
      }
    },
    [urlOfRoute],
  )

  // ── 启动恢复 + 后退键 ──
  //
  // ★ 启动时 `restoreFromUrl()` 只处理**能立刻恢复**的路由（项目列表 / 注册页）。
  //   项目详情和任务详情要拉数据，交给下面那个等 token 的 effect 做
  //   （启动时 token 可能还没验完，现在就拉必然 401）。
  useEffect(() => {
    const fromUrl = (): UrlRoute => parseHash(window.location.hash) ?? parsePath(window.location.pathname)

    const onPop = (): void => {
      const u = fromUrl()
      // ★ 后退键走 replace=false 之外的路径：这里**只设 state，不再 push**
      //   （否则每按一次后退反而多压一条历史，形成死循环）
      if (u.name === 'projects') {
        setRoute({ name: 'projects' })
        setNav('projects')
      } else if (u.name === 'signup') {
        setRoute({ name: 'signup' })
      } else if (u.name === 'agents' || u.name === 'billing' || u.name === 'keys') {
        setRoute({ name: 'projects' })
        setNav(u.name)
      }
      // project / task 需要拉数据，交给 pendingRestore 那条 effect
      else if (u.name === 'project' || u.name === 'task') {
        setPendingRestore(u)
      }
    }

    // ★ popstate 也要能触发恢复 —— 但恢复 effect 被 urlRestoredRef 拦着（只跑一次）。
    //   这里**不重置 ref**：恢复 effect 的 ② 段只判 `pendingRestore !== null`，
    //   所以只要这里 setPendingRestore 了，那一轮就会去兑现。
    //   （ref 只守「启动时读一次 URL」，不守「后退时读 URL」。）

    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])


  const [gate, setGate] = useState<'checking' | 'ok' | 'need-token' | 'auth-fail' | 'error'>(
    'checking',
  )
  const [gateMsg, setGateMsg] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)

  /**
   * 当前登录的账号（顶栏显示用）—— 2026-11-23 阿开要求
   *
   * ★ 为什么要单独存：顶栏要显示「你是谁」，而凭据本身是 `kp_own_xxx…`
   *   这种机器串，给人看不合适。得问服务端要租户名 + 注册邮箱。
   * ★ 三态：undefined=还没拉到 / null=拉不到（不显示账号区）/ 对象=显示
   * ★ 拉失败**不阻塞任何功能** —— 顶栏少一行账号，用户照样能干活。
   *   所以这里吞掉错误，只把 undefined 变 null。
   */
  const [me, setMe] = useState<
    { tenantId: string; name: string; contact: string | null } | null | undefined
  >(undefined)

  // ══════════════════════════════════════════════════════════════════
  // 按 URL 恢复页面（刷新 / 分享链接落地 / 后退键到详情页）
  // ══════════════════════════════════════════════════════════════════
  //
  // ★ 时机：**必须等 gate === 'ok'**。
  //   凭据没验完就发请求 ⇒ 必然 401 ⇒ 用户看到「凭据无效」而实际是好的。
  //   （这个坑在别的页面踩过：先请求后鉴权 = 假报错。）
  //
  // ★ 职责边界：
  //   · 项目详情 → 拉 listProjects 找到那条（URL 里只有 id，对象要从服务端取）
  //   · 任务详情 → 需要 projectName 显示面包屑 ⇒ 先拉项目，再进任务
  //   · 找不到（id 不存在 / 不属于本租户）⇒ **回项目列表**，不白屏
  //     而且要用 replaceState，别把「一个打不开的 URL」留在历史里
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (gate !== 'ok' || token === null) return

    // ① 首次挂载：把「当前 URL」变成待恢复项（刷新能落回原处）
    //
    // ★★ 用 ref 而不是「pendingRestore === null」当判断依据（2026-11-24 踩的坑）：
    //   用 state 判断会死循环（详见 urlRestoredRef 的注释）。
    //   ref 一旦置 true 就再也不进来，恢复流程**只走一次**。
    if (!urlRestoredRef.current) {
      urlRestoredRef.current = true
      const u = parseHash(window.location.hash) ?? parsePath(window.location.pathname)
      if (u.name === 'project' || u.name === 'task') {
        setPendingRestore(u)
        return
      }
      // 导航页（agents/billing/keys）刷新也要落回原处
      if (u.name === 'agents' || u.name === 'billing' || u.name === 'keys') {
        setNav(u.name)
      }
      return
    }

    // ② 兑现恢复（只处理「有待恢复项」那一轮；没有就什么都不做）
    if (pendingRestore === null) return
    let cancelled = false
    void (async () => {
      try {
        if (pendingRestore.name === 'project') {
          const r = await listProjects(token)
          if (cancelled) return
          // ★ listProjects 返回 `{ projects: Project[] }`（不是数组本身）。
          //   第一版我写成 `r.data.find(...)` —— TS 会拦，但如果 data 是 any
          //   就会运行时炸「find is not a function」。照 api.ts 的真实返回结构取。
          const target = r.ok
            ? r.data.projects.find((p) => p.projectId === pendingRestore.projectId)
            : undefined
          if (target !== undefined) {
            setRoute({ name: 'project', project: target })
            setNav('projects')
          } else {
            // 找不到 ⇒ 回列表 + 把坏 URL 换掉（replaceState，不留死链在历史里）
            setRoute({ name: 'projects' })
            setNav('projects')
            try {
              window.history.replaceState({}, '', '/')
            } catch {
              /* 沙箱里 history 可能被拒，不影响页面 */
            }
          }
        } else if (pendingRestore.name === 'task') {
          // 任务页要 projectName 做面包屑 ⇒ 得先知道这条任务属于哪个项目。
          // ★ 为什么不新增 getTask 接口：任务详情页自己有 GET /tasks/:id，
          //   但它需要 token 且在页面内部调；这里只需要「面包屑名字」，
          //   用 listProjects 逐个试太贵。改成：先按任务 id 直接进，
          //   projectName 留空串 —— TaskDetailPage 会把面包屑显示成
          //   「项目 / 任务」（没有项目名不会崩，页面内会拉到真数据）。
          //
          //   ★ 更好的做法（下一轮）：后端加 `GET /tasks/:id` 返回里带 projectName。
          //     已在任务书里记，本轮先用不崩的形态。
          setRoute({ name: 'task', taskId: pendingRestore.taskId, projectName: '' })
          setNav('projects')
        }
      } finally {
        if (!cancelled) setPendingRestore(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [gate, token, pendingRestore])


  /** 凭据校验：只验「能不能进」，不拉业务数据（业务数据各页自己拉） */
  const verify = useCallback(async (tk: string | null) => {
    // ★ 没凭据：不发请求，直接进入接入态（见文件头 ①）
    if (tk === null) {
      setGate('need-token')
      return
    }
    setGate('checking')
    const r = await listAgents(tk)
    if (r.ok) {
      setGate('ok')
      // ★ 顺带拉「我是谁」（顶栏显示用）。放在这里而不是 useEffect 另起一份：
      //   「凭据验通过」和「能拿到账号信息」是同一个时刻的事，
      //   两处各拉一次就会出现「进了主界面但顶栏空着」的中间态。
      void getMe(tk).then((v) => setMe(v ?? null))
      return
    }
    if (r.failure.kind === 'auth') {
      setGate('auth-fail')
      setGateMsg('凭据无效或已过期')
      return
    }
    // ★ 402 与网络分别处理（见文件头 ②）
    if (r.failure.kind === 'insufficient-credits') {
      setGateMsg(`余额不足，还差 ${r.failure.shortfall.toFixed(2)} 分`)
      setGate('error')
      return
    }
    // ★★ 对外文案纪律（设计稿 §六）：
    //    `failure.message` 是给开发者看的（可能含 `404` / `fetch failed` / 堆栈），
    //    **不许直接甩给客户** —— 客户看到技术细节只会更慌，还会去搜这个词。
    //    ⇒ 按 kind 给人话；`server-error` 统一说「服务暂时不通」，不放状态码。
    //      排障信息仍保留在 failure.requestId 里，需要时看日志能对上。
    if (r.failure.kind === 'network') {
      setGateMsg('网络不通，检查一下连接')
    } else {
      setGateMsg('服务暂时不通，稍后再试')
    }
    setGate('error')
  }, [])

  useEffect(() => {
    void verify(token)
  }, [verify, token])

  // 健康探针与数据加载分开（见文件头 ④）
  useEffect(() => {
    let cancelled = false
    void health().then((h) => {
      if (cancelled) return
      if (h.version !== null) setVersion(h.version)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const saveToken = useCallback(
    (tk: string) => {
      const clean = tk.trim()
      if (clean === '') return
      try {
        localStorage.setItem(TOKEN_KEY, clean)
      } catch {
        // 存不了也要能用（本次会话有效）
      }
      setTokenState(clean)
      setGateMsg(null)
    },
    [],
  )

  const clearToken = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* 忽略 */
    }
    setTokenState(null)
    // ★ 退出时把账号信息一起清掉，否则下次进来会先闪一下上一个人的邮箱
    setMe(null)
    setRoute({ name: 'projects' })
    // ★ URL 也回根（2026-11-24）：否则退出后地址栏还挂着 /tasks/tk_xxx，
    //   下次登录会直接跳回那条任务 —— 换个账号就落到别人的任务上（越权观感）。
    try {
      window.history.replaceState({}, '', '/')
    } catch {
      /* 沙箱里 history 可能被拒 */
    }
    setGate('need-token')
  }, [])

  /**
   * 「退出」二次确认 —— ★ 2026-11-23 阿开要求
   *
   * 「点击退出要弹出确认之后才退出，不要点击就退出」
   *
   * ★ 为什么不用浏览器原生 confirm()：
   *   ① 本项目禁用（原生弹窗样式不可控、在移动端像诈骗弹窗）
   *   ② 顶栏只有 1 行 12px 的位置，塞不下带后果说明的确认条
   *   ⇒ 做法：第一次点文案变「确定退出？」，3 秒内再点才真执行，
   *     移开鼠标/超时自动还原。确认态**加红边框**，视觉上和普通态明确不同。
   *
   * ★ 为什么值得确认：退出会清掉本机凭据并弹回登录页 ——
   *   正在干活的人被踢出去，还得回去翻那枚 Key（或加微信找铺主重置）。
   */
  const [confirmExit, setConfirmExit] = useState(false)
  useEffect(() => {
    if (!confirmExit) return
    const t = setTimeout(() => setConfirmExit(false), 3000)
    return () => clearTimeout(t)
  }, [confirmExit])

  // ── 注册页：★ 必须在 gate 判断**之前**（没 Key 才是要去注册的人）──
  if (route.name === 'signup') {
    return (
      <SignupPage
        onDone={(apiKey) => {
          // ★ 注册成功 ⇒ 存进凭据位 + 回主界面（与 TokenGate 同一套，不另立一份）
          saveToken(apiKey)
          goRoute({ name: 'projects' })
          setNav('projects')
        }}
        onBack={() => goRoute({ name: 'projects' })}
      />
    )
  }

  // ── 未通过凭据校验：接入 / 错误态 ──
  if (gate === 'checking') {
    return <div style={{ padding: 60, textAlign: 'center', color: T.faint, fontSize: 13 }}>加载中…</div>
  }
  if (gate !== 'ok') {
    return (
      <TokenGate
        mode={gate === 'need-token' ? 'need' : 'fail'}
        message={gateMsg}
        onSubmit={saveToken}
        onRetry={() => void verify(token)}
        onSignup={() => goRoute({ name: 'signup' })}
      />
    )
  }

  const body =
    route.name === 'project' ? (
      <ProjectDetailPage
        project={route.project}
        token={token as string}
        // ★ 从「我的 Agent」点「派活」带过来的预选人（2026-11-24）
        preselectAgentId={route.preselectAgentId}
        onOpenTask={(taskId) =>
          goRoute({ name: 'task', taskId, projectName: route.project.name })
        }
        // ★ 邀请面板空库时「去 Agent 库雇一个」—— 回列表页 + 切到「我的 Agent」，
        //   不是只改 hash（本项目路由是 nav state，改 hash 无效）。
        //   ★ 2026-11-24：agent-library 已并入 agents（合并页），这里跟着改。
        onGoToLibrary={() => {
          goRoute({ name: 'projects' })
          setNav('agents')
        }}
        // ★ 改名后重拉项目，把 route.project 换成服务端真值（2026-11-24）。
        //   为什么不能只靠页面内 localName：`route.project` 是**进页面那一刻的快照**，
        //   面包屑和返程都读它 ⇒ 不重拉就会出现「标题改了、面包屑还是旧名」。
        onRenamed={() => {
          void (async () => {
            const r = await listProjects(token as string)
            if (!r.ok) return
            const fresh = r.data.projects.find((p) => p.projectId === route.project.projectId)
            if (fresh !== undefined) goRoute({ name: 'project', project: fresh })
          })()
        }}
      />
    ) : route.name === 'task' ? (
      <TaskDetailPage
        taskId={route.taskId}
        token={token as string}
        projectName={route.projectName}
        // ★ 面包屑回填（2026-11-24）：直接打开 /tasks/tk_xxx 时外层没项目名，
        //   页面拉到任务后用服务端 JOIN 出来的真名补上。
        //   ★ 用 replace 不 push —— 这是同一页的元信息补全，不是导航。
        onLoaded={(realName) => {
          if (realName !== route.projectName) {
            setRoute({ name: 'task', taskId: route.taskId, projectName: realName })
          }
        }}
      />
    ) : nav === 'keys' ? (
      <KeysPage token={token as string} onKeyChanged={saveToken} />
    ) : nav === 'agents' ? (
      // ★★★ 2026-11-24：「雇人」+「派活看板」合并成本页「我的 Agent」
      //
      //   阿开原话：「雇人页面一个 Agent 的一栏很长，可以把状态展示在右边的空间，
      //             且每一栏右边增加一个派活按钮自动跳到项目页面」
      //
      //   ★ onDispatch 做什么：本页只负责「带着这个人过去」，不复制一套派活表单。
      //     Agent 不属于任何项目（古茶定案 011），派活是项目里的动作。
      //     目标项目已知（agent 已在其中）就直接进那个项目并预选;
      //     未知就先回项目列表让他选 —— 这两种情况在 AgentsPage 里已分好。
      <AgentsPage
        token={token as string}
        onDispatch={(agentId, projectId) => {
          // ★ 已知项目走「直达」：这里需要在 projects 列表里找到对象。
          //   找不到（比如项目刚被删）就退回列表页，不报错。
          void (async () => {
            const r = await listProjects(token as string)
            if (!r.ok) {
              goRoute({ name: 'projects' })
              return
            }
            const target = projectId === null
              ? undefined
              : r.data.projects.find((p) => p.projectId === projectId)
            if (target === undefined) {
              // 没有目标项目（还没进项目 / 项目已不存在）⇒ 回项目列表自己选
              goRoute({ name: 'projects' })
              setNav('projects')
              return
            }
            goRoute({ name: 'project', project: target, preselectAgentId: agentId })
          })()
        }}
      />
    ) : nav === 'projects' ? (
      <ProjectListPage
        token={token as string}
        onOpenProject={(p) => goRoute({ name: 'project', project: p })}
      />
    ) : (
      // ★ 积分 / 账单页（2026-11-24 补上）。
      //   前面三个 nav 已各自命中，落到这里必然是 billing。
      <BillingPage token={token} />
    )

  const breadcrumb =
    route.name === 'project'
      ? `项目 / ${route.project.name}`
      : route.name === 'task'
        ? // ★ 空 projectName 不出「项目 /  / 任务」（中间空一段像坏了）。
          //   什么时候会空：直接打开 `/tasks/tk_xxx`（刷新/分享链接落地），
          //   那一刻只有任务 id，项目名要等页面内拉到任务才回填（见 onTaskLoaded）。
          route.projectName === ''
            ? '任务'
            : `项目 / ${route.projectName} / 任务`
        : undefined

  return (
    <AppShell
      active={nav}
      noPageScroll={route.name === 'task'}
      onNav={(k) => {
        setNav(k)
        goRoute({ name: 'projects' })
        // ★ 导航页也写 URL（2026-11-24）：
        //   nav 是独立于 route 的 state（route 恒为 projects，靠 nav 决定渲染哪页），
        //   ⇒ 只写 goRoute 会把 URL 拍成 `/`，从「我的 Agent」刷新就回项目列表。
        //   这里补一条，把 URL 换成 /agents · /billing · /keys。
        //   ★ 用 push 而不是 replace：切页是「往前走一步」，后退键该能退回来。
        const navPath = k === 'projects' ? '/' : `/${k}`
        if (window.location.pathname !== navPath) {
          try {
            window.history.pushState({}, '', navPath)
          } catch {
            /* 沙箱里 history 可能被拒 */
          }
        }
      }}
      version={version}
      breadcrumb={breadcrumb}
      backLabel={route.name === 'task' ? '项目详情' : '项目列表'}
      // ★★★ 2026-11-24 二次修（阿开原话：「那个返回按钮是返回项目页面，不是返回项目详情页面
      //   （也就是任务详情页面的上一级页面）」）：
      //
      //   上一版按 **项目名** 反查项目，有两个洞，第二个是致命的：
      //     ① 项目被改名 ⇒ find 不中 ⇒ 退回项目列表（用户看到的就是「回到了项目页」）
      //     ② **直接打开/刷新 `/tasks/tk_xxx` 时 `projectName` 是空串**
      //        （见 293 行 `projectName: ''`）⇒ 条件不成立 ⇒ 直接 `goRoute({name:'projects'})`
      //        ⇒ **必落项目列表页**。阿开正是刷新后点的返回。
      //
      //   ⇒ 改用**任务 id 反查任务本身**（`getTask` 返回的 Task 一定带 `projectId`）。
      //     项目名会改、可能为空；`projectId` 是主键，不变不为空。**判据要取不可变的那一个。**
      //     拿到 projectId 后再拉项目列表取完整对象（项目详情页要它的状态/计数）。
      onBack={route.name === 'projects' ? undefined : () => {
        if (route.name === 'task') {
          void (async () => {
            const tk = await getTask(token as string, route.taskId)
            if (!tk.ok) {
              goRoute({ name: 'projects' })
              return
            }
            const pid = tk.data.task.projectId
            const ps = await listProjects(token as string)
            const proj = ps.ok ? ps.data.projects.find((p) => p.projectId === pid) : undefined
            goRoute(proj !== undefined ? { name: 'project', project: proj } : { name: 'projects' })
          })()
          return
        }
        goRoute({ name: 'projects' })
      }}
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* ── 当前账号 ──
              ★ 2026-11-23 阿开要求：右上角改为「显示邮箱账号 + 退出」。
                原来这里是「换 Key」按钮 —— 而换发 Key 在「Key 管理」页已经有了，
                同一个功能两个入口，用户不知道点哪个，且顶栏那个动作更危险
                （它只清本机凭据，不换真 Key，语义含混）。
              ★ 邮箱优先、租户名兜底：邮箱是「他注册时自己填的」，认得出来；
                老租户没留邮箱就退到租户名，不显示一串 kp_own_ 让人困惑。 */}
          {me ? (
            <span
              style={{ color: T.dim, fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={me.contact ?? `${me.name}（注册时未留邮箱）`}
            >
              {me.contact ?? `${me.name}（未留邮箱）`}
            </span>
          ) : null}

          <button
            onClick={() => {
              // ★ 二次点击确认：第一次只变色变文案，第二次才真的走。
              //   阿开：「点击退出要弹出确认之后才退出，不要点击就退出」
              if (confirmExit) {
                setConfirmExit(false)
                clearToken()
              } else {
                setConfirmExit(true)
              }
            }}
            onMouseLeave={() => setConfirmExit(false)}
            style={{
              background: 'transparent',
              border: confirmExit ? '1px solid #b91c1c' : '1px solid transparent',
              borderRadius: 4,
              padding: '2px 8px',
              // 确认态变红：视觉上立刻能看出「这一步不一样了」
              color: confirmExit ? '#b91c1c' : T.dim,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: confirmExit ? 600 : 400,
            }}
            title={confirmExit ? '再点一次就退出登录（本机凭据清除，需重新粘贴 Key 进来）' : '退出登录'}
          >
            {confirmExit ? '确定退出？' : '退出'}
          </button>
        </div>
      }
    >
      {body}
    </AppShell>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ── 管理员微信（登录页「通行证丢了」区用）──
//
// ★ 2026-11-23 阿开定：用微信号 + 一键复制，不再放二维码图片。
//   理由（他的原话）：「只需要展示：通行证丢了怎么办？加管理员微信找回，
//   管理员微信：AK20260910，增加一个点击复制按钮。」
//
// ★ 为什么只给号、不给核验规则：规则一旦显示在页面上，谁都能照着编。
//   核验由管理员线下人工判断，具体方式不写在任何对外可见的代码或文档里。
const ADMIN_WECHAT = 'AK20260910'

// TokenGate —— 凭据接入（无 Key / Key 失效 共用）
// ═══════════════════════════════════════════════════════════════════

function TokenGate({
  mode,
  message,
  onSubmit,
  onRetry,
  onSignup,
}: {
  mode: 'need' | 'fail'
  message: string | null
  onSubmit: (tk: string) => void
  onRetry: () => void
  onSignup: () => void
}) {
  const [draft, setDraft] = useState('')
  // 管理员微信号「复制」按钮的一次性反馈 —— 2 秒后自己回到「复制」。
  const [wechatCopied, setWechatCopied] = useState(false)
  const fail = mode === 'fail'

  async function copyWechat() {
    try {
      await navigator.clipboard.writeText(ADMIN_WECHAT)
      setWechatCopied(true)
      setTimeout(() => setWechatCopied(false), 2000)
    } catch {
      // 老浏览器 / 非 https：不假装复制成功，让用户自己选文字复制（上面那串已 userSelect: 'all'）。
      setWechatCopied(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: T.bg,
        color: T.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
      }}
    >
      <div style={{ width: 380 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>山海 · 项目台</div>
        <div style={{ fontSize: 13, color: T.dim, marginBottom: 20, lineHeight: 1.8 }}>
          {fail
            ? '这枚通行证失效了，换一枚进来。'
            : '一个项目一张台：需求、拆解、派活、验收，都在台面上。'}
        </div>

        {fail && message !== null && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fdf0f0',
              border: '1px solid #f0c0c0',
              borderRadius: 6,
              color: '#b91c1c',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {message}
          </div>
        )}

        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(draft)
          }}
          placeholder="粘贴你的铺主通行证（kp_own_...）"
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 12px',
            fontSize: 13,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            background: T.surface,
            color: T.text,
            outline: 'none',
            marginBottom: 10,
          }}
        />
        <button
          onClick={() => onSubmit(draft)}
          disabled={draft.trim() === ''}
          style={{
            width: '100%',
            padding: '9px 0',
            fontSize: 13,
            border: 'none',
            borderRadius: 6,
            background: draft.trim() === '' ? T.surfaceSoft : T.accent,
            color: draft.trim() === '' ? T.faint : '#fff',
            cursor: draft.trim() === '' ? 'default' : 'pointer',
          }}
        >
          进入
        </button>

        {fail && (
          <button
            onClick={onRetry}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '9px 0',
              fontSize: 13,
              background: 'transparent',
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              color: T.dim,
              cursor: 'pointer',
            }}
          >
            用当前 Key 重试
          </button>
        )}

        {/* ★ 只在「还没 Key」时给注册入口 —— fail 态的人手里已有 Key，
            给他「去注册」等于暗示「再领一个」，会让他把已有的丢了。 */}
        {!fail && (
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: T.dim }}>
            还没有通行证？
            <button
              onClick={onSignup}
              style={{
                background: 'transparent',
                border: 'none',
                color: T.accent,
                fontSize: 12,
                cursor: 'pointer',
                padding: '0 2px',
                textDecoration: 'underline',
              }}
            >
              去领取一枚
            </button>
          </div>
        )}

        <div style={{ fontSize: 11, color: T.faint, marginTop: 16, lineHeight: 1.7 }}>
          通行证只存在这台浏览器里，不会上传。换电脑需要重新领取一枚。
        </div>

        {/* ── Key 丢了怎么办 ──
            ★ 2026-11-23 安全决策：**不开邮箱自助找回**
               （能收邮件 ≠ 是账号主人，邮箱被盗时形同虚设）。
            ★ 2026-11-23 阿开定（当夜第二次纠偏）：**是「重领」，不是「找回」** ——
               「不能是找回，因为我们说了：通行证只存在这台浏览器里，不会上传。
               换电脑需要重新领取一枚。」
               ⇒ 「找回」等于承诺一件我们做不到的事（库里只存哈希，明文收不回）；
                 真实动作是「撤销旧的 + 发一枚新的」= 重领。同一个页面里不许两种说法。
            ★ 2026-11-23 阿开定（当夜第一次纠偏）：**核验规则一个字都不许显示在页面上** ——
               「这些问题不应该展示出来，展示出来别人就知道你的找回规则了」。
               ⇒ 页面只留「找谁 + 怎么找」。核验由管理员人工判断，
                 **具体核验方式不进任何对外可见的代码或文档**（含开源注释）。
            ★ 人味纪律：说「加管理员微信」并给出号，而不是「联系管理员」—— 后者像衙门。 */}
        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: `1px solid ${T.border}`,
            fontSize: 12,
            color: T.dim,
            lineHeight: 1.8,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>通行证丢了怎么办？</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: T.faint }}>加管理员微信重领一枚，管理员微信：</span>
            <code
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12.5,
                color: T.text,
                userSelect: 'all',
              }}
            >
              {ADMIN_WECHAT}
            </code>
            <button
              type="button"
              onClick={() => void copyWechat()}
              style={{
                padding: '3px 10px',
                fontSize: 11.5,
                border: `1px solid ${T.border}`,
                borderRadius: 5,
                background: 'transparent',
                color: wechatCopied ? T.accent : T.dim,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {wechatCopied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
