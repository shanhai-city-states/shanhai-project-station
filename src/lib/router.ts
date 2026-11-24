/**
 * router.ts —— URL ↔ 路由状态 的唯一映射（2026-11-24 立）
 * =====================================================================
 *
 * ★★★ 为什么要有这个文件（阿开 2026-11-24 实测发现）：
 *   「点任务、点项目，URL 一直是 https://pm.ak2029.com/」
 *
 *   改前：整个前端的状态全在 `useState` 里，**URL 永远是根路径**。后果三条：
 *     ① **刷新就回首页** —— 用户在任务详情页填了一半，F5 一下全没了
 *     ② **链接没法分享** —— 把 URL 发给同事，对方只能看到项目列表
 *     ③ **浏览器后退键没用** —— 点了三个页面，后退一次直接退出站
 *
 *   ★ 这条不是「体验优化」，是**阿开刚提的「复制任务ID通知对方」闭环的必要条件**：
 *     复制了 ID 发给对方，对方打开链接落不到那条任务上，ID 的价值就打折。
 *
 * ★ 设计三原则（想清楚再动手的）：
 *   ① **URL 只放 id，不放对象**。
 *      `Route` 里的 `project` 是整个 Project 对象（含名称、状态、计数…），
 *      URL 里塞不下也不该塞（会变成「过期的快照能被分享」）。
 *      ⇒ URL 只有 `/projects/p123` / `/tasks/tk_xxx`，进页面时自己拉真值。
 *   ② **不用 hash，用 path**。nginx 那边已有 SPA 兜底（`try_files → index.html`），
 *      path 更干净、可读、可被 nginx 日志统计。hash 只作为 legacy 兜底兼容。
 *   ③ **解析与生成都在这里，别处不许拼 URL**。
 *      同一语义两处实现必漂移（本仓栽过多次）—— 页面里只调 `pathOf(route)`。
 *
 * ★ 这一层**只管 URL 文本**，不碰 React、不碰网络。
 *   所以它能被当纯函数单独测试。
 */

/**
 * 路由状态。
 *
 * ★ `projectName` / `taskId` 这些「对外可见的标识」进 URL；
 *   `project` 对象**不进** URL —— 它由 `routeToUrl` 只取 `projectId`。
 */
export type UrlRoute =
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'task'; taskId: string }
  | { name: 'signup' }
  | { name: 'agents' }
  | { name: 'billing' }
  | { name: 'keys' }

/** 导航栏那几个固定页 —— 也给它一个 URL，刷新能落回原处 */
const NAV_PATHS: Record<string, string> = {
  agents: '/agents',
  billing: '/billing',
  keys: '/keys',
}

/**
 * Route → URL 路径（含前导 `/`）。
 *
 * ★ 项目/任务/注册页之外的导航页也在这里，见 NAV_PATHS。
 * ★ 未知形态 ⇒ 回根路径（宁可回首页，也不要拼出一个打不开的 URL）。
 */
export function pathOf(r: UrlRoute): string {
  switch (r.name) {
    case 'projects':
      return '/'
    case 'project':
      // ★ 空 id 不出 `/projects/`（末尾空段）—— 那种 URL 解析回来是 Invalid
      return r.projectId === '' ? '/' : `/projects/${encodeURIComponent(r.projectId)}`
    case 'task':
      return r.taskId === '' ? '/' : `/tasks/${encodeURIComponent(r.taskId)}`
    case 'signup':
      return '/signup'
    case 'agents':
    case 'billing':
    case 'keys':
      return NAV_PATHS[r.name] ?? '/'
    default:
      return '/'
  }
}

/**
 * URL 路径 → Route。
 *
 * ★ 解析必须是**纯函数**且**永不抛**：任何看不懂的路径一律回 `{name:'projects'}`。
 *   为什么不能抛：URL 是用户可编辑的（地址栏、别人的分享、搜索引擎爬到的旧链接），
 *   一个奇怪的路径让整站白屏，比回首页严重得多。
 *
 * ★ 容错项（都实测过）：
 *   · 尾部斜杠        `/projects/p1/`        → 同 `/projects/p1`
 *   · 大小写          不做处理（id 区分大小写，别自作聪明 lower）
 *   · 多余层            `/projects/p1/tasks` → 回首页（本仓没有这个嵌套路由）
 *   · 空段              `/projects//`        → 回首页
 */
export function parsePath(pathname: string): UrlRoute {
  // ① 剥掉可能的 base 前缀与查询串/哈希（parsePath 只认 pathname，
  //    但外面可能直接把 location.pathname+search 传进来，顺手兜住）
  //  ★ 用 const 而不是 let：本函数不做 base 前缀剥离（站点部署在域名根，
  //    BASE 是空串）。写成 let 会让 TS 把变量收窄成 never（没重新赋值），
  //    报 `Property 'length' does not exist on type 'never'`。
  const raw = pathname.split('?')[0]?.split('#')[0] ?? ''
  const stripped = raw.replace(/\/+$/, '')   // ② 去尾部斜杠（根路径除外）
  const p = stripped === '' ? '/' : stripped
  if (p === '' || p === '/') return { name: 'projects' }

  const segs = p.split('/').filter((s) => s !== '')
  if (segs.length === 0) return { name: 'projects' }

  const head = segs[0] ?? ''
  const second = segs[1]

  // /signup
  if (head === 'signup' && segs.length === 1) return { name: 'signup' }
  // /agents /billing /keys
  if (head === 'agents' && segs.length === 1) return { name: 'agents' }
  if (head === 'billing' && segs.length === 1) return { name: 'billing' }
  if (head === 'keys' && segs.length === 1) return { name: 'keys' }

  // /projects/:id
  if (head === 'projects' && segs.length === 2 && second !== undefined && second !== '') {
    let id = second
    try {
      id = decodeURIComponent(second)
    } catch {
      // 坏的百分号编码（`%zz`）⇒ 原样用，不抛
    }
    return id === '' ? { name: 'projects' } : { name: 'project', projectId: id }
  }

  // /tasks/:id
  if (head === 'tasks' && segs.length === 2 && second !== undefined && second !== '') {
    let id = second
    try {
      id = decodeURIComponent(second)
    } catch {
      /* 同上 */
    }
    return id === '' ? { name: 'projects' } : { name: 'task', taskId: id }
  }

  // 其余一律回首页（包括 /projects/p1/tasks 这种多余层）
  return { name: 'projects' }
}

/**
 * ★ 兼容老 hash 形态：`#/tasks/tk_xxx`。
 *
 * 为什么要兼容：如果有人在此之前把**带 hash 的链接**发出去了（或者他自己
 * 存了书签），新版本一上线那些链接就废了。hash 解析成本极低，兜一下。
 * 返回 null = 这个 URL 里没有 hash 路由可认。
 */
export function parseHash(hash: string): UrlRoute | null {
  if (!hash.startsWith('#')) return null
  const inner = hash.slice(1)
  if (inner === '' || inner === '/') return null
  const r = parsePath(inner)
  // ★ 解析出 projects 说明 hash 里没装有效路由 ⇒ 不算命中，
  //   让调用方走 pathname 那条（否则 `#foo` 会被当成回首页的指令）
  return r.name === 'projects' ? null : r
}
