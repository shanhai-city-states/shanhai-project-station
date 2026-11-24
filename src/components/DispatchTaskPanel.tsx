/**
 * DispatchTaskPanel —— 人工录入任务（派活）面板
 * ============================================================================
 * 2026-11-23 阿开令：「先做 2（人工录入任务），Codex 等着领活呢」
 *
 * ★ 为什么先做人工录入，而不是等 PM 自动拆解：
 *   Codex 领不到活，根因不是「没有智能」，是 `pm_tasks` 空表 —— 链路缺的是入口，
 *   不是大脑。先让任务流起来，PM 拆解接上才有意义（阿开认同，原话「我也认同先做2」）。
 *
 * ★ 本组件只做一件事：把「人想派什么活」变成 POST /tasks 的一次调用。
 *   不拆解、不建议、不猜预估分值 —— 那些是 PM 的活，不是这个面板的活。
 *
 * ★ 硬约束（后端已强制，这里只是提前告诉用户，不重复实现）：
 *   ① 派活 = 冻结预算。钱不够后端返 402，本组件把差额说清楚，不说"失败"
 *   ② projectId 必须属于本租户（后端查，这里不查）
 *   ③ 任务 id 服务端生成（客户端不许指定）
 */
import { useEffect, useRef, useState } from 'react'
import {
  dispatchTaskReq,
  listProjectAgents,
  uploadTaskAttachmentReq,
  type ProjectAgent,
} from '../lib/api'
import { T } from '../styles/tokens'

/**
 * 派活固定冻结 100 积分（阿开 2026-11-24 定）。
 *
 * ★★ 这里**只用于展示**，用户改不了，服务端也不采用这个值 ——
 *   真值在服务端 `DISPATCH_FROZEN_CREDITS`（router.ts）。
 *   为什么前端还要写一份：客户得**看见**「会冻结 100」才敢点派出。
 *   这是「告知」不是「校验」—— 校验在服务端，前端这份不作数。
 *
 * ★ 为什么不删掉输入框直接写死文字：
 *   保留输入框形态（但 disabled）能让客户清楚「这里本来可以调、现在不可调」，
 *   比突然变成一行静态文字更容易理解 —— 而且将来改成可调时不用改布局。
 */
const FROZEN_CREDITS = 100

export function DispatchTaskPanel({
  token,
  projectId,
  onDispatched,
  initialAgentId,
  autoOpen = false,
}: {
  token: string | null
  projectId: string
  /** 派活成功后回调 —— 让父组件刷新任务表 */
  onDispatched: () => void
  /**
   * 预选的人（2026-11-24 阿开定：从「我的 Agent」点「派活」带过来的）。
   *
   * ★ 为什么要预选：阿开原话「点哪条，进去就选中它」。
   *   从 Agent 页过来时他已经想好派给谁了，再让他从下拉里找一遍是多此一举。
   * ★ 传了但这个人不在本项目里怎么办：下面的 effect 会校验，
   *   不在就**不预选**（回到「不指定」），因为没进项目的人领不到这个项目的活。
   */
  initialAgentId?: string | undefined
  /** 是否一进来就展开面板（从 Agent 页跳过来时展开，省一次点击） */
  autoOpen?: boolean
}) {
  const [open, setOpen] = useState(autoOpen)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [assignee, setAssignee] = useState<string>('')
  const [credits] = useState(String(FROZEN_CREDITS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /**
   * 这次任务要带的附件（2026-11-24 阿开定 · 两段式第 2 段）。
   *
   * ★ 为什么存在前端 state 里、等派出后才传：
   *   文件必须先有 taskId 才能挂到任务下，而 taskId 是服务端建的。
   *   ⇒ 只能「先建任务 → 再传文件」。
   * ★ 为什么不做草稿态（先传到一个临时任务）：
   *   那会多出一整套脏数据生命周期（临时任务谁清、超时怎么办、
   *   用户放弃了呢）。两段式 + 显式补传入口更简单，也更诚实。
   */
  const [files, setFiles] = useState<File[]>([])
  /**
   * 附件上传结果报告（只在**有失败**时才需要用户看见）。
   *
   * ★ 为什么这个 state 必须存在：任务派出去了是不可撤销的事实。
   *   附件传失败如果只是 console.error，用户会以为全好了 ——
   *   这就是「假成功」，比报错严重得多。
   */
  const [uploadReport, setUploadReport] = useState<{
    taskId: string
    total: number
    failed: { name: string; reason: string }[]
    actual: number
    expected: number | null
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // ★ 本项目里可派的 Agent —— 本组件自己取，不靠父组件传。
  //   理由：父组件传的话，「谁在什么时机刷新它」就变成两处各管一半，必漂移。
  const [agents, setAgents] = useState<readonly ProjectAgent[]>([])

  // ★ 预选：等 agents 取回来再设，否则设了会被后面的 setAgents 覆盖视角
  //   （assignee 是独立 state，不会被覆盖；但要确认这个人真在本项目里）
  useEffect(() => {
    if (initialAgentId === undefined || initialAgentId === '') return
    if (agents.length === 0) return
    const hit = agents.some((a) => a.agentId === initialAgentId)
    // 不在本项目里就不预选 —— 选了也派不出去，反而让他以为选好了
    if (hit) setAssignee(initialAgentId)
  }, [initialAgentId, agents])

  // 只在展开时才去取 —— 收起态不必要地打接口是浪费。
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      const r = await listProjectAgents(token, projectId)
      if (alive && r.ok) setAgents(r.data.agents)
    })()
    return () => {
      alive = false
    }
  }, [open, token, projectId])

  // ★ 冻结额固定 100，不再校验「是否合法」—— 它不可能是非法值。
  //   保留 creditsNum 只是为了提交时带一个数字（服务端本来也不采用，见 router.ts 注释）。
  const creditsNum = Number(credits)
  // 能否提交只看「标题填了没有」+「没在提交中」
  const canSubmit = title.trim() !== '' && !busy

  function reset() {
    setTitle('')
    setDetail('')
    setAssignee('')
    setFiles([])
    setError(null)
    setUploadReport(null)
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setDone(null)
    setUploadReport(null)

    const res = await dispatchTaskReq(token, {
      title: title.trim(),
      projectId,
      estimatedCredits: creditsNum,
      ...(assignee !== '' ? { assignee } : {}),
      ...(detail.trim() !== '' ? { detail: detail.trim() } : {}),
      // ★ 只在真选了文件时才传这个数。
      //   不选 = 不传 ⇒ 后端存 NULL ⇒ 这条任务不校验完整性。
      //   ★ 为什么不能一律传 files.length（哪怕等于 0）：
      //     0 是「明确要求 0 份」，将来若加「必须附件才能派」的规则会被它绕过。
      //     两种语义必须分开：没要求 ≠ 要求零份。
      ...(files.length > 0 ? { attachmentsExpected: files.length } : {}),
    })

    if (!res.ok) {
      setBusy(false)
      // ★ 402 与其余分开：402 = 真没钱（说清该做什么），其余是系统问题（说重试）
      if (res.failure.kind === 'insufficient-credits') {
        const short = res.failure.shortfall
        // ★★ 阿开 2026-11-24 原话：「账户低于 100 积分不能派任务 ——
        //   提醒明天签到领 100 积分或者找管理员充值积分。」
        // ⇒ 提示必须给出**客户能做的那个动作**，不是只报差额。
        //   「还差 50 分」听起来像补一点就行；「去签到 / 找管理员」才是真正的下一步。
        setError(
          `积分不够：还差 ${short.toFixed(2)} 分，任务没有派出，一分钱没扣。\n` +
            `明天签到可领 100 积分，或联系管理员充值后再派。`,
        )
        return
      }
      switch (res.failure.kind) {
        case 'forbidden':
          setError('当前登录的是项目通行证，它不能派活。派活要用铺主凭据（kp_own_ 开头那枚）。')
          break
        case 'auth':
          setError('凭据已失效，请重新登录。')
          break
        case 'conflict':
        case 'server-error':
          setError(res.failure.message)
          break
        default:
          setError('网络不通，任务没有派出（重试即可，不会重复扣费）。')
      }
      return
    }

    // ══════════════════════════════════════════════════════════════
    // 第 1 段成功 ⇒ 任务已派出、预算已冻。现在做第 2 段：传附件。
    // ══════════════════════════════════════════════════════════════
    //
    // ★★★ 这一段**不能因为失败就假装没发生**（本仓铁律：允许漏不许骗）。
    //   任务是真的派出去了。如果这里静默失败，用户会以为附件也传好了 ——
    //   而 Agent 那边看到的是一条「要 3 份附件、实际 0 份」的活。
    //
    // ⇒ 所以：
    //   ① 逐个传，记录每份的成败
    //   ② 有任何一份失败，**不关面板**，把失败项逐条报出来（文件名 + 原因）
    //   ③ 报告里给出「去哪补传」那个确切位置
    const taskId = res.data.taskId
    setDone(taskId)

    if (files.length > 0 && token !== null) {
      const failed: { name: string; reason: string }[] = []
      let lastActual = 0
      let lastExpected: number | null = files.length
      for (const f of files) {
        const up = await uploadTaskAttachmentReq(token, taskId, f)
        if (up.ok) {
          lastActual = up.data.attachmentsActual
          lastExpected = up.data.attachmentsExpected
        } else {
          // ★ 逐 kind 取文案，不用 `up.failure.message` ——
          //   `insufficient-credits` 这个分支**没有 message 字段**（只有 shortfall），
          //   直接取会编译不过。上传接口正常不会返回它，但类型上必须穷尽。
          const f2 = up.failure
          // ★ 用 switch 而不是嵌套三元 —— 这段已经因为缩进错乱改坏过两次。
          //   switch 的每个 case 一眼能看出穷尽了哪些 kind。
          let reason: string
          switch (f2.kind) {
            case 'network':
              reason = '网络不通'
              break
            case 'auth':
              reason = '凭据失效，请重新登录'
              break
            case 'forbidden':
              reason = '没有权限往这条任务传附件'
              break
            case 'insufficient-credits':
              reason = '积分不足'
              break
            default:
              reason = f2.message
          }
          failed.push({ name: f.name, reason })
        }
      }
      setUploadReport({ taskId, total: files.length, failed, actual: lastActual, expected: lastExpected })

      if (failed.length > 0) {
        // ★ 有失败 ⇒ 停在这里，让用户看见。任务已派出这个事实也要说清。
        setBusy(false)
        return
      }
    }

    setBusy(false)
    reset()
    setOpen(false)
    onDispatched()
  }

  // ── 收起态：一个按钮 ──
  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setDone(null)
          }}
          style={{
            padding: '6px 14px',
            fontSize: 12.5,
            color: '#fff',
            background: T.accent,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          + 派一个任务
        </button>
        {done !== null && (
          <span style={{ fontSize: 12, color: '#15803d' }}>
            已派出（{done}）—— Agent 下次来领活就能看到
          </span>
        )}
      </div>
    )
  }

  // ── 展开态：表单 ──
  return (
    <div
      style={{
        padding: 16,
        marginBottom: 14,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>派一个任务</div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            reset()
          }}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            color: T.dim,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
      </div>

      {/* 任务标题 */}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>任务标题</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：把上季度对账单导出成 Excel"
          maxLength={200}
          autoFocus
          style={inputStyle}
        />
      </label>

      {/* 详细说明 */}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>
          详细说明 <span style={{ color: T.faint }}>（可不填；Agent 看不到你写的这一步之外的上下文）</span>
        </div>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="要做成什么样、验收看哪几点、有没有参考资料…"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>

      {/* ── 这次任务的附件（2026-11-24 阿开定 · 两段式第 2 段）──
          ★ 位置：就在「详细说明」下面 —— 阿开原话「看起来会习惯一些」。
            人写要求、顺手把要求相关的文件放上去，是同一个心理动作。
          ★ 为什么这里不是「项目级附件」：项目级是资料库（整个项目通用），
            这里是**这次任务要用的**。两者并存，语义不同。 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>
          这次任务的附件{' '}
          <span style={{ color: T.faint }}>（可不传；Agent 干活时能读到）</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => {
            // ★ 追加而不是替换：用户可能分两批选。
            //   同名同大小同修改时间的视为同一份，避免重复添加。
            const picked = Array.from(e.target.files ?? [])
            setFiles((prev) => {
              const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`))
              const add = picked.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`))
              return [...prev, ...add]
            })
            // ★ 清空 input 的 value：否则同一个文件选第二次不会触发 change，
            //   用户会以为「点了没反应」。
            e.target.value = ''
          }}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              background: T.surfaceSoft,
              border: `1px solid ${T.border}`,
              borderRadius: 5,
              color: T.text,
              cursor: 'pointer',
            }}
          >
            + 选择文件
          </button>
          <span style={{ fontSize: 11.5, color: T.faint }}>
            {files.length === 0
              ? '还没选文件'
              : `已选 ${files.length} 份`}
          </span>
        </div>

        {files.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  padding: '3px 0',
                  color: T.dim,
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ color: T.faint, flexShrink: 0 }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    padding: '1px 6px',
                    fontSize: 11,
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    borderRadius: 4,
                    color: T.dim,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ★ 说清「派出后会发生什么」 —— 两段式对用户不是透明的，
            不说他不知道为什么刚点完派出还要等一会儿。 */}
        {files.length > 0 && (
          <div style={{ fontSize: 11, color: T.faint, marginTop: 5, lineHeight: 1.6 }}>
            派出时先建任务、再逐份上传。附件没传完的任务会标出来，可以在任务详情里补传。
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {/* 派给谁 */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px' }}>
          <span style={{ fontSize: 11.5, color: T.dim }}>
            派给谁 <span style={{ color: T.faint }}>（不选 = 放公共池，谁先来谁领）</span>
          </span>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            style={inputStyle}
          >
            <option value="">不指定（公共池）</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.displayName}
                {a.seat !== null && a.seat !== '' ? `（${a.seat}）` : ''}
              </option>
            ))}
          </select>
        </label>

        {/* 冻结额 —— 固定 100，客户改不了（阿开 2026-11-24 定） */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '0 0 170px' }}>
          <span style={{ fontSize: 11.5, color: T.dim }}>
            冻结积分 <span style={{ color: T.faint }}>（固定，先冻结）</span>
          </span>
          {/*
            ★ 用 disabled 的 input 而不是纯文字：
              让客户看得出「这里是个数值、但不可改」。
              纯文字会让人以为「没有这个选项」，disabled 表示「有这个，暂不可调」。

            ★ 为什么没有 onChange：值恒为 100，改了也要被服务端覆盖，
              留 onChange 就是留一个「看起来能改、改了没用」的假交互。
          */}
          <input
            value={`${credits} 分`}
            disabled
            readOnly
            title="固定冻结 100 分，任务验收后按实际消耗多退少补"
            style={{
              ...inputStyle,
              background: T.surfaceSoft,
              color: T.dim,
              cursor: 'not-allowed',
            }}
          />
        </label>
      </div>

      {/* 旧的「预估消耗非法」提示已删：值固定 100，不可能非法 */}

      <div
        style={{
          fontSize: 11.5,
          color: T.faint,
          lineHeight: 1.7,
          marginBottom: 10,
          padding: '7px 10px',
          background: T.bg,
          borderRadius: 5,
        }}
      >
        派出时会先冻结这笔积分；任务验收后按实际消耗结算，没用到的退回。
      </div>

      {/* ── 附件上传失败报告（2026-11-24）──
          ★★★ 只有一种情况会走到这里：**任务已经派出去了，但附件没传全**。
            这是最需要说清楚的状态 —— 因为「任务成功」和「附件成功」是两件事。
            只报「派出成功」，用户会以为附件也在；只报「失败」，用户
            会以为任务没派（还可能重复派一遍，白冻两次钱）。
          ⇒ 所以必须把两件事**分开说**。 */}
      {uploadReport !== null && uploadReport.failed.length > 0 && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.7,
            marginBottom: 10,
            padding: '10px 12px',
            background: '#fffbeb',
            border: '1px solid #f0d090',
            borderRadius: 6,
            color: '#92400e',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            任务已派出（{uploadReport.taskId}），但有 {uploadReport.failed.length} 份附件没传上
          </div>
          <div style={{ fontSize: 11.5, marginBottom: 6 }}>
            当前 {uploadReport.actual} / {uploadReport.expected ?? uploadReport.total} 份。
            附件不齐的任务不能验收，请到任务详情里补传。
          </div>
          {uploadReport.failed.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ fontSize: 11.5, color: '#78350f' }}>
              · {f.name} —— {f.reason}
            </div>
          ))}
        </div>
      )}

      {error !== null && (
        <div
          style={{
            fontSize: 12,
            color: '#b91c1c',
            lineHeight: 1.7,
            marginBottom: 10,
            padding: '8px 10px',
            background: '#fdf0f0',
            border: '1px solid #f0c0c0',
            borderRadius: 5,
            // ★ 必须加：积分不足的提示是**两行**（差额 + 该做什么）。
            //   不加这条，HTML 会把 \n 压成空格，两句挤成一句，读起来像啰嗦的长句。
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        style={{
          padding: '8px 20px',
          fontSize: 13,
          color: canSubmit ? '#fff' : T.faint,
          background: canSubmit ? T.accent : T.surfaceSoft,
          border: 'none',
          borderRadius: 6,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? '派出中…' : '派出去'}
      </button>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '7px 10px',
  fontSize: 13,
  background: T.bg,
  color: T.text,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  outline: 'none',
}
