/**
 * Agent 接入说明 —— 拿到项目通行证后怎么接（2026-11-23）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个文件（阿开原话）
 * ══════════════════════════════════════════════════════════════════
 *
 * 「如果我新建了 Agent，点击复制 key 应该自带『Agent 如何配置、如何接入
 *   山海·项目台』的提示语，以及 KB 详细配置说明才对。」
 *
 * 换句话说：**只给一串 Key 等于没交付。**
 * 对方拿到 `kp_pm_xxx` 之后，得知道：往哪发、带什么头、怎么领活、怎么交件、
 * 什么情况下会拿到 401/403。这些不写，那枚 Key 就是废的。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 边界：这是「壳」，不是「钥匙」（阿开 2026-11-11 数字公证处那条）
 * ══════════════════════════════════════════════════════════════════
 *
 * **可以给**：端点、方法、请求体形状、错误码含义 —— 客户不给你这些就接不上，
 *             那不是保密，是没做完。
 * **不能给**：判据怎么写、库结构、内部鉴权实现、任何「怎么保证它是对的」的东西。
 *
 * 所以本文件里写的每一条，都是「客户照着能调通」的最小必要信息。
 * 不加任何内部路径、不写实现细节、不透露判据。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 为什么由服务端生成，而不是前端写死一段文案
 * ══════════════════════════════════════════════════════════════════
 *
 * 端点一改，说明书就该跟着变。前端写死 ⇒ 说明书与真实接口脱钩 ⇒
 * 客户照着调不通，而我们自己还不知道（本仓「同一事实两处维护必漂移」已栽多次）。
 *
 * 因此**唯一真值在服务端**：本文件是端点的唯一描述，前端只负责渲染。
 */

/** 一个端点的说明 —— 客户照着就能调 */
export interface AgentApiDoc {
  /** 方法与路径，如 `POST /api/agent/claim` */
  call: string
  /** 一句话说它干什么（用客户的话，不用内部词） */
  what: string
  /** 请求体示例（GET 为 null） */
  body: Record<string, unknown> | null
  /** 返回值里该看哪个字段 */
  returns: string
}

/** 接入说明全貌 */
export interface AgentIntegrationDoc {
  /** 这枚 Key 能用在哪（scope），如「只对项目『橙子小程序开发』有效」 */
  scope: string
  /** 基础地址 */
  baseUrl: string
  /** 鉴权方式一句话 */
  auth: string
  /** 端点清单 */
  endpoints: AgentApiDoc[]
  /** 拿到 401 / 403 / 404 各意味着什么 */
  errors: { code: string; meaning: string; todo: string }[]
  /** 最小可跑通顺序（三步：领活 → 交件 → 完事） */
  quickstart: string[]
  /** 心跳为什么要发 —— 不发会怎样 */
  heartbeatNote: string
}

/**
 * 生成接入说明。
 *
 * @param baseUrl  对外的接口基址（如 `https://pm.ak2029.com/api`）
 * @param projectName 这枚 Key 专属的项目名 —— **必须说清「只对这个项目有效」**，
 *                    否则对方会拿它去调别的项目，然后收到 403 还以为我们坏了
 */
export function buildIntegrationDoc(baseUrl: string, projectName: string): AgentIntegrationDoc {
  return {
    scope: `这枚通行证只对项目「${projectName}」有效。调别的项目会被拒（403 scope_violation），那不是故障，是边界。`,
    baseUrl,
    auth:
      '每个请求都带这个头：`Authorization: Bearer <你的通行证>`。' +
      '通行证要存在对方的服务端环境变量或密钥管理里 —— 不要提交进 git、不要写进前端代码。',

    // ★★★ 顺序按「一个 Agent 一辈子会用到」排：先看有没有活 → 领 → 干 → 交
    //   不按字母排、不按我们代码里的顺序排 —— 要按对方的动作顺序排。
    endpoints: [
      {
        call: 'GET /agent/my-tasks',
        what: '我手上有什么活（已领的任务）',
        body: null,
        returns: '`tasks[]` —— 每条含 taskId / title / status',
      },
      {
        call: 'POST /agent/claim',
        what: '领一条活干。没有可领的就返空，不是报错',
        body: null,
        returns: '`task` 有值 = 领到了；`task: null` = 现在没活，等一会儿再来',
      },
      {
        call: 'POST /agent/submit',
        what: '交件。告诉平台这条活做完了、产物在哪',
        body: { taskId: 't_xxx', note: '做完了，产物见 resultUrl', resultUrl: 'https://…' },
        returns: '`ok: true` = 已交，等验收',
      },
      {
        call: 'POST /agent/release',
        what: '这条活我干不了，还给平台（会重新派给别人）',
        body: { taskId: 't_xxx', reason: '缺数据源' },
        returns: '`ok: true` = 已退回',
      },
      {
        call: 'POST /agent/heartbeat',
        what: '告诉平台「我还在」。长任务期间定期发',
        body: null,
        returns: '`ok: true`',
      },
      {
        call: 'GET /agent/presence',
        what: '我现在在平台眼里是什么状态',
        body: null,
        returns: '`presence` —— busy / idle / blocked / offline',
      },
    ],

    // ★ 错误码要写「怎么办」，不能只写「是什么」。
    //   客户看到 401 只会问「为什么」，你得直接告诉他下一步做什么。
    errors: [
      {
        code: '401',
        meaning: '这枚通行证平台不认（过期 / 被撤销 / 复制时少了字符）',
        todo: '找发你通行证的人要一枚新的。重试没用。',
      },
      {
        code: '403 scope_violation',
        meaning: '你拿 A 项目的通行证去调 B 项目',
        todo: '一个项目一枚通行证。要去 B 项目，就找 B 项目要它那枚。',
      },
      {
        code: '403 forbidden',
        meaning: '这枚是项目通行证，调了只有铺主能调的接口（比如建 Agent）',
        todo: '派活用项目通行证，雇人用铺主通行证。两者不能互借。',
      },
      {
        code: '404',
        meaning: '任务或项目不存在（可能已被取消 / 归档）',
        todo: '刷新一下手上的任务清单，别拿旧 taskId 反复交。',
      },
    ],

    // ★ 最小可跑通路径：三步。写多了对方不知道从哪开始。
    quickstart: [
      '① `POST /agent/claim` 领活 —— 返回 `task: null` 就等 30 秒再试一次',
      '② 处理完，`POST /agent/submit` 交件，带上 taskId 和产物地址',
      '③ 活多、耗时长时，中间每 1~2 分钟 `POST /agent/heartbeat` 一次',
    ],

    heartbeatNote:
      '心跳不是必填，但不发会怎样：平台 2 小时看不到你的动静，就把你手上那条活收回去重新派。短活不用管，长活记得发。',
  }
}

/**
 * 把接入说明渲染成**可直接复制的一段文本**。
 *
 * ★ 为什么要有文本版：用户点「复制」时，复制的是给**另一个 AI / 另一个开发者**看的，
 *   不是给自己看的。所以必须是自包含的纯文本 —— 粘到哪儿都能读懂，
 *   不依赖我们的界面、不依赖 Markdown 渲染。
 */
export function renderIntegrationText(
  doc: AgentIntegrationDoc,
  apiKey: string,
  agentName: string,
): string {
  const lines: string[] = []

  lines.push(`${agentName} —— 接入「山海 · 项目台」`)
  lines.push('='.repeat(52))
  lines.push('')
  lines.push('【你的通行证】')
  lines.push(apiKey)
  lines.push('')
  lines.push('⚠️ 这串只显示这一次。平台只存它的哈希，之后谁也查不到明文。现在存好。')
  lines.push('')
  lines.push('【它能用在哪】')
  lines.push(doc.scope)
  lines.push('')
  lines.push('【怎么鉴权】')
  lines.push(doc.auth)
  lines.push('')
  lines.push('【接口地址】')
  lines.push(doc.baseUrl)
  lines.push('')
  lines.push('【你会用到的接口】')
  for (const ep of doc.endpoints) {
    lines.push('')
    lines.push(`· ${ep.call}`)
    lines.push(`  ${ep.what}`)
    if (ep.body !== null) {
      lines.push(`  请求体：${JSON.stringify(ep.body)}`)
    }
    lines.push(`  返回：${ep.returns}`)
  }
  lines.push('')
  lines.push('【最小跑通顺序】')
  for (const s of doc.quickstart) lines.push(`  ${s}`)
  lines.push('')
  lines.push('【心跳】')
  lines.push(doc.heartbeatNote)
  lines.push('')
  lines.push('【出错时看这里】')
  for (const e of doc.errors) {
    lines.push(`  ${e.code} — ${e.meaning}`)
    lines.push(`    → ${e.todo}`)
  }
  lines.push('')
  lines.push('='.repeat(52))
  lines.push('以上是接入所需的全部信息。第一件事：调 POST /agent/claim 看看有没有活。')

  return lines.join('\n')
}


/**
 * 接口基址 —— **唯一一处**拼法。
 *
 * ★ 为什么不许各页各写一份：端点列表里已经写了 `/agent/claim` 这样的路径，
 *   基址必须给到 `https://host/api` 才拼得成完整调用。
 *   两处各拼一次 ⇒ 以后改路径前缀必漏一处 ⇒ 客户拿到一份错的说明书。
 */
export function apiBaseUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/api`
}
