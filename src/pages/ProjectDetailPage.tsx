/**
 * P2 项目详情页
 * =====================================================================
 * 设计依据：设计稿 §三 P2 + 与后端数据契约核对后的可做性判定
 *
 * ★★★ 本页按数据契约核对的结论做了「有取舍的落地」，不是照抄设计稿
 *
 *   设计稿要的         → 本页做法            原因（数据契约核对结论）
 *   ─────────────────────────────────────────────────────────────
 *   大状态条            ✅ 做了              从 pm_tasks 聚合，数据齐
 *   任务表 7 行          ✅ 做了              pm_tasks 全有
 *   「一句下一步」       ✅ 做了              status 推导，不需新字段
 *   预算卡 ¥5,000/8,000 ❌ 不做              **零预算字段**（小D 拍丙：第一版不做）
 *   交付物已校验/未校验  ⚠️ 只显示文件名     **artifacts 无校验状态列**
 *   取消项目/重派按钮    ❌ 不做              **无对应端点**
 *
 *   ★ 不做的地方**不留空框**，也不写「即将上线」——
 *     留空框让人以为加载失败；写「即将上线」是提前承诺（产品铁律：不是搭架子是失约）。
 *     做法：**整块不渲染**，等后端有了再加回来。
 *
 * ★ 「下一步」这句话的克制（设计稿原话）：
 *     「一页只允许有一句『你现在该干嘛』」
 *   ⇒ 本页只在**页面级**给一句；任务表每行的「下一步」是**行级**的，两者不冲突。
 */

import { useCallback, useEffect, useState } from 'react'
import type { Project, Task, TaskStatus, Agent } from '../lib/contract'
import { assigneeLabel, STATUS_CHIP as TASK_STATUS_CHIP } from '../lib/contract'
import { listTasks, listAgents, renameProject } from '../lib/api'
import { T } from '../styles/tokens'
// ★ 路径修正：本文件在 pages/ 下，组件在 components/ 下 —— 少了 ../ 会找不到
import { StatusBar } from '../components/StatusBar'
import { StatusChip, DataTable, EmptyState } from '../components/base'
import { ProjectNameForm } from '../components/ProjectNameForm'
import type { Column } from '../components/base'
import { ProjectAgentsPanel } from '../components/ProjectAgentsPanel'
import { DispatchTaskPanel } from '../components/DispatchTaskPanel'
// ★ 预算止损横幅（阿开 2026-11-24：顶栏下方长期展示、不可关闭）
import { BudgetAlertBanner } from '../components/BudgetAlertBanner'
import { DailyClaimBar } from '../components/DailyClaimBar'
import { BaselineFilesCard } from '../components/BaselineFilesCard'
import type { BudgetAlertPayload } from '../lib/api'
import { getProjectAlert } from '../lib/api'

/**
 * 状态 → 胶囊色调 + 文字
 *
 * ★ 2026-11-24 搬去 `lib/contract.ts` 成为唯一口径（任务详情页的状态变更也要用）。
 *   这里保留引用名，避免下面十几处使用点全改一遍。
 */
const STATUS_CHIP = TASK_STATUS_CHIP

/**
 * 行级「下一步」—— 回答「我要不要动手」，不是「它是什么状态」
 *
 * ★ 设计稿特意加的这列，理由原文：
 *     「它回答的是『我要不要动手』，不是『它是什么状态』」
 *   ⇒ 所以「已通过」的下一步是「查看交付物」而不是「已完成」。
 */
function nextStepOf(task: Task): string {
  switch (task.status) {
    case 'pending':
      return task.assignee === null ? '未派' : '等 Agent 接'
    case 'dispatched':
      return '等 Agent 开工'
    case 'running':
      return '在干'
    case 'delivered':
      return '待你验收'
    case 'accepted':
      return '查看交付物'
    case 'rejected':
      return '等重做'
    case 'cancelled':
      return '—'
  }
}

/**
 * ISO 时间 → 紧凑显示（2026-11-24）
 *
 * `2026-11-23T23:48:56.989Z` → `11-23 23:48`
 *
 * ★ 为什么要缩短，而不是把列宽留着：
 *   阿开要「把右边收紧」⇒ 时间列 128→116。但后端给的是 24 字符的 ISO 全量，
 *   116px 装不下 ⇒ 折两行 ⇒ 行高从 54 撑到 72。
 *   **省下的宽度变成了多出的高度** —— 那不是收紧，是换了个方向变胖。
 *   ⇒ 缩显示 + 缩列宽，两个一起做才叫收紧。
 *
 * ★ 为什么省掉年份：这是**项目内任务列表**。项目寿命以月计，
 *   年份信息冗余；真正有用的是「哪天几点更新的」。
 * ★ 为什么省掉秒和毫秒：人看任务列表不需要秒级精度。
 *   ★ 完整时间仍然拿得到 —— 鼠标悬停时的 `title` 里是原始值（见下方 title）
 *     以及点进任务详情页有完整时间。
 *
 * ★ 时区：后端存 UTC（`Z` 结尾）。这里**转成本地时间**再显示 ——
 *   客户在 UTC+8，看到 «07:48» 而不是 «23:48» 才是对的。
 *   不转换的话，客户会觉得「我明明早上改的，怎么说昨天」。
 */
function fmtShortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso // 解析不了就原样显示，不吞掉信息
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 生成「复制任务」要放进剪贴板的那段文字（2026-11-24 阿开令）
 *
 * ★ 阿开原话：「在状态列前面增加一个按钮，点击复制任务（复制任务ID和任务标题，
 *   以及方便转发给Agent或者微信发给人类的提示语）」
 *
 * ## 为什么要有它（解决什么真实麻烦）
 * 现在的流程是：客户要把一条活交给 Agent，得自己去页面上抄任务 ID，
 * 再抄标题，再自己想怎么说 —— 抄错一个字符，Agent 就领不到活。
 * 这段文字是**一次成型的转发包**：粘到微信给人看能懂，粘给 Agent 能用。
 *
 * ## 为什么写成三段而不是一段散文
 *   第 1 行：一眼看懂是什么（人看的）
 *   第 2 行：可机器读的键值（Agent / MCP 看的）
 *   第 3 行：明确「要它做什么」（人转述时不用自己想措辞）
 * ⇒ 人有人的读法，机器有机器的读法，同一份文字两种用途。
 *
 * ★ 为什么不包含项目名/预算/状态：
 *   那些是**会变**的，写进转发文字里，对方看到的可能是旧值。
 *   任务 ID 和标题是**不变的**（派出后正文不可改），可以放心外传。
 *   ★ 也不含任何凭据 —— 这段文字会被粘到微信里，凭据一个字都不能进。
 */
function buildTaskShareText(task: Task, projectName: string): string {
  const lines = [
    `【任务】${task.title}`,
    `任务 ID：${task.taskId}`,
    `所属项目：${projectName}`,
  ]
  // 详细说明跟着走：Agent 领活要靠它，人不转述就丢了上下文
  if (task.detail !== null && task.detail.trim() !== '') {
    lines.push(`任务说明：${task.detail.trim()}`)
  }
  lines.push('')
  lines.push('（把上面这段发给 Agent 即可领这条活；也可以直接发给同事看）')
  return lines.join('\n')
}

/**
 * 「复制任务」小按钮（2026-11-24 阿开令）
 *
 * ## 为什么要这个按钮
 * 客户要把活交给 Agent 时，得手工抄任务 ID + 标题 + 自己编措辞，
 * 抄错一个字符 Agent 就领不到。这个按钮一次把「转发包」放进剪贴板。
 *
 * ## 为什么复制内容由 `buildTaskShareText` 统一生成
 * 不在按钮里现拼 —— 那样「任务详情页」或将来别处想复用时会各拼一份，
 * 两份迟早漂移（本仓血账：同一语义 ≥2 处实现必漂移）。
 *
 * ## 为什么点完要变「已复制」而不是只弹一个 toast
 * 剪贴板操作**肉眼看不见结果**。不给出可见反馈，用户会怀疑「到底复制没有」
 * 于是连点三次 —— 而每次都要重新选中，反而更容易复制错。
 * ⇒ 按钮自己变文字，最省事、最不容易误解。
 */
function CopyTaskButton({
  task,
  projectName,
  onCopied,
  justCopied,
}: {
  task: Task
  projectName: string
  onCopied: () => void
  justCopied: boolean
}): React.JSX.Element {
  /**
   * 写剪贴板。
   *
   * ★★★ 三层降级（2026-11-24 实测后改，原来只有两层）
   *
   * 第一版写的是：
   *     if (navigator.clipboard 存在 && 安全上下文) { await writeText() }
   *     else { execCommand 降级 }
   *     catch → prompt
   *
   * **实测踩到的问题**：无头浏览器 / 没有剪贴板权限的场景里，
   * `navigator.clipboard` **存在**、`isSecureContext` 为 **true**，
   * 但 `writeText()` 被拒绝（NotAllowedError）⇒ 直接落到 catch ⇒ 弹 prompt。
   * 也就是说：**「API 存在」不等于「能用」**，第一版把「存在」当成了「可用」，
   * 于是唯一的降级路径（execCommand）在最需要它的时候没有被走到。
   *
   * ⇒ 改成三层：现代 API 失败后，**先试 execCommand，实在不行才弹框**。
   *   这样「剪贴板权限被拒」这种常见情况用户是无感的。
   */
  async function doCopy() {
    const text = buildTaskShareText(task, projectName)

    // ── 第一层：现代 API（需要安全上下文 + 权限）──
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        onCopied()
        return
      } catch {
        // ★ 不 return、不弹框 —— 继续往下试 execCommand。
        //   权限被拒 / iframe 限制 / 无头环境都会走到这里，是**常见**情况。
      }
    }

    // ── 第二层：execCommand（老 API，http 下也能用）──
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      // ★ 必须移出视口而不是 display:none —— display:none 的元素选不中，复制会失败
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      // ★ readOnly：防止移动端聚焦时弹出键盘，把页面顶上去
      ta.setAttribute('readonly', '')
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) {
        onCopied()
        return
      }
      // execCommand 返回 false ⇒ 真的复制不了，落到第三层
    } catch {
      // 继续落到第三层
    }

    // ── 第三层：让用户手选 ──
    // ★ 到这一步说明浏览器确实不让写剪贴板。把内容给出来，总比
    //   「点了没反应、内容也没了」强。
    window.prompt('浏览器不允许自动复制，请手动复制下面这段：', text)
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // ★ 阻止冒泡：这一列在表格行里，点按钮不该同时触发「打开任务」
        e.stopPropagation()
        void doCopy()
      }}
      title="复制任务 ID、标题和说明（可直接发给 Agent 或同事）"
      style={{
        padding: '2px 7px',
        fontSize: 11,
        lineHeight: '16px',
        background: justCopied ? '#eef7ee' : 'transparent',
        border: `1px solid ${justCopied ? '#b7d8b7' : T.border}`,
        borderRadius: 4,
        color: justCopied ? '#15803d' : T.dim,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {/* ★ 2026-11-24 阿开：「复制按钮可以多几个字改为【复制任务给你的Agent同事】
          保持鼠标停留的提示内容不变（不知道字数会不会太多了）」。
          —— title（悬停提示）一个字没动；只把按钮上的可见文字说全。
          为什么值得说全：「复制」两个字放在任务行里，第一眼不知道复制的是什么
          （是任务 ID？整行？还是这条任务的说明？），说全了不用悬停也能懂。
          11 个字 × 11px ≈ 130px，列宽已相应从 52 放到 148。 */}
      {justCopied ? '已复制' : '复制任务给你的Agent同事'}
    </button>
  )
}

/**
 * 项目整体状态 = 从「服务端计数 + 可见任务」推出「走到哪一段」
 *
 * ★ 为什么不能只看 projects.status：
 *   `projects.status` 只有 `active` / `archived` 两个值，**答不出「这个项目做到哪了」**。
 *
 * ★★ 优先用服务端计数（`project.taskTotal/taskDone/taskPendingAccept`）：
 *   因为按 Agent 可见性过滤后 `tasks` 只剩「我能看见的那几条」，
 *   用它推状态会出现「项目明明在跑，我这边显示待认领」。
 *   服务端计数是同租户真实值，不受 Agent 视野影响。
 */
function projectStageOf(project: Project, tasks: readonly Task[]): TaskStatus {
  const total = project.taskTotal ?? tasks.length
  if (total === 0) return 'pending'
  const pendingAccept = project.taskPendingAccept ?? tasks.filter((t) => t.status === 'delivered').length
  const done = project.taskDone ?? tasks.filter((t) => t.status === 'accepted').length
  if (pendingAccept > 0) return 'delivered'
  if (done >= total) return 'accepted'
  // ★ 剩下「在跑」还是「待认领」，只能看可见任务里有没有 running。
  //   看不到 running 不等于没在跑（只是不归我）—— 所以这里退回「待认领」是保守值，
  //   真正准确的判断要等「按项目查全部任务」的铺主接口。
  if (tasks.some((t) => t.status === 'running')) return 'running'
  return 'pending'
}

export interface ProjectDetailPageProps {
  project: Project
  token: string
  onOpenTask: (taskId: string) => void
  /** 跳去「我的 Agent」—— 邀请面板空库时给用户一条真能点的路 */
  onGoToLibrary: () => void
  /**
   * ★ 从「我的 Agent」点「派活」跳过来时带的预选人（2026-11-24 阿开定）。
   *
   * 透传给 DispatchTaskPanel 的 initialAgentId ⇒ 面板一展开就选中这个人。
   * ★ 只在派活跳转时才有值；从项目列表正常进来是 undefined。
   */
  preselectAgentId?: string | undefined
  /**
   * ★ 改名成功后通知父组件（2026-11-24 加）。
   *
   * 为什么需要：`project` 是**父组件传下来的 prop**，本页改不了它。
   * 本页用 `localName` 立刻显示新名字，但父组件手里的还是旧值 ——
   * 用户返回项目列表再点进来，看到的会是旧名（像「改名没生效」）。
   * ⇒ 让父组件重拉列表，两边口径一致。
   */
  onRenamed?: (() => void) | undefined
}

/**
 * 紧凑读数：`标签 数字` 横排，不占大卡。
 *
 * ★ 为什么不用 StatCard：StatCard 是「一屏只有两三个数字」时的形态（大内边距 +
 *   大字 + 副标题），三个并排就占掉一整行 ~80px。阿开实测「任务表要拉下去才看得见」
 *   ⇒ 项目页的统计是**辅助信息**，不该按「主内容」的规格占地方。
 *
 * ★ 数字仍是 22px 而不是 12px：它要能一眼扫到。
 *   压缩的是留白，不是可读性。
 *
 * ★★★ 为什么数字要占固定宽度（阿开 2026-11-24 原话）：
 *   「建议数字空间放大3倍左右预留大概3位数的空间？现在一位数显得有点挤」
 *
 *   看起来是「一位数窄」，根子是**位数一变，整块就跟着位移**：
 *   · 任务从 9 条涨到 10 条 ⇒ 数字从 1 位变 2 位 ⇒ 「已完成」「待你验收」整体右移
 *   · 每次刷新数字变了，右边两块就跳一下 —— 眼睛一直在追位置
 *
 *   ⇒ 三个数字**统一占 3 位数宽**（`minWidth` + 等宽字体 + 右对齐）：
 *     一位数和三位数的块宽一样，数字变了只有字符变，块不动。
 *
 * ★ 为什么是 3 位而不是更多：
 *   这是**单个项目**的任务数。真实量级是几十，上百已是极端。
 *   预留 3 位（999）覆盖到「三位数不会挤」，再多就是为不会发生的情况浪费横向空间。
 *   真出现 4 位数时 minWidth 不是 maxWidth —— 会自动撑开，不会把数字截掉。
 *
 * ★ 为什么用 `fontVariantNumeric: 'tabular-nums'`：
 *   比例字体里 `1` 比 `8` 窄，就算给了固定宽度，数字本身也会左右晃。
 *   等宽数字让每一位占同样宽度，读数才是「对齐」而不是「大致对齐」。
 */
function MiniStat({
  label,
  value,
  tone = 'info',
}: {
  label: string
  value: number
  tone?: 'pass' | 'warn' | 'muted' | 'info'
}): React.JSX.Element {
  const color = tone === 'pass' ? '#2f7d32' : tone === 'warn' ? '#b45309' : tone === 'muted' ? T.faint : T.text
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 12, color: T.dim, whiteSpace: 'nowrap' }}>{label}</span>
      <span
        style={{
          // ★ 原 18px → 22px（阿开要「放大 3 倍左右的空间」，指的是**占位**不是字号；
          //   字号直接 ×3 会喧宾夺主，所以字号适度放大 + 用 minWidth 撑出 3 位空间）
          fontSize: 22,
          fontWeight: 600,
          color,
          lineHeight: 1,
          // ★ 钉死 3 位数宽度（22px 字号下 3 位约 40px，留 44px 有余量）
          minWidth: 44,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function ProjectDetailPage({
  project,
  token,
  onOpenTask,
  onGoToLibrary,
  preselectAgentId,
  onRenamed,
}: ProjectDetailPageProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  /**
   * 刚复制过的那条任务 id（2026-11-24 「复制任务」按钮的反馈状态）。
   *
   * ★ 为什么记 id 而不是 boolean：一张表里有多行，boolean 会让**所有行**
   *   同时变成「已复制」—— 用户不知道到底复制了哪一条。
   *
   * ★ 为什么 2 秒后要清掉：不清的话它会一直显示「已复制」，
   *   用户下次想复制时会以为已经复制过了（其实剪贴板可能早被别的操作覆盖）。
   *   反馈是**一次性的确认**，不是永久状态。
   */
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  /**
   * 2 秒后自动清掉「已复制」标记。
   *
   * ★ 为什么用 useEffect 而不是 setTimeout 塞在点击回调里：
   *   点击回调里的 setTimeout 在组件卸载后仍会触发 setState（React 警告），
   *   而且连点两次会有两个计时器竞争 —— 先点的那个先清，把第二次的反馈也清掉了。
   *   effect 用 `copiedTaskId` 做依赖，每次变化自动重置计时器，语义正好。
   */
  useEffect(() => {
    if (copiedTaskId === null) return
    const t = window.setTimeout(() => setCopiedTaskId(null), 2000)
    return () => window.clearTimeout(t)
  }, [copiedTaskId])
  /**
   * 租户 Agent 库 —— 用来算「这个项目还能邀谁」。
   * ★ 拉失败不影响主流程（任务照常显示），只是「邀请」里没有可选项。
   *   ⇒ 单独 try，不与 tasks 的 state 耦合。
   */
  const [library, setLibrary] = useState<Agent[]>([])
  // ★ 预算止损预警（轮询填充）—— 声明放在所有 hooks 区，不散落在 effect 后面
  const [budgetAlert, setBudgetAlert] = useState<BudgetAlertPayload | null>(null)
  // ★ 签到后 +1 ⇒ 触发横幅重新拉取（领了分可能压回预警线下）
  const [claimTick, setClaimTick] = useState(0)

  // ── 改项目名（2026-11-24 加）──
  //
  // ★ 阿开实测问「项目名称是否支持改名称？」—— 之前根本没有改名的入口。
  //   名字起错了只能删项目重建，而项目里已经派的活、传的附件会一起没了。
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  // ★ 本地覆盖：改名成功后立刻显示新名字，不等父组件重拉。
  //   父组件把 project 当 prop 传进来，这里改不了它 ——
  //   用局部 state 记「本页刚改成什么」，父组件刷新后自然以 prop 为准。
  const [localName, setLocalName] = useState<string | null>(null)
  const shownName = localName ?? project.name

  const load = useCallback(async () => {
    setState('loading')
    // ★ Agent 库独立拉：失败不拖累任务列表（两个数据源，互不连坐）
    void listAgents(token).then((r) => {
      if (r.ok) setLibrary(r.data.agents)
    })
    try {
      // ★★ `request()` 返回的是 Result 联合类型：成功 `{ok:true, data}` / 失败 `{ok:false, failure}`。
      //    必须判 ok 再取 data —— 直接取 `.tasks` 在类型上就不成立（编译会拦，运行时是 undefined）。
      const r = await listTasks(token, { projectId: project.projectId })
      if (!r.ok) {
        setState('error')
        return
      }
      setTasks(r.data.tasks)
      setState('ready')
    } catch {
      // ★ 不暴露技术细节（设计稿 §六：不出现 500 / fetch failed / 堆栈）
      setState('error')
    }
  }, [token, project.projectId])

  useEffect(() => {
    void load()
  }, [load])

  const doRename = useCallback(async () => {
    const name = newName.trim()
    if (name === '' || renameBusy) return
    if (name === project.name) {
      // 没改：直接收起，不发请求（避免无意义的写 + 无意义的审计轨迹一行）
      setRenaming(false)
      return
    }
    setRenameBusy(true)
    setRenameErr(null)
    const r = await renameProject(token, project.projectId, name)
    setRenameBusy(false)
    if (!r.ok) {
      setRenameErr('message' in r.failure ? r.failure.message : `积分不足，还差 ${r.failure.shortfall} 分`)
      return
    }
    setLocalName(name)
    setRenaming(false)
    // ★ 通知父组件刷新列表（返回项目页时看到的得是新名字）
    onRenamed?.()
  }, [newName, renameBusy, token, project.projectId, project.name, onRenamed])

  // ══════════════════════════════════════════════════════════
  // 预算止损预警 —— 30 秒轮询
  // ══════════════════════════════════════════════════════════
  //
  // ★★ 为什么是轮询不是 SSE（古茶/阿开 2026-11-24 定）：
  //   横幅必须**一直挂在那**。SSE 不重放、漏了就永远漏 ——
  //   那会出现「明明超支了但横幅没出来」。轮询每次都拿到当前真值，不存在漏。
  //
  // ★ 为什么 30 秒：
  //   · 预警是「钱的事」，但不需要秒级（花超 100 分不是灾难，晚 30 秒知道完全来得及）
  //   · 太频会给服务端造无谓压力（每个打开的页面每分钟 2 次请求）
  //   · 30 秒 = 客户看一眼别的页面回来，横幅基本已经是新的
  //
  // ★ 为什么 notActive 时不 setAlert(null) 而是保持：
  //   项目结算后横幅要消失（阿开定），所以 notActive ⇒ 置 null。
  //   这里服务端已经算好 notActive，前端**不自己判项目状态**（两处判必漂移）。
  useEffect(() => {
    let alive = true
    const pull = async () => {
      const r = await getProjectAlert(token, project.projectId)
      if (!alive) return
      if (r === null) return // 网络失败：**保留上一次的值**，不闪没
      // 项目结束结算后自动消失（阿开定）
      setBudgetAlert(r.notActive ? null : r.alert)
    }
    void pull()
    const timer = setInterval(() => void pull(), 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [token, project.projectId, claimTick])

  const done = project.taskDone ?? tasks.filter((t) => t.status === 'accepted').length
  const pendingAccept =
    project.taskPendingAccept ?? tasks.filter((t) => t.status === 'delivered').length
  // ★ 2026-11-24：这里原来还有一行 `const total = project.taskTotal ?? tasks.length`，
  //   只用来拼「其余不归你名下」那句提示。那句已删（后端修好铺主视野后永远不该出现），
  //   total 也就没有消费者了 —— 一并删掉，不留死变量。
  const stage = projectStageOf(project, tasks)

  const cols: Column<Task>[] = [
    {
      key: 'title',
      title: '任务',
      // ★★ 2026-11-24：34% → 'auto'（配合 base.tsx 的 tableLayout:'fixed'）
      //
      //   为什么从百分比改成 auto：fixed 布局下，**列宽之和小于容器时，
      //   多余空间只给「没声明宽度」的列**。这一列是唯一弹性的列 ——
      //   让它吃掉全部剩余，右侧几列才能严格保持我声明的宽度。
      //   ★ 若继续写 34%，剩余 66% 会被浏览器平均摊给右边所有列
      //     ⇒ 右侧又被撑宽，正是阿开报的「要往右收紧」那个毛病。
      width: 'auto',
      render: (t) => {
        // ★ 2026-11-24 加附件计数（阿开：「在每个任务背后增加（XX个附件）
        //   你觉得有没有必要，方便人类识别」）。
        //   ★ 0 个就**不显示**——一列全是「0 个附件」只是噪声，反而看不清哪些任务真有件。
        //     判据：标签只在「有件」时出现，用户扫一眼就知道哪条里有东西。
        const n = t.attachmentCount ?? 0
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: '100%' }}>
            <span
              onClick={() => onOpenTask(t.taskId)}
              style={{
                color: T.accent,
                cursor: 'pointer',
                // ★★ 2026-11-24 加（配合 base.tsx 的 tableLayout:'fixed'）：
                //   fixed 布局下这一列**不会因为内容长而变宽** ——
                //   不处理就会溢出到相邻单元格、压住「复制」按钮。
                //   ⇒ 两行截断：「任务标题多是『【UI设计】项目台三页重设计 V2.0』这类，
                //     一行装不下很常见，直接省略号会截掉关键信息；给两行既有信息又不撑高行」。
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                lineHeight: '18px',
              }}
              title={t.detail ?? t.title}
            >
              {t.title}
            </span>
            {n > 0 && (
              <span
                title={`这条任务下有 ${n} 个附件（点任务进去看）`}
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  lineHeight: '16px',
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: '#f2f3f5',
                  border: '1px solid #e5e6eb',
                  color: T.dim,
                  whiteSpace: 'nowrap',
                }}
              >
                {/* ★ 2026-11-24 实测改：原来写 emoji `📎`，在 Chrome/Linux 无头环境
                    渲染成一个**空心小方框**（缺 emoji 字体的机器都这样）。
                    附件计数是给人扫一眼认出来的，不能依赖系统字体里有没有这个字符。
                    ⇒ 改成纯中文「附件 N」，零字体依赖，任何机器都一样。 */}
                附件 {n}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'copy',
      title: '',
      // ★ 52 → 172：阿开把按钮文字从「复制」改成「复制任务给你的Agent同事」（11 字）。
      //
      //   ★★ 第一版给 148 是错的，实测抓到：按钮实际宽 148px = 整列宽，
      //     而按钮自带 `padding: 2px 7px` ⇒ **溢出到右邻格 12px**（右边余 = −12），
      //     把「复制→状态」的间隔压成 0，两格贴死。
      //   ⇒ 172 = 按钮 148 + 左右 padding 各 12。
      //     ★ 教训：算列宽不能只算「文字够不够」，还要算**控件自身的 padding 和边框**
      //       —— 少算这部分，按钮会溢出、间隔归零，比字被截断更难发现（不报错，只是贴边）。
      width: 172,
      render: (t) => (
        <CopyTaskButton
          task={t}
          projectName={project.name}
          onCopied={() => setCopiedTaskId(t.taskId)}
          justCopied={copiedTaskId === t.taskId}
        />
      ),
    },
    {
      key: 'status',
      title: '状态',
      // ★★ 2026-11-24 三调：阿开「状态列与 Agent 列之间的间隔，保持与右边
      //   Agent 和更新时间的间隔一致就好看了，为什么这个间隔要窄一些呢？」
      //
      //   实测净间隔（内容右边界 → 下一格内容左边界）：
      //     复制→状态 14px ｜ 状态→Agent 27px ｜ Agent→更新时间 110px ｜ 更新时间→下一步 79px
      //
      //   ★ 他说得对 —— 状态→Agent 只有 27px，确实比右边窄。
      //     但根子不在状态列，在 **Agent 列**：「小砚」两个字只占 26px，
      //     列宽却给了 136px ⇒ 右边空 100px，把 Agent→更新时间 撑成 110px 的假宽。
      //
      //   ⇒ 收 Agent 列（136 → 96），多出的 40px 补给状态列。
      //     状态列 92 → 132：胶囊右边界离格右边更远，状态→Agent 的净间隔随之拉大。
      //
      //   ★ 96px 怎么定的：查了全库活跃 Agent 名，最长是 `Codex-guoma`（11 字符 ≈ 60px）。
      //     60 + 24(padding) + 12(余量) = 96 ⇒ 最长名字仍完整显示，不靠省略号。
      //     （不是拍脑袋收窄 —— 收之前先查了真实数据里最长的那个。）
      width: 132,
      render: (t) => {
        const c = STATUS_CHIP[t.status]
        return <StatusChip tone={c.tone} label={c.label} />
      },
    },
    {
      key: 'assignee',
      title: 'Agent',
      // ★ 136 → 96：Agent 名实测最长是 `Codex-guoma`（11 字符 ≈ 60px）。
      //   60 + 24(padding) + 12(余量) = 96 ⇒ 最长名字仍完整显示。
      //   136 那 110px 的空余把「Agent↔更新时间」撑到 110px，是这一行最刺眼的失衡。
      width: 96,
      render: (t) => (
        <span style={{ color: t.assignee === null ? T.faint : T.text }}>
          {assigneeLabel(t)}
        </span>
      ),
    },
    {
      key: 'updated',
      title: '更新时间',
      // ★★ 宽度 128 → 116 → 152：
      //   116 时虽然改成短格式（`11-24 07:48`，11 字符）勉强一行，
      //   但余量太小 —— 万一格式再变长或字体不同就折行。
      //   ⇒ 152px 给足余量，短格式稳稳一行，行高不再从 54 撑到 72。
      width: 152,
      render: (t) => (
        <span style={{ color: T.dim, fontSize: 12, whiteSpace: 'nowrap' }}>
          {fmtShortTime(t.updatedAt)}
        </span>
      ),
    },
    {
      key: 'next',
      title: '下一步',
      // ★ 84 → 104：「待你验收」「等 Agent 交付」这类 84px 会折行
      width: 104,
      render: (t) => <span style={{ color: T.dim, fontSize: 12 }}>{nextStepOf(t)}</span>,
    },
  ]

  return (
    <>
      {/* ── 预算止损横幅（阿开 2026-11-24 定：顶栏下方、长期展示、不可关闭）──
          ★ 放在页头**之前**：页头是「你现在该干嘛」，但「钱快没了」优先级更高 ——
            它必须第一眼被看见，不能被标题压下去。
          ★ alert 为 null 时组件自己返回 null（不占位）。 */}
      <BudgetAlertBanner alert={budgetAlert} />

      {/* ── 每日签到条（2026-11-24）──
          ★ 放在横幅**下面**：客户看到「余额不足」时最想做的就是签到，
            提示和入口必须挨着，否则他要自己找 → 找不着就问客服。
          ★ 签到成功后刷新预算横幅 —— 领了分可能刚好压回预警线下。 */}
      <DailyClaimBar token={token} onClaimed={() => setClaimTick((n) => n + 1)} />

      {/* ── 页头：一句「你现在该干嘛」（全页只此一句）── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        {renaming ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProjectNameForm
              value={newName}
              onChange={setNewName}
              onSubmit={() => void doRename()}
              onCancel={() => {
                setRenaming(false)
                setRenameErr(null)
                setNewName('')
              }}
              busy={renameBusy}
              error={renameErr}
              submitLabel="保存"
              placeholder={project.name}
            />
          </div>
        ) : (
          <h1
            style={{ fontSize: 17, fontWeight: 600, margin: 0, cursor: 'pointer' }}
            title="点击改名"
            onClick={() => {
              setRenaming(true)
              setNewName(shownName)
              setRenameErr(null)
            }}
          >
            {shownName}
            {/* ★ 加一个极淡的铅笔，让「可以点」这件事自己说出来 ——
                阿开实测「项目名称是否支持改名称？」说明它自己没说出来。 */}
            <span style={{ fontSize: 12, color: T.faint, marginLeft: 6, fontWeight: 400 }}>✎</span>
          </h1>
        )}
        {pendingAccept > 0 && (
          <span style={{ fontSize: 13, color: '#b45309' }}>
            下一步：你验收（{pendingAccept} 个任务待看）
          </span>
        )}
        {/*
          ★★ 一键核验占位按钮 —— 已按阿开 2026-11-24 令拆除
          
          ★ 历史：2026-11-23 曾在此放一个 disabled 灰按钮，文案「一键核验（新功能开发中）」，
            当初的理由是「① 不会忘 ② 不暴露规划」。
          
          ★ 阿开 2026-11-24 令：**拆掉**。
            理由（产品铁律）：「提前亮的按钮不是搭架子，是失约」。
            「新功能开发中」这种字样出现在客户能看到的页面上，就是在对客户做
            一个我们还没兑现的承诺。客户不知道「开发中」是三个月还是一年。
          
          ★ 那两个目标（不忘 / 不暴露）改用别的方式保住：
            · **不忘** → 挂在需求件与任务书里（`01-需求/005-山海审计接入-四能力设计`），
              不挂在客户界面上。要提醒我自己，用文档与哨兵，不用客户的脸。
            · **不暴露规划** → 不画这个按钮本身就是最彻底的「不暴露」。
          
          ★ 后端接口 `POST /pm/projects/:id/archive-audit` 仍未实现。
            **等它真做出来、真能点、真有用，再把按钮加回来。**
            在此之前，这块整块不渲染（不是留空框 —— 留空框会让人以为加载失败）。
          
          ★ 相关新需求：任务详情页的「申请人工复核」按钮，
            已随 V2.0 设计任务派出，**同样遵守此律：接口不通之前不点亮**。
        */}
      </div>

      {/* ── 大状态条 ── */}
      {/*
        ── 进度 + 三读数 **合并成一行**（2026-11-24 阿开实测要求）──

        ★ 阿开原话：「待认领/进行中/待验收/终态 + 任务总数 1 / 已完成 0 / 待你验收 0
           有没有进度条和下方的3个看板框合并成一行？因为我感觉底部的任务空间太少了，
           要拉下去才能看到下面的任务」

        ★ 原来这里占了 **两整块**：一个 18px 内边距的状态条卡 + 一行三个 StatCard。
          加起来约 160px 高，而一屏就那么大 —— 任务表被挤到折叠线以下，
          每次看任务都要滚。**统计是给一眼看的，不该占两行。**

        ★ 改法：左边状态条（弹性），右边三个「标签 + 数字」紧凑块。
          数字仍然大到能一眼扫到，但不再各占一个大卡。
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          padding: '12px 16px',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        {/* 左：四段进度条 */}
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <StatusBar status={stage} size="lg" />
        </div>

        {/* 右：三个读数，紧凑横排 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <MiniStat label="任务总数" value={tasks.length} />
          <MiniStat label="已完成" value={done} tone="pass" />
          <MiniStat
            label="待你验收"
            value={pendingAccept}
            tone={pendingAccept > 0 ? 'warn' : 'muted'}
          />
        </div>
      </div>

      {/* ── 需求附件（2026-11-24 阿开令）──
          ★ 放在派活**之前**：需求书是派活的前提 —— Agent 接了活要读需求原文。
            排在派活后面，人会先派人再想起没传需求，那个 Agent 拿到的活是空的。
          ★ 后端点 2026-11-23 就建好了，前端这轮才补上入口。 */}
      <BaselineFilesCard token={token} projectId={project.projectId} />

      {/* ── 派活：人工录入任务（2026-11-23 阿开令「先做2」，Codex 等着领活）──
          ★ 放在 Agent 面板之前：先有活，再谈谁干。
          ★ 等 PM 自动拆解接上后，这一块**不删** —— 人工派活永远是兜底通道
            （PM 拆不出来、或者临时有个急活，人都要能直接派）。 */}
      <DispatchTaskPanel
        token={token}
        projectId={project.projectId}
        onDispatched={() => void load()}
        // ★ 从「我的 Agent」跳过来时预选那个人，并直接展开面板
        initialAgentId={preselectAgentId}
        autoOpen={preselectAgentId !== undefined}
      />

      {/* ── 项目里的 Agent（2026-11-23 · 古茶定案 011）── */}
      <ProjectAgentsPanel
        token={token}
        projectId={project.projectId}
        libraryAgents={library}
        onGoToLibrary={onGoToLibrary}
        projectName={project.name}
      />

      {/* ── 任务表 ── */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>任务</div>
      {state === 'loading' && (
        <div style={{ padding: 32, textAlign: 'center', color: T.faint, fontSize: 13 }}>加载中…</div>
      )}
      {state === 'error' && (
        <EmptyState
          title="任务列表没加载出来"
          hint="重试一下"
          action={{ label: '重试', onClick: () => void load() }}
        />
      )}
      {state === 'ready' && (
        <>
          {/* ★★ 删掉了「项目共 N 个任务，当前通行证可见 M 个（其余不归你名下）」这条提示
              （2026-11-24 阿开实测后修）。

              ★ 它当初成立的前提是错的：后端把 Agent 之间的隔离规则
                （Agent 可见性过滤 `filterTasksForAgent`）套到了铺主身上 ⇒ 铺主看不到自己项目的任务
                ⇒ 才需要一句「其余不归你名下」来圆场。
                阿开看到的原话：「项目共 1 个任务，当前通行证可见 0 个」。

              ★ 现在后端已按正确语义改：铺主看全租户（后端注释与
                `scope-filter.ts` 文件头本来就这么写，只是代码接反了）。
              ⇒ 这条提示语**永远不该出现**，留着反而会让客户怀疑「是不是还有看不见的」。
              留着一段永远不会显示的解释，比没有更糟 —— 下一个人会以为它还有用。 */}
          <DataTable
            cols={cols}
            rows={tasks}
            rowKey={(t) => t.taskId}
            empty={
              <EmptyState
                title="这个项目还没有任务"
                hint="任务由 PM 拆解后生成，或在上面「派一个任务」里手动派"
              />
            }
          />
          {/* ★ 2026-11-24 加：滚到底时表格底边贴着视口下沿（实测 bottom=576，
              视口 577），看着像被切掉。给一段留白，让表格有收尾。

              ★ 为什么用 paddingBottom 而不是 marginBottom：
                表格是最后一个元素时，margin 在滚动容器里常被「塌陷」吃掉；
                padding 属于盒子内部，一定会撑出高度。 */}
          <div style={{ height: 24 }} aria-hidden="true" />
        </>
      )}

      {/* ── 交付物：★ 只列文件名 + 大小（后端 artifacts 无校验状态/行数）── */}
      {/* 本页暂不渲染交付物卡片 —— 数据只有 path 和 sha256，
          显示一个「只有文件名的交付物」会让人以为校验已经通过了。等后端补校验状态列再加。 */}
    </>
  )
}
