/**
 * P3 任务详情页
 * =====================================================================
 * 设计依据：设计稿 §三 P3 + 与后端数据契约核对后的可做性判定（9 项需求：✅4 · ⚠️1 · ❌4）
 *
 * ★★★ 本页取舍（照数据契约核对的结论，不照抄设计稿）
 *
 *   设计稿要的                      → 本页做法        原因
 *   ────────────────────────────────────────────────────────────
 *   任务标题/状态/Agent/时间         ✅ 做了
 *   4 段大状态条                     ✅ 做了
 *   交付物 sha256                    ✅ 做了          artifacts.sha256 有
 *   交付物 行数 / 大小               ❌ 不做          **无这两列**
 *   三层校验（结构/内容/口径）        ❌ 不做          **无校验结果表**
 *   反馈时间线                       ✅ 做了          pm_messages + state_events
 *   三个动作（通过/打回/看不懂）      ❌ 不做          **无端点**
 *   验收判据 AC + 通过/未过          ⚠️ 只显示判据原文  **无「是否通过」列**
 *
 * ★★ 本页最要紧的一条取舍：**三个操作按钮不做**
 *   设计稿说这三个按钮是这页的核心（「你认不认？」）。
*
*   ★ 2026-11-23 已接通：`POST /tasks/:id/verdict`（accept / reject / cancel）。
*     当时的判断是「后端没有端点 ⇒ 放按钮等于放三个点了报错的死按钮，比放灰按钮诚实」。
*     现在端点有了，且是**带状态机 + 结算**的真端点，所以按钮是真的。
*
*   ★ 三种结果文案必须分开（否则客户会重复点）：
*     · 成功 → 「已验收通过，消耗 N token，扣费 M 积分」
*     · 幂等 → 「此前已处理过，本次没有重复扣费」（alreadyTerminal=true）
*     · 424  → 「操作已生效，费用结算未完成」（**不是失败**，事已经成了）
*
* ★★ 「对话」在这一页（小D 拍板：对话为辅，是任务详情里的一个 tab）
*   已核：`GET /messages?taskId=` 和 `POST /messages` 都在。
*   ⇒ 本页把对话做成「反馈」区，能拉能发，这是**真能用的**，不是占位。
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task, Message, StateEvent } from '../lib/contract'
import { assigneeLabel, statusLabel, actorLabel } from '../lib/contract'
import { getTask, listMessages, sendMessage, verdict, listTaskAttachments, uploadTaskAttachmentReq } from '../lib/api'
import type { TaskAttachment } from '../lib/api'
import { T } from '../styles/tokens'
import { assessTaskHealth, DEFAULT_TASK_STALLED_MS } from '../lib/taskHealth'
/* ★ 2026-11-24：不再 import StatusBar —— 本页的大状态条已删（见下方说明：
   它与页头 StatusChip + 右栏状态变更记录三处重复，且吃掉 76px 垂直空间）*/
import { StatusChip, EmptyState } from '../components/base'
// ★ 2026-11-24：任务说明全文改用弹窗看（内联展开会被视口截断，见 state 处注释）
import { LongTextDialog } from '../components/LongTextDialog'
import { fmtDateTime, fmtBytes } from '../lib/datetime'

export interface TaskDetailPageProps {
  taskId: string
  token: string
  projectName: string
  /**
   * 「任务卡住」阈值（毫秒）。**应由后端下发**（`TASK_STALLED_MS`），
   * 不传时回落 2 小时兜底。
   * ★ 前端不硬编码这个值 —— 阈值是产品语义，只能有一个真源（在后端）。
   */
  stalledMs?: number
  /**
   * ★ 2026-11-24 加：拉到任务后把**真项目名**回传给外层。
   *
   * 为什么需要：直接打开 `/tasks/tk_xxx`（刷新 / 分享链接落地）时，
   * 外层只知道任务 id，`projectName` 只能是空串 —— 面包屑会显示成
   * 「任务」（退化了，但少了「在哪个项目下」这层上下文）。
   * 页面内拉到任务后，服务端已经把 projectName JOIN 出来了，
   * 顺势回传给外层更新面包屑。
   *
   * ★ 只在拿到非空值时调，避免用空值覆盖已有的正确值。
   */
  onLoaded?: (projectName: string) => void
}

export function TaskDetailPage({
  taskId,
  token,
  projectName,
  stalledMs,
  onLoaded,
}: TaskDetailPageProps) {
  const [task, setTask] = useState<Task | null>(null)
  const [events, setEvents] = useState<StateEvent[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  /**
   * ★★★ 2026-11-24 阿开定的任务页形态（原话）：
   *    「交付物在下方，反馈在上方，且反馈的输入框与内容窗口可否做成微信或者飞书
   *      这样的方式？底部固定输入框，这样方便滚动。」
   *
   * ⇒ 布局：反馈占满剩余高度、内部滚动；输入框钉在反馈卡底部不动；
   *         交付物移到反馈下方，**默认收起**（下载才看，不该挤占常看的反馈）。
   *
   * ★ 为什么交付物默认收起：它「每次打开都要扫一眼」的价值远低于反馈，
   *   常驻展开等于把「偶尔才用的下载区」压在「天天要看的对话」上面。
   */
  const [attOpen, setAttOpen] = useState(false)
  /**
   * 任务说明查看弹窗（2026-11-24 改）。
   *
   * ★ 原来是「内联展开」，阿开实测报：「点击展开就只能看到当前的内容，底部被截断。」
   *   实测根因：展开后 div 高 608px > 视口 577px ⇒ 比屏幕还高，底部必然看不见；
   *   且它在左栏 flexShrink:0，把消息区从 223px 压到 121px —— 一次点开，两处受害。
   * ⇒ 改成弹窗：全文在弹窗里滚，左栏高度一点不占。
   */
  const [detailDialog, setDetailDialog] = useState(false)
  /** 消息滚动容器 —— 新消息/首次加载后要自动滚到最底（像微信一样） */
  const msgBoxRef = useRef<HTMLDivElement | null>(null)
  /**
   * 验收动作的在途/二次确认态。
   *
   * ★ 为什么不用 window.confirm：桌面端/内嵌 WebView 里 confirm 常被拦或样式不受控，
   *   而且「确认」这一步本身就是产品语义（要不要写打回理由），用页面内的确认条更可控。
   */
  const [confirming, setConfirming] = useState<'accept' | 'reject' | null>(null)
  const [verdicting, setVerdicting] = useState(false)
  const [verdictMsg, setVerdictMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  /**
   * 交付件列表（Agent 交给铺主的产物）。
   *
   * ★ 2026-11-24 补：此前本页**根本没有交付物区**。
   *   库里躺着真件（小砚的设计说明+改稿zip+截图、Codex的README+ACCEPTANCE+zip），
   *   但铺主界面上一件都看不见 —— 阿开原话「Codex交付和小砚交付的附件没看到」。
   *   这是「改了没生效」的同族：不是没做，是**做的那半截用的人够不着**。
   */
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  /** 加载失败的原因（没件 ≠ 加载失败，两者必须分开显示） */
  const [attErr, setAttErr] = useState<string | null>(null)

  /**
   * ★★★ 2026-11-24 交付件按内容去重（显示层，不动数据）。
   *
   * 为什么：Agent 网络重试会把同一份文件重复入库（小砚实撞：10 件显示成 20 条，
   * 字节完全相同）。库里那 20 条是**真实的交付证据，不能删**；
   * 但列给客户看时必须一份一行，否则客户以为交了两倍的东西。
   *
   * ★ 判据：按 `sha256` 分组（内容相同 = 同一份），保留最早那条（首次交付时间）。
   * ★ 同时**如实说出「有重复」**，不悄悄藏起来 —— 隐藏事实比显示噪声更糟。
   */
  const { uniqAttachments, dupCount } = useMemo(() => {
    const seen = new Map<string, TaskAttachment>()
    for (const a of attachments) {
      const prev = seen.get(a.sha256)
      // 保留最早那条：首次交付时间才是「这份件什么时候来的」
      if (prev === undefined || a.uploadedAt < prev.uploadedAt) seen.set(a.sha256, a)
    }
    return {
      uniqAttachments: Array.from(seen.values()),
      dupCount: attachments.length - seen.size,
    }
  }, [attachments])

  /**
   * ★ 2026-11-24：把附件按「谁传的」拆成两组。
   *
   * - `inputFiles`  = 铺主传的输入件（要求 / 参考资料）—— 干活前就有
   * - `outputFiles` = Agent 交的交付物 —— 干完才有
   *
   * ★ 为什么要拆：两者性质相反。混在一列里客户分不清
   *   「这是我要它做的」和「这是它做出来的」，验收时没法对账。
   * ★ 去重用的是同一份 `uniqAttachments`，所以两组都不会有重复项。
   */
  const { inputFiles, outputFiles } = useMemo(() => {
    return {
      inputFiles: uniqAttachments.filter((a) => a.source === 'owner-input'),
      // ★ 老后端不返回 source 时按交付物处理（宁可不少显示交付物，
      //   也不要把交付物冒充成「你传的」）
      outputFiles: uniqAttachments.filter((a) => a.source !== 'owner-input'),
    }
  }, [uniqAttachments])

  /**
   * 附件期望数（派活时人选的份数）。
   * `null` = 这条任务不校验附件完整性（老任务 / 派活时没选文件）。
   */
  const [attachExpected, setAttachExpected] = useState<number | null>(null)
  /** 补传中（按钮转「上传中…」，防重复点） */
  const [attUploading, setAttUploading] = useState(false)
  /** 补传结果提示（成功/失败都要说） */
  const [attMsg, setAttMsg] = useState<string | null>(null)
  const attFileRef = useRef<HTMLInputElement | null>(null)

  /**
   * 新消息 / 首次加载后自动滚到底（微信、飞书都是这个行为）。
   *
   * ★ 依赖 `messages.length` 而不是 `messages`：
   *   数组每次拉取都是新引用 ⇒ 用 messages 会「每次渲染都滚」，
   *   用户往上翻历史时会被强行拽回底部。
   *   用 length 只在条数真的变了才滚。
   *
   * ★★ 必须同时依赖 `state`（2026-11-24 实测踩到）：
   *   `setMessages` 与 `setState('ready')` 在同一批里，
   *   而 loading 态下聊天容器**根本没渲染** ⇒ `msgBoxRef.current` 是 null，
   *   effect 静默什么都不做，于是「消息区打开时停在顶部」。
   *   加上 state 后，ready 那一次重渲染（容器已存在）才会真正滚到底。
   */
  useEffect(() => {
    const box = msgBoxRef.current
    if (box === null) return
    box.scrollTop = box.scrollHeight
  }, [messages.length, state])

  // ★ 复制反馈通知后的短暂反馈（阿开 2026-11-24）。2 秒后自动复位，
  //   避免按钮永远显示「已复制」让人以为还能再点。
  const [copiedNotice, setCopiedNotice] = useState(false)

  /**
   * 复制「反馈通知」（阿开 2026-11-24 要的）。
   *
   * ★ 为什么需要它：反馈写在平台里，但**真正干活的人不一定在看平台**。
   *   要么是人转发到微信给协作伙伴，要么是贴给他的 Agent。
   *   没有这一段粘贴文本，客户就得自己手打任务 ID —— 而任务 ID 是 `tk_mwt...` 这种，
   *   手打必错。错一个字符，Agent 就找不到这条活。
   *
   * ★ 格式三条纪律：
   *   ① **纯文本**（粘微信不掉格式、贴给 Agent 不带 markdown 噪声）
   *   ② **人机同读**：前几行给人看，任务 ID 那行给 Agent 用
   *   ③ **不含内部路径 / 不含任何 Key**（对外件的红线，任务书 §五-5 同口径）
   *
   * ★ 为什么带「最后一条反馈是谁说的」：只说「有反馈」等于让人去猜要不要理它；
   *   说清楚「PM 说了什么」，收件人才能判断紧不紧急。
   */
  const copyFeedbackNotice = useCallback(async () => {
    if (task === null) return
    // ★ 取最后一条反馈。用 `at(-1)` 而不是 `messages[len-1]`：
    //   数组索引在 noUncheckedIndexedAccess 下返回 `T | undefined`，TS 报 5 处
    //   「last 可能 undefined」。显式判 null 后收窄，比到处写 ! 干净。
    const last: Message | null = messages.length > 0 ? (messages.at(-1) ?? null) : null
    const who = last === null ? '' : last.role === 'client' ? '你' : last.role === 'pm' ? '项目经理' : last.role
    const lines = [
      `【项目台有反馈】${task.title}`,
      `任务 ID：${task.taskId}`,
      `项目：${projectName}`,
      // ★ 状态必须走 statusLabel() 翻中文（唯一口径在 lib/contract.ts）。
      //   第一版直接写 task.status ⇒ 复制出去是「当前状态：delivered」——
      //   客户转发给协作伙伴时看到英文原码，跟 P2-3「状态词两套」是同一个毛病，
      //   而且这条是**要发给外部人**的，更不能露内部枚举值。
      `当前状态：${statusLabel(task.status)}`,
      '',
      last === null
        ? '项目经理已在这条任务下留了反馈，请查看最新内容与状态。'
        : `${who}在 ${fmtDateTime(last.createdAt)} 留了反馈：`,
      ...(last === null ? [] : [last.content]),
      '',
      // ★ 给 Agent 看的行动句：具体、可执行，不含内部实现细节
      `请打开项目台查看这条任务的最新反馈与状态，按反馈处理后在任务下回复并重新提交。`,
    ]
    const text = lines.filter((l) => l !== undefined).join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopiedNotice(true)
      window.setTimeout(() => setCopiedNotice(false), 2000)
    } catch {
      // ★ 剪贴板被浏览器拒（非 https / 无权限）时不能让按钮静默失效 ——
      //   退回到「选中文本让用户自己复制」，至少他知道发生了什么。
      window.prompt('自动复制被浏览器拒绝，请手动复制：', text)
    }
  }, [task, messages, projectName])

  /**
   * 下载一个交付件。
   *
   * ★ 为什么不用 `<a href download>` 直接跳：
   *   后端认的是 `Authorization` 请求头，浏览器点链接**带不上自定义头** ⇒ 必然 401。
   *   （本仓踩过一次同类：把带凭据的接口当静态文件链。）
   * ⇒ 用 fetch 带 token 拉成 blob，再造临时 URL 触发下载。
   *
   * ★ 为什么不用 dataURL（`a.href = 'data:...'`）：
   *   Edge/Chrome 的安全策略会拦 dataURL 的下载，点了没反应（本仓栽过）。
   */
  const onDownload = useCallback(
    async (a: TaskAttachment) => {
      try {
        const res = await fetch(a.downloadPath, {
          headers: token === null ? {} : { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          setAttErr(`下载失败（HTTP ${res.status}）—— 文件可能已被清理`)
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const el = document.createElement('a')
        el.href = url
        el.download = a.filename
        document.body.appendChild(el)
        el.click()
        document.body.removeChild(el)
        // ★ 必须 revoke，否则 blob 一直占内存（大 zip 会很明显）
        URL.revokeObjectURL(url)
        setAttErr(null)
      } catch {
        setAttErr('下载失败（网络或浏览器拦截）')
      }
    },
    [token],
  )

  const load = useCallback(async () => {
    setState('loading')
    try {
      const r = await getTask(token, taskId)
      if (!r.ok) {
        setState('error')
        return
      }
      setTask(r.data.task)
      setEvents(r.data.events)
      // ★ 面包屑回填（2026-11-24）：直接打开 /tasks/tk_xxx 时外层不知道项目名，
      //   服务端已经在 task 里 JOIN 出 projectName，顺势回传给外层。
      //   只在非空时调 —— 用空值回调会把已有的正确名字冲掉。
      const realProjectName = r.data.task.projectName
      if (onLoaded !== undefined && typeof realProjectName === 'string' && realProjectName !== '') {
        onLoaded(realProjectName)
      }
      // ★ 对话拉这条任务下的（taskId 过滤），不是全项目
      const m = await listMessages(token, { taskId, limit: 50 })
      setMessages(m.ok ? m.data.messages : [])
      // ★ 交付件单独拉。它失败**不该**让整页报错 ——
      //   任务本身能看，只是件列不出来，要如实说哪一半不行。
      try {
        const a = await listTaskAttachments(token, taskId)
        if (a.ok) {
          setAttachments(a.data.attachments)
          // ★ 期望数是这个端点的响应带来的（不是从 task 上再读一次）
          setAttachExpected(
            typeof a.data.attachmentsExpected === 'number' ? a.data.attachmentsExpected : null,
          )
          setAttErr(null)
        } else {
          setAttachments([])
          setAttachExpected(null)
          setAttErr('交付件列表读取失败（任务本身可正常查看）')
        }
      } catch {
        setAttachments([])
        setAttachExpected(null)
        setAttErr('交付件列表读取失败（任务本身可正常查看）')
      }
      setState('ready')
    } catch {
      setState('error')
    }
  }, [token, taskId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 补传一份附件（2026-11-24 阿开定 · 显式补传入口的后端动作）。
   *
   * ★★★ 为什么这个入口要「一直在」，而不是「失败才出现」：
   *   两段式派活意味着「附件不全」是**常态**，不是异常 ——
   *   网络断了、用户中途关了页面、后来才想起还要补一份，都会产生它。
   *   藏在错误提示里的按钮，正常状态下人根本不知道有这个能力。
   *
   * ★ 传完立刻重新拉一次列表：以服务端返回的 actual/expected 为准，
   *   不自己在前端 +1 猜 —— 猜出来的数字会跟库里不一致。
   */
  const doUploadAttachment = useCallback(
    async (file: File) => {
      if (token === null || attUploading) return
      setAttUploading(true)
      setAttMsg(null)
      const r = await uploadTaskAttachmentReq(token, taskId, file)
      setAttUploading(false)
      if (!r.ok) {
        // ★ 每种失败都说清是什么，不用「上传失败」一句话糊过去。
        // ★ 末尾用 `'message' in f` 收窄，而不是直接 f.message ——
        //   `insufficient-credits` 这个分支没有 message 字段（只有 shortfall），
        //   直接取会编译不过。上传接口正常不会返回它，但类型上必须穷尽。
        const f = r.failure
        let msg: string
        if (f.kind === 'network') msg = '网络不通，这份文件没传上（可以再试一次）'
        else if (f.kind === 'auth') msg = '凭据已失效，请重新登录后再传'
        else if (f.kind === 'forbidden') msg = '当前凭据不能往这条任务传附件'
        else if ('message' in f) msg = f.message
        else msg = '这份文件没传上'
        setAttMsg(`${file.name} 没传上：${msg}`)
        return
      }
      const d = r.data
      if (d.duplicate === true) {
        setAttMsg(`${d.filename} 已经在任务里了（内容完全相同），没有重复保存`)
      } else {
        setAttMsg(
          d.attachmentsExpected === null
            ? `${d.filename} 已上传`
            : `${d.filename} 已上传 —— 现在 ${d.attachmentsActual} / ${d.attachmentsExpected} 份` +
              (d.attachmentsComplete ? '（齐了）' : '（还差，继续补）'),
        )
      }
      // 重新拉列表，让「几份 / 齐没齐」跟服务端一致
      const a = await listTaskAttachments(token, taskId)
      if (a.ok) {
        setAttachments(a.data.attachments)
        setAttachExpected(
          typeof a.data.attachmentsExpected === 'number' ? a.data.attachmentsExpected : null,
        )
      }
    },
    [token, taskId, attUploading],
  )

  /** 执行验收动作 —— 成功后重载任务（拿新状态 + 新事件），失败给出可读原因 */
  const doVerdict = useCallback(
    async (action: 'accept' | 'reject') => {
      if (task === null || verdicting) return
      setVerdicting(true)
      setVerdictMsg(null)
      try {
        const r = await verdict(token, taskId, action, action === 'reject' ? rejectReason.trim() : undefined)
        if (r.ok) {
          const d = r.data
          if (d.alreadyTerminal) {
            // ★ 双击/重复提交：钱没动第二次，如实说，别让用户以为又扣了一遍
            setVerdictMsg({ kind: 'warn', text: '这条任务此前已经处理过了（本次没有重复扣费）。' })
          } else if (d.settlement !== null) {
            const s = d.settlement
            setVerdictMsg({
              kind: 'ok',
              text:
                action === 'accept'
                  ? `已验收通过。本次消耗 ${s.tokens} token，扣费 ${s.charged} 积分。`
                  : `已打回。本次消耗 ${s.tokens} token，扣费 ${s.charged} 积分。`,
            })
          } else {
            setVerdictMsg({ kind: 'ok', text: action === 'accept' ? '已验收通过。' : '已打回。' })
          }
          setConfirming(null)
          setRejectReason('')
          await load()
        } else {
          const f = r.failure
          if (f.kind === 'settlement-pending') {
            // ★ 关键：这不是失败 —— 事已经生效了，只是账没落
            setVerdictMsg({ kind: 'warn', text: f.message })
            await load()
          } else if (f.kind === 'conflict') {
            setVerdictMsg({ kind: 'warn', text: f.message })
            await load()
          } else if (f.kind === 'auth') {
            setVerdictMsg({ kind: 'err', text: '当前凭据无权做这个操作，请重新登录后再试。' })
          } else {
            setVerdictMsg({
              kind: 'err',
              text: f.kind === 'server-error' ? '系统暂时没能处理这次操作，请稍后重试。' : '网络不通，请稍后重试。',
            })
          }
        }
      } catch {
        setVerdictMsg({ kind: 'err', text: '网络不通，请稍后重试。' })
      } finally {
        setVerdicting(false)
      }
    },
    [task, verdicting, token, taskId, rejectReason, load],
  )

  const submit = useCallback(async () => {
    const content = draft.trim()
    if (content === '' || task === null || sending) return
    setSending(true)
    try {
      await sendMessage(token, { projectId: task.projectId, content, taskId })
      setDraft('')
      const m = await listMessages(token, { taskId, limit: 50 })
      setMessages(m.ok ? m.data.messages : [])
    } catch {
      // ★ 发送失败不改草稿 —— 让用户能重发，不让他白打一遍字
    } finally {
      setSending(false)
    }
  }, [draft, task, token, taskId, sending])

  if (state === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: T.faint }}>加载中…</div>
  }
  if (state === 'error' || task === null) {
    return (
      <EmptyState
        title="任务没加载出来"
        hint="重试一下"
        action={{ label: '重试', onClick: () => void load() }}
      />
    )
  }

  const needAccept = task.status === 'delivered'

  // ★ 任务健康度（是否卡住）。阈值取后端下发的，拿不到时回落 2 小时兜底。
  //   ★ 每次渲染取一次当前时间即可 —— 这里不是实时刷新场景，
  //     页面停留期间时间推移不影响「是否卡住」这个粗粒度判断。
  const health = assessTaskHealth(
    { status: task.status, updatedAt: task.updatedAt },
    Date.now(),
    stalledMs ?? DEFAULT_TASK_STALLED_MS,
  )

  return (
    <>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{task.title}</h1>
        <StatusChip
          tone={needAccept ? 'warn' : task.status === 'accepted' ? 'pass' : task.status === 'rejected' ? 'fail' : 'info'}
          label={
            task.status === 'delivered'
              ? '待验收'
              : task.status === 'accepted'
                ? '已通过'
                : task.status === 'rejected'
                  ? '已打回'
                  : task.status === 'running'
                    ? '进行中'
                    : '待认领'
          }
        />
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginBottom: 16 }}>
        {projectName} · Agent：{assigneeLabel(task)} · 更新 {task.updatedAt}
      </div>

      {/*
        ★ 任务卡住提示（2026-11-23 · 阿开拍 2 小时阈值）
        ★★ 语义边界：这里只「让 PM 看见」，**不做任何自动动作** ——
          不自动改归属、不自动退回公池。到点标黄，拍板仍由人做。
        ★ 为什么放在状态条上方：PM 一眼看到的第一件事应该是「这条要不要我处理」，
          而不是先读一堆细节。
      */}
      {health.stalled && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fdf6ec',
            border: '1px solid #e8c88a',
            borderLeft: '3px solid #b45309',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
            color: '#7a4a09',
            lineHeight: 1.7,
          }}
        >
          <strong>⏳ 这条任务已 {health.idleText} 没有进展</strong>
          <div style={{ fontSize: 12, color: '#8a5a1a', marginTop: 4 }}>
            可能卡住了。要不要换人？请由你决定 —— 系统不会自动改派。
          </div>
        </div>
      )}

      {/*
        ★★★ 2026-11-24 删掉这里原来的「大状态条」（四格进度，占 76px + padding）。

        为什么删：阿开把本页定成「对话为主」形态后，我实测发现**消息区只剩 68px 高**
        （视口 577 − 顶栏52 − 页头60 − 状态条76 − 任务描述96 − 反馈标题24 − 输入区 = 68）。
        68px 装不下一行半消息 —— 那不叫「方便滚动」，那叫「看不见」。

        而这条状态条是**重复展示**：
          · 页头已有 StatusChip 显示当前状态
          · 右栏「状态变更」有完整哈希链记录（谁在什么时候改的）
        ⇒ 留着它 = 用最贵的垂直空间，重复说一件已经说了两遍的事。

        ★ 这不是「砍功能」，是「把重复的那份收掉」——
          真要四格进度全貌，右栏那份记录更权威（带时间戳和操作人）。
      */}

      {/* ★★★ 2026-11-24 改：两栏撑满剩余高度（minHeight:0 是关键 ——
          没有它 flex 子项会被内容撑开，内部的 overflowY:auto 就永远不会生效，
          输入框也就钉不住。这是「局部滚动」能不能成立的分水岭）。 */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', minWidth: 0, flex: 1, minHeight: 0 }}>
        {/* ── 左栏：反馈在上（占满+内部滚动）、输入框钉底、交付物在下 ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* 任务描述 —— ★ 2026-11-24 收进折叠区（默认收起）。
              为什么：实测它占 96px，而消息区只剩 160px。任务描述是「看一遍就够」的，
              反馈是「天天要看」的 ⇒ 让常看的拿到高度，偶看的折起来。
              ★ 不是删：标题行永远可见（带前 40 字摘要），点一下全展开。 */}
          {task.detail !== null && task.detail !== '' && (
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <button
                onClick={() => setDetailDialog(true)}
                title="点击查看任务说明全文"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12.5,
                  color: T.text,
                  textAlign: 'left',
                }}
              >
                {/* ★ 2026-11-24：图标从 ▸/▾ 改成「查看」两个字 ——
                    这两个三角是「展开/收起」的意思，但现在点它是**开弹窗**，
                    用三角会让人以为内容会在原地长出来，点完发现跳了个窗，是误导。
                    ★ 形状要和结果一致：开门就是开门，不是拉抽屉。
                    ★ 为什么不用 🔍 emoji：实测在无 emoji 字体的机器上渲染成空心小方框，
                      而这是**唯一的入口提示**，字必须每个机器都能看见。⇒ 用中文。 */}
                <span style={{ fontSize: 11, color: T.dim, whiteSpace: 'nowrap' }}>查看</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>任务说明</span>
                <span
                  style={{
                    color: T.dim,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {task.detail.slice(0, 60)}
                </span>
              </button>
            </div>
          )}

          {/* ★★★ 2026-11-24 阿开实测报「任务说明点击展开就只能看到当前的内容，底部被截断」。
              实测：内联展开后 div 高 608px > 视口 577px ⇒ 它自己比屏幕高，底部必然看不见；
              且它 flexShrink:0 在左栏里，把消息区压到只剩 121px。
              ⇒ 改成弹窗查看（LongTextDialog），全文在弹窗里滚，不占左栏高度。
              ★ 原来这里有一段内联展开的 div，已删除 —— 留着就是「两份实现」，
                将来改一处漏一处。 */}

          {/* ★★★ 2026-11-24 阿开定：交付物移到反馈**下方**（见文件末尾），
              这里不再占位。原三种状态（有件/没件/失败）逻辑原样搬到下方，
              以下三条约束仍然成立，只是位置变了。 */}

          {/* ── 反馈（对话）：反馈在上，消息区自己滚，输入框钉底 ── */}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>反馈</div>
            {/* ★ 复制反馈通知（阿开 2026-11-24）：
                「任务详情页里的反馈沟通记录如果有沟通反馈，要有复制任务详情或者
                 沟通记录方便发通知给 Agent 或者（微信转发人类协作伙伴转发他的 Agent）？
                 建议是复制任务 ID 并提示语项目经理有反馈，请查看项目最新内容详情与状态」
                ⇒ 有反馈才出现（空反馈时复制什么东西？）；纯文本，人机同读。 */}
            {messages.length > 0 && (
              <button
                onClick={() => void copyFeedbackNotice()}
                title="复制一段可直接发给 Agent 或转发给协作伙伴的提醒"
                style={{
                  padding: '3px 10px',
                  fontSize: 11.5,
                  border: `1px solid ${T.border}`,
                  borderRadius: 5,
                  background: T.surface,
                  color: T.text,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copiedNotice ? '已复制' : '复制反馈通知'}
              </button>
            )}
          </div>
          <div
            style={{
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              background: T.surface,
              // ★ 占满左栏剩余高度；minHeight:0 让内部 overflow 真的生效
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* ── 消息区：自己滚，输入框不跟着走（微信/飞书形态）── */}
            <div
              ref={msgBoxRef}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: 14,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ fontSize: 12, color: T.faint, padding: '12px 0', textAlign: 'center' }}>
                  还没有反馈
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.messageId} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: T.dim, marginBottom: 3 }}>
                      {/* ★ 原来直出 ISO 原文（`2026-11-22T15:21:43.920867+00:00`）——
                          带微秒、带时区、带 T，人读不了。统一走 fmtDateTime。 */}
                      {m.role === 'client' ? '你' : m.role === 'pm' ? 'PM' : m.role} · {fmtDateTime(m.createdAt)}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {m.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── 输入区：钉在卡片底部，消息再多也不动 ──
                ★ 上边框把它和滚动区分开：让「能滚的」和「不动的」一眼看得出边界。 */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: 10,
                borderTop: `1px solid ${T.border}`,
                background: T.surface,
                flexShrink: 0,
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                placeholder="回一句…"
                style={{
                  flex: 1,

                  padding: '7px 10px',
                  fontSize: 13,
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  background: T.bg,
                  color: T.text,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => void submit()}
                disabled={draft.trim() === '' || sending}
                style={{
                  padding: '7px 16px',
                  fontSize: 13,
                  border: 'none',
                  borderRadius: 6,
                  background: draft.trim() === '' || sending ? T.surfaceSoft : T.accent,
                  color: draft.trim() === '' || sending ? T.faint : '#fff',
                  cursor: draft.trim() === '' || sending ? 'default' : 'pointer',
                }}
              >
                {sending ? '发送中' : '发送'}
              </button>
            </div>
          </div>

          {/* ═══ 交付物（阿开 2026-11-24 定：放在反馈**下方**，默认收起）═══
              ★ 为什么默认收起：交付物是「要下载时才看」，反馈是「每次都要看」。
                常驻展开等于让偶用的下载区挤占天天看的对话高度。
              ★ 三种状态仍然分开（有件 / 确认没件 / 读失败）——
                把「故障」装成「没件」会误导用户，这三条判断必须分开。 */}
          <div style={{ flexShrink: 0, marginTop: 12 }}>
            {/* ══════════════════════════════════════════════════════════
                任务附件 · 输入件（铺主传的 · 2026-11-24 阿开定）
                ══════════════════════════════════════════════════════════
                ★★★ 为什么这块「一直在」，即使一份都没有：
                  它是**显式补传入口** —— 两段式派活下「附件不全」是常态
                  （派活时网络断了、中途关页面、后来想起要补）。
                  藏起来的话，人在正常情况下根本不知道有这个能力，
                  等真出问题时就只能重新派一条活（白冻一次预算）。
                ★ 为什么显示「2 / 3」这样的读数：
                  只说「附件不齐」人不知道差多少，也没法判断要不要补。
                ★ 为什么和「交付物」分成两块：
                  输入是「我要它做什么」，产出是「它做成了什么」。
                  混在一起，验收时没法对账。 */}
            <div
              style={{
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                background: T.surface,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.text,
                  flexWrap: 'wrap',
                }}
              >
                <span>任务附件（输入件）</span>
                <span style={{ fontSize: 11.5, fontWeight: 400, color: T.dim }}>
                  {attachExpected === null
                    ? `${inputFiles.length} 份`
                    : `${inputFiles.length} / ${attachExpected} 份`}
                </span>
                {/* ★ 不齐时必须显眼 —— 它挡住验收，不说人就会一直点不动 */}
                {attachExpected !== null && inputFiles.length < attachExpected && (
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 400,
                      color: '#92400e',
                      background: '#fffbeb',
                      border: '1px solid #f0d090',
                      borderRadius: 4,
                      padding: '1px 7px',
                    }}
                  >
                    还差 {attachExpected - inputFiles.length} 份 · 补齐后才能验收
                  </span>
                )}
                {attachExpected !== null && inputFiles.length >= attachExpected && (
                  <span style={{ fontSize: 11.5, fontWeight: 400, color: '#15803d' }}>已齐</span>
                )}

                {/* ── 补传按钮：一直在 ── */}
                <input
                  ref={attFileRef}
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    // 清空 value，否则同一个文件选第二次不触发 change
                    e.target.value = ''
                    if (f !== undefined) void doUploadAttachment(f)
                  }}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  disabled={attUploading}
                  onClick={() => attFileRef.current?.click()}
                  style={{
                    marginLeft: 'auto',
                    padding: '4px 11px',
                    fontSize: 11.5,
                    background: T.surfaceSoft,
                    border: `1px solid ${T.border}`,
                    borderRadius: 5,
                    color: attUploading ? T.faint : T.text,
                    cursor: attUploading ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {attUploading ? '上传中…' : '+ 补传附件'}
                </button>
              </div>

              <div style={{ padding: '0 14px 12px' }}>
                {inputFiles.length === 0 && (
                  <div style={{ fontSize: 12.5, color: T.faint, paddingTop: 4 }}>
                    {attachExpected === null
                      ? '这条任务没有要求附件。需要给 Agent 补充参考资料就点「补传附件」。'
                      : '还没有传附件 —— 点右上「补传附件」把要求/参考资料放上来。'}
                  </div>
                )}
                {inputFiles.length > 0 &&
                  inputFiles.map((a) => (
                    <div
                      key={a.attachmentId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 0',
                        borderTop: `1px solid ${T.border}`,
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{a.filename}</span>
                      <span style={{ color: T.dim, whiteSpace: 'nowrap' }}>{fmtBytes(a.bytes)}</span>
                      <span style={{ color: T.faint, whiteSpace: 'nowrap' }}>
                        {fmtDateTime(a.uploadedAt)}
                      </span>
                      <a
                        href={a.downloadPath}
                        style={{ color: '#2f5fd0', whiteSpace: 'nowrap', textDecoration: 'none' }}
                        onClick={(e) => {
                          e.preventDefault()
                          void onDownload(a)
                        }}
                      >
                        下载
                      </a>
                    </div>
                  ))}

                {attMsg !== null && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '7px 10px',
                      background: T.bg,
                      borderRadius: 5,
                      fontSize: 12,
                      color: T.dim,
                      lineHeight: 1.6,
                    }}
                  >
                    {attMsg}
                  </div>
                )}
              </div>
            </div>

            {(uniqAttachments.length > 0 || attErr !== null || state === 'ready') && (
              <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface }}>
                {/* 标题行：可点击展开/收起 */}
                <button
                  onClick={() => setAttOpen((v) => !v)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.text,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 11, color: T.dim, width: 10 }}>{attOpen ? '▾' : '▸'}</span>
                  <span>
                    交付物（{outputFiles.length}）
                    {dupCount > 0 && (
                      <span style={{ fontSize: 11.5, fontWeight: 400, color: T.dim, marginLeft: 8 }}>
                        · 另有 {dupCount} 条同内容重复提交，已合并显示
                      </span>
                    )}
                  </span>
                </button>

                {attOpen && (
                  <div style={{ padding: '0 14px 12px' }}>
                    {/* ① 有件 */}
                    {outputFiles.length > 0 &&
                      outputFiles.map((a) => (
                        <div
                          key={a.attachmentId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 0',
                            borderTop: `1px solid ${T.border}`,
                            fontSize: 12.5,
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{a.filename}</span>
                          <span style={{ color: T.dim, whiteSpace: 'nowrap' }}>{fmtBytes(a.bytes)}</span>
                          <span style={{ color: T.faint, whiteSpace: 'nowrap' }}>
                            {fmtDateTime(a.uploadedAt)}
                          </span>
                          <a
                            href={a.downloadPath}
                            style={{ color: '#2f5fd0', whiteSpace: 'nowrap', textDecoration: 'none' }}
                            // ★ 下载要带凭据 —— 后端认 Authorization 头，浏览器直接点链接带不上。
                            //   所以不直接跳转，交给页面用 fetch 拉（见下方 onDownload）。
                            onClick={(e) => {
                              e.preventDefault()
                              void onDownload(a)
                            }}
                          >
                            下载
                          </a>
                        </div>
                      ))}

                    {/* ② 确认没件（事实，不是错误） */}
                    {outputFiles.length === 0 && attErr === null && state === 'ready' && (
                      <div style={{ paddingTop: 8, fontSize: 12.5, color: T.faint }}>
                        还没有交付件。Agent 交件后会出现在这里。
                      </div>
                    )}

                    {/* ③ 读失败（故障，要如实说，不许装成"没件"） */}
                    {attErr !== null && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '8px 10px',
                          background: '#fdeeee',
                          border: '1px solid #e0b4b4',
                          borderRadius: 6,
                          fontSize: 12.5,
                          color: '#a32626',
                        }}
                      >
                        {attErr}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 右栏：拍板状态 + 判据 ──
            ★★ 2026-11-24 修横向滚动条（阿开实测「状态变更都挤出框外」）：
            `width:300` 只是**希望宽度**，flex 子项默认 `min-width:auto`——
            内容里一旦有不可断的长串（64 位 sha256 / `expires:2026-12-23T10:45:40.899Z`），
            这个 div 就会被撑得比 300 宽，于是整页出现横向滚动条。
            `minWidth:0` + `overflowWrap` 才是真正的「不许溢出」声明。
            ★ 同时 300 → 340：状态变更那行是「时间 · 状态→状态 · 谁」三段，
              300px 装不下中文，怎么看都要折行。 */}
        {/* ★ 右栏也能自己滚：左栏现在定高，右栏若不定高，长内容会把整页撑破。
             两栏各自滚 = 谁都不牵着谁走。 */}
        <div style={{ width: 340, flexShrink: 0, minWidth: 0, overflowWrap: 'anywhere', overflowY: 'auto', minHeight: 0 }}>
          {/* ★ 验收操作区：现在不做按钮，改用明确说明 */}
          <div
            style={{
              padding: '14px 16px',
              background: needAccept ? '#fdf6ec' : T.surface,
              border: `1px solid ${needAccept ? '#f0dcc0' : T.border}`,
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            {needAccept ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#b45309', marginBottom: 8 }}>
                  这份交付，你认不认？
                </div>

                {/* 结果提示（成功/幂等/已生效待结算/失败，四种文案不同） */}
                {verdictMsg !== null && (
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.7,
                      marginBottom: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background:
                        verdictMsg.kind === 'ok' ? '#eef7ee' : verdictMsg.kind === 'warn' ? '#fdf6ec' : '#fdeeee',
                      color: verdictMsg.kind === 'ok' ? '#256b25' : verdictMsg.kind === 'warn' ? '#b45309' : '#a32626',
                    }}
                  >
                    {verdictMsg.text}
                  </div>
                )}

                {confirming === null ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      disabled={verdicting}
                      onClick={() => {
                        setVerdictMsg(null)
                        setConfirming('accept')
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 0',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#fff',
                        background: verdicting ? '#9ab89a' : '#2f7d32',
                        border: 'none',
                        borderRadius: 6,
                        cursor: verdicting ? 'not-allowed' : 'pointer',
                      }}
                    >
                      验收通过
                    </button>
                    <button
                      type="button"
                      disabled={verdicting}
                      onClick={() => {
                        setVerdictMsg(null)
                        setConfirming('reject')
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 0',
                        fontSize: 13,
                        fontWeight: 600,
                        color: verdicting ? '#b89a9a' : '#a32626',
                        background: T.surface,
                        border: `1px solid ${verdicting ? T.border : '#e0b4b4'}`,
                        borderRadius: 6,
                        cursor: verdicting ? 'not-allowed' : 'pointer',
                      }}
                    >
                      打回重做
                    </button>
                  </div>
                ) : (
                  // ── 二次确认（页面内，不用 window.confirm）──
                  <div>
                    <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.8, marginBottom: 8 }}>
                      {confirming === 'accept'
                        ? '确认这份交付合格？确认后会按实际消耗结算费用。'
                        : '打回后 Agent 需要重做，请说明哪里不合格：'}
                    </div>
                    {confirming === 'reject' && (
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="例如：验收判据第 2 条没通过，导出文件缺了汇总页"
                        rows={3}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          fontSize: 12,
                          padding: 8,
                          borderRadius: 6,
                          border: `1px solid ${T.border}`,
                          resize: 'vertical',
                          marginBottom: 8,
                          fontFamily: 'inherit',
                        }}
                      />
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={verdicting}
                        onClick={() => void doVerdict(confirming)}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#fff',
                          background: verdicting ? '#999' : confirming === 'accept' ? '#2f7d32' : '#a32626',
                          border: 'none',
                          borderRadius: 6,
                          cursor: verdicting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {verdicting ? '处理中…' : confirming === 'accept' ? '确认通过' : '确认打回'}
                      </button>
                      <button
                        type="button"
                        disabled={verdicting}
                        onClick={() => {
                          setConfirming(null)
                          setRejectReason('')
                        }}
                        style={{
                          flex: 1,
                          padding: '7px 0',
                          fontSize: 12,
                          color: T.dim,
                          background: T.surface,
                          border: `1px solid ${T.border}`,
                          borderRadius: 6,
                          cursor: verdicting ? 'not-allowed' : 'pointer',
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.8 }}>
                {task.status === 'accepted'
                  ? '已验收通过'
                  : task.status === 'rejected'
                    ? '已打回，等 Agent 重做'
                    : task.status === 'cancelled'
                      ? '这条任务已取消'
                      : 'Agent 还在处理，等交付后才能验收'}
                {/* 非待验收态也把上一次的结果提示留着，避免用户以为没反应 */}
                {verdictMsg !== null && (
                  <div style={{ marginTop: 8, color: verdictMsg.kind === 'err' ? '#a32626' : T.dim }}>
                    {verdictMsg.text}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 状态变更记录（哈希链，真实数据）*/}
          {events.length > 0 && (
            <div
              style={{
                padding: '12px 16px',
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>状态变更</div>
              {events.map((e) => (
                <div
                  key={e.eventId}
                  style={{
                    fontSize: 11,
                    color: T.dim,
                    marginBottom: 6,
                    lineHeight: 1.7,
                    // ★ 兜底：即使 actorLabel 截了，状态串里也可能有长的
                    //   （如 `pending:ag_mwtbd4si_yrr3ylgf`）⇒ 允许任意位置断行，绝不撑破
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  <span title={e.at}>{fmtDateTime(e.at)}</span>
                  {' · '}
                  {/* ★ 2026-11-24 阿开实测：这里原来直接输出 `pending:ag_xxx → delivered`，
                      全是代码。改走 statusLabel() 翻中文（唯一口径在 lib/contract.ts）。 */}
                  <span style={{ color: T.text }}>
                    {statusLabel(e.fromState)} → {statusLabel(e.toState)}
                  </span>
                  {' · '}
                  {/* ★ 操作人原来是 64 位 sha256，一个值就把右栏撑破。
                      短的直显（如 `tenant:t1`），长的只露前 6 位 + 悬停看全。 */}
                  <span title={e.actor}>{actorLabel(e.actor)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ★ 任务说明全文弹窗（2026-11-24）：放在最外层，脱离左右栏的 flex 约束。
          为什么放这里而不是左栏里：弹窗是 position:fixed，放哪都能盖满屏，
          但放在左栏里会被祖先的 overflow/transform 影响定位（本仓栽过）。 */}
      {detailDialog && task.detail !== null && task.detail !== '' && (
        <LongTextDialog
          title="任务说明"
          text={task.detail}
          onClose={() => setDetailDialog(false)}
        />
      )}
    </>
  )
}
