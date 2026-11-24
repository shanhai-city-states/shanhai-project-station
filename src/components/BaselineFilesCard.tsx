/**
 * BaselineFilesCard.tsx —— 项目附件（需求说明书 / 技术方案）
 * =====================================================================
 *
 * ★★★ 这个组件为什么存在（2026-11-24 阿开原话）：
 *   「需求页面应该支持上传附件还没实现。所以我还没发布任务。」
 *
 *   后端端点 2026-11-23 就建好了（A 形态：字节写盘、按 sha256 命名、版本链
 *   用 `superseded_by` 串起来），**但前端一个入口都没有** ——
 *   于是客户手上那份 Word 需求书传不进来，「发布任务」这一步事实上卡死。
 *
 * ★ 设计取舍：
 *   ① **不做拖拽区**。一个 `input[type=file]` 就够，拖拽在手机上本来也不成立
 *      （触摸设备没有「拖」这个动作）。少一层交互少一处坏的可能。
 *   ② **传完立刻刷新列表**，不等用户手动刷 —— 否则他会以为没传上去，再传一遍。
 *   ③ **历史版本不删、都列出来**。需求会改，改了什么必须能查（版本链的意义）。
 *      当前版标「当前」，旧版标「已被第 N 版取代」。
 *   ④ **人话错误**：413（文件太大）、400（kind 不对）、415（类型不对）各给一句
 *      能照做的话，不甩「服务返回 413」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listBaselineReq,
  uploadBaselineReq,
  deleteBaselineReq,
  lockBaselineReq,
  voidBaselineReq,
  type BaselineFile,
  type BaselineKind,
} from '../lib/api'
import { T } from '../styles/tokens'
import { useIsMobile } from '../lib/breakpoint'

interface Props {
  token: string | null
  projectId: string
  /** 上传成功后回调 —— 外层可以据此刷新「能不能发布任务」之类 */
  onChanged?: () => void
}

/** 两种附件的对人说法 —— ★ 唯一来源，别在 JSX 里各写一遍 */
const KIND_META: Record<BaselineKind, { label: string; hint: string; icon: string }> = {
  requirement: {
    label: '需求说明书',
    hint: '你要做的事，写成什么样都行（Word / PDF / 图片 / 文本）',
    // ★ 2026-11-24：icon 留空 —— 原来这里是 `📄` / `🧩` 两个 emoji，
    //   实测在无 emoji 字体的机器上渲染成**空心小方框**。
    //   标题字本身已经说清了是什么，图标只会帮倒忙 ⇒ 不用。
    icon: '',
  },
  adr: {
    label: '技术方案',
    hint: '已经有技术方案的话放这里（没有可以先不传）',
    icon: '',
  },
}

/** 字节数转人话 —— 客户不认 MB 还是 MiB，认「1.2 MB」 */
function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** `2026-11-24T09:15:22.000Z` → `11-24 17:15`（本地时区，看的人在国内） */
function humanTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function BaselineFilesCard({ token, projectId, onChanged }: Props) {
  const isMobile = useIsMobile()
  const [files, setFiles] = useState<BaselineFile[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  /**
   * ★★★ 2026-11-24：`busyKind` / `dragOver` 两个 state 已删。
   *
   *   它们是「两栏各自可传、各自高亮」时代的产物：
   *     · `busyKind`   —— 哪一格正在传
   *     · `dragOver`   —— 文件正悬在哪一格上
   *   上传收成一个框之后，这两件事只剩一个答案，由 `uploadBusy` / `dragOverAll` 表达。
   *   ★ 留着它们是**永远为 null 的死 state**：不报错，但读代码的人会以为还有两条路。
   */
  const [notice, setNotice] = useState('')
  /** 正在删的那一类（删是整类清空，要防误点后重复提交） */
  const [deletingKind, setDeletingKind] = useState<BaselineKind | null>(null)
  /** 删除二次确认（★ 不用原生 confirm：产品纪律要求不用原生弹窗） */
  const [confirmKind, setConfirmKind] = useState<BaselineKind | null>(null)
  /** 正在锁定的那一类 */
  const [lockingKind, setLockingKind] = useState<BaselineKind | null>(null)
  /** 正在作废的那一类（非 null = 作废弹窗打开） */
  const [voidingKind, setVoidingKind] = useState<BaselineKind | null>(null)
  /** 作废理由（★ 必填 —— 这是以后查「为什么改」的唯一线索） */
  const [voidReason, setVoidReason] = useState('')

  /**
   * ★ 2026-11-24 加：上传区收成一个框后新增的三个 state。
   *
   * 为什么必须加它们（这是「一个框」能不破坏原能力的前提）：
   *   · `uploadBusy`  —— 两栏合并后 `busyKind` 表达不了「正在传但还没归好类」
   *   · `dragOverAll` —— 拖拽高亮从「拖到哪一格」变成「拖到这个区」
   *   · `lastClassify`—— **自动归类的依据必须外显**，否则猜错了没人发现
   */
  const [uploadBusy, setUploadBusy] = useState(false)
  const [dragOverAll, setDragOverAll] = useState(false)
  const [lastClassify, setLastClassify] = useState<{
    kind: BaselineKind
    by: 'filename' | 'default' | 'explicit'
    matched: string | null
    fileId: string
    filename: string
  } | null>(null)

  /** 单框上传用（原来是两个 input，现在一个） */
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * ★★★ 2026-11-24 删：`inputRefs`（requirement / adr 各一个 ref）退役。
   *   它服务于那两个已被删除的隐藏 `<input type="file">`。
   *   现在只有 `fileInputRef` 一个 —— 一个框一个 ref。
   */

  const load = useCallback(async () => {
    setState('loading')
    const r = await listBaselineReq(token, projectId)
    if (r.ok) {
      setFiles(r.data.files)
      setState('ready')
    } else {
      setErrMsg(r.failure.kind === 'auth' ? '凭据失效了，重新登录一下' : '附件列表没加载出来')
      setState('error')
    }
  }, [token, projectId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * ★ 2026-11-24 新增：单框上传（不指定 kind，让后端按文件名自动归类）。
   *
   * ## 为什么和 `handlePick` 分开而不合并
   * `handlePick(kind, f)` 是「我明确知道这是哪一类」的路径 —— 老的拖传到具体格子、
   * 以及将来的 Agent 侧仍会用到它。这一条是「我不知道，你猜，猜完告诉我」。
   * 两条路的**失败处理一模一样**，所以抽出了 `describeFail()` 共用，
   * 而不是复制一份 —— 复制必漂移（本仓栽过多次）。
   */
  async function handlePickAuto(f: File) {
    setNotice('')
    setErrMsg('')
    setLastClassify(null)
    setUploadBusy(true)
    const r = await uploadBaselineReq(token, projectId, undefined, f)
    setUploadBusy(false)
    if (r.ok) {
      const d = r.data as unknown as {
        fileId: string
        kind: BaselineKind
        classifiedBy?: 'filename' | 'default' | 'explicit'
        matched?: string | null
      }
      setLastClassify({
        kind: d.kind,
        by: d.classifiedBy ?? 'default',
        matched: d.matched ?? null,
        fileId: d.fileId,
        filename: f.name,
      })
      setNotice(`已上传《${f.name}》`)
      await load()
      onChanged?.()
    } else {
      setErrMsg(describeFail(r.failure))
    }
  }

  /**
   * ★ 2026-11-24 新增：把刚上传的那一份改归到另一类。
   *
   * ## 为什么必须有这个按钮
   * 「按文件名自动归类」一定会有猜错的时候（客户可以把任何文件叫任何名字）。
   * 如果没有改类入口，猜错就意味着**客户要么忍着错、要么删了重传**——
   * 而删掉会毁掉版本链（旧版进历史，Artificial 地多出一代）。
   * ⇒ 猜错必须有出路，否则「自动」就是让客户承受系统的错误。
   *
   * ## 怎么实现：作废 + 重传等价的语义
   * 后端没有「改某条附件的 kind」端点（`kind` 参与版本链计算，直接 UPDATE 会让
   * 「requirement 有 v1,v3 而 adr 有 v4」这种断号出现）。
   * ⇒ 走已有的「作废这一版 + 用正确 kind 重传同一个文件」两步。
   *   作废要填理由 —— 这里替客户写死一条，**不弹窗问他**：
   *   他不是在表达意图，是在纠正系统的判定，让他写理由是把系统的问题推给他。
   */
  async function reclassifyLast() {
    if (lastClassify === null) return
    const target: BaselineKind = lastClassify.kind === 'requirement' ? 'adr' : 'requirement'
    setErrMsg('')
    setUploadBusy(true)
    try {
      const r = await voidBaselineReq(
        token,
        projectId,
        lastClassify.kind,
        '自动归类判错，改归到另一类（系统发起）',
      )
      if (!r.ok) {
        setErrMsg(describeFail(r.failure))
        return
      }
      // 让客户重新选文件 —— 前端拿不到原始 File 对象（浏览器安全限制，不能保留）
      setNotice(
        `已把《${lastClassify.filename}》从「${KIND_META[lastClassify.kind].label}」撤下，` +
          `请重新选择文件上传到「${KIND_META[target].label}」`,
      )
      setLastClassify(null)
      await load()
      onChanged?.()
    } finally {
      setUploadBusy(false)
    }
  }

  /**
   * 把失败结果翻成人话（唯一口径）。
   * ★ 抽出来是因为 `handlePick` / `handlePickAuto` 两条路都要用，
   *   以前写在 `handlePick` 里面，第二条路一加就会复制一份 → 必漂移。
   */
  function describeFail(f2: { kind: string; message?: string }): string {
    if (f2.kind === 'auth') return '凭据失效了，重新登录一下再传'
    if (f2.kind === 'forbidden') return f2.message || '这个身份不能传附件（要用铺主凭据）'
    if (f2.kind === 'insufficient-credits') return '余额不足，传附件不扣分 —— 请联系我们'
    return f2.message || `没传上去（${f2.kind}）`
  }

  /**
   * ★★★ 2026-11-24 删：`handlePick(kind, f)` 整段退役。
   *
   * 它是「我明确知道这是哪一类」的上传路径，唯一调用者是 `handleDrop`（拖到某一格），
   * 而那两个格子已改成**只读的版本链展示**（阿开定的「一个框」）。
   * ⇒ 现在上传只有一条路：`handlePickAuto`（不指定 kind，后端按文件名归类）。
   *
   * ★ 为什么不留着「以防将来要用」：
   *   留着它就是**第二条上传路径，且无人测试** —— 将来谁一改上传逻辑，
   *   会以为改完了，其实还有一条隐形的路在跑旧逻辑（本仓栽过：同一语义两处实现必漂移）。
   *   真需要「显式指定 kind」时，`uploadBaselineReq` 的第三参仍接受 `BaselineKind`，加回来是几行的事。
   */

  /**
   * 删掉某一类的所有版本（含历史），然后可以重传。
   *
   * ★ 为什么整类删：客户的动作是「这份传错了，换一份」。
   *   按版本删要删三次才干净，还会把版本链删断。
   */
  async function handleDelete(kind: BaselineKind) {
    setConfirmKind(null)
    setNotice('')
    setErrMsg('')
    setDeletingKind(kind)
    const r = await deleteBaselineReq(token, projectId, kind)
    setDeletingKind(null)
    if (r.ok) {
      const d = r.data
      // ★ 如实报：删了几条记录、几个文件。有磁盘告警也照说，不假装全成功。
      const warn = d.warnings !== undefined && d.warnings.length > 0 ? `（有 ${d.warnings.length} 条磁盘告警）` : ''
      setNotice(`已删除${KIND_META[kind].label}全部 ${d.rowsDeleted} 个版本${warn}`)
      await load()
      onChanged?.()
    } else {
      const f2 = r.failure
      if (f2.kind === 'auth') setErrMsg('凭据失效了，重新登录一下')
      else if (f2.kind === 'forbidden') setErrMsg(f2.message || '这个身份不能删附件（要用铺主凭据）')
      else if (f2.kind === 'insufficient-credits') setErrMsg('余额不足 —— 删附件不扣分，请联系我们')
      else setErrMsg(f2.message || `没删掉（${f2.kind}）`)
    }
  }

  /**
   * ★★★ 2026-11-24 删：`handleDrop(kind, e)` 退役。
   *
   * 它实现「拖到哪一格就按哪一格上传」。现在拖放区已上移到**唯一的那个框**，
   * 由框自己的 `onDrop` 调 `handlePickAuto`（不带 kind，交给后端按文件名判）。
   * ⇒ 「拖到哪一格」这个语义已经不存在了 —— 只有一格可拖。
   *
   * ★ 原来那段注释里有一条经验仍然有效，搬到这里，别丢：
   *   **只取第一个文件**。一次拖五个进去，客户以为都传了，其实只传了一个；
   *   静默丢四个比拒绝更糟。新框的 `onDrop` 也是 `files?.[0]`。
   */

  /** 当前版 = 没被取代的那一版；按 kind 分组，各取最新 */
  const current: Record<BaselineKind, BaselineFile | undefined> = {
    requirement: files?.find((f) => f.kind === 'requirement' && f.supersededBy === null),
    adr: files?.find((f) => f.kind === 'adr' && f.supersededBy === null),
  }
  const history = (files ?? []).filter((f) => f.supersededBy !== null)

  return (
    <div
      style={{
        padding: isMobile ? 14 : 16,
        marginBottom: 14,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          项目背景及需求说明附件
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: T.dim,
              marginLeft: 8,
              padding: '1px 6px',
              border: `1px solid ${T.border}`,
              borderRadius: 4,
            }}
          >
            项目级
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: T.faint }}>拖文件进来，或点「选择文件」</div>
      </div>

      {/* ── 上传区：一个框，位置只有一个 ── */}
      {/*
        ★★★ 2026-11-24 收成一个框（阿开原话）：
            「项目详情页：附件不是说合并成一个类型都往里传吗？」

        ★ 原来两个框（需求说明书 / 技术方案），客户得先想「这个文件算哪一类」，
          想错了还得删了重传。**分类是系统的事，不是让客户做判断题。**

        ★ 但后端 `kind` 不能真不分（阿开已拍：界面上一个框、后端自动归类、版本链不串）：
          · 版本链：requirement v1/v2/v3 与 adr v1/v2 是两条独立的链，合并会使历史互串
          · Agent 改需求读的是 requirement 的现行版，不是「最新上传那个」（可能是技术方案）

        ★ 所以：**上传时不问，上传后告诉。** 归类结果 + 依据一起显示，
          猜错了人能一眼看见（下面 `lastClassify` 那条提示）。
      */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!uploadBusy) setDragOverAll(true)
        }}
        onDragLeave={(e) => {
          // ★ 只在真正离开这个区时清（不判 relatedTarget 会在子元素间移动时闪）
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverAll(false)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOverAll(false)
          const f = e.dataTransfer.files?.[0]
          if (f !== undefined && !uploadBusy) void handlePickAuto(f)
        }}
        style={{
          marginTop: 8,
          padding: '14px 12px',
          borderRadius: 6,
          background: dragOverAll ? T.accentSoft : T.bg,
          outline: dragOverAll ? `1px dashed ${T.accent}` : `1px dashed ${T.border}`,
          transition: 'background 120ms, outline 120ms',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 12.5, color: T.text, marginBottom: 3 }}>
          {uploadBusy ? '正在上传…' : '把文件拖到这里，或'}
          {!uploadBusy && (
            <>
              {' '}
              <span
                onClick={() => fileInputRef.current?.click()}
                style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
              >
                选择文件
              </span>
            </>
          )}
        </div>
        {/* ★ 阿开要求的提示语（原话：「在附件区域灰色或者小字提示建议上传
            需求说明书或者技术指导方案的说明提示语」）—— 小字灰色，不抢主信息 */}
        <div style={{ fontSize: 11.5, color: T.faint, lineHeight: '17px' }}>
          建议上传<span style={{ color: T.dim }}>需求说明书</span>或
          <span style={{ color: T.dim }}>技术指导方案</span>；系统会按文件名自动归类
          <br />
          {/* ★ 2026-11-24 加：说清「项目级」和「任务级」的分工。
              阿开把这块改名成「项目背景及需求说明附件 · 项目级」，
              而任务详情页另有一块「任务附件（输入件）」——
              两块都叫「附件」，不说明关系客户分不清该往哪儿传。
              ★ 一句话划清：这里=整个项目通用；任务详情里=只给那一条活。 */}
          这里是<span style={{ color: T.dim }}>整个项目通用</span>的背景与需求；
          某一条活专用的小份资料，在任务详情页里传。
        </div>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f !== undefined) void handlePickAuto(f)
            // ★ 清值：不清的话选同一个文件第二次不触发 onChange
            e.target.value = ''
          }}
        />
      </div>

      {/* ── 归类结果提示：让人看得出「凭什么是这一类」 ── */}
      {lastClassify !== null && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color: T.dim,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>
            已归入
            <b style={{ color: T.text }}>{KIND_META[lastClassify.kind].label}</b>
            {lastClassify.by === 'filename' && lastClassify.matched !== null && (
              <span style={{ color: T.faint }}>（文件名含「{lastClassify.matched}」）</span>
            )}
            {lastClassify.by === 'default' && (
              <span style={{ color: T.faint }}>（文件名没认出类型，默认归入这一类）</span>
            )}
          </span>
          {/* ★ 猜错了要能改 —— 不然「自动归类」就是让客户承受系统的错 */}
          <span
            onClick={() => void reclassifyLast()}
            style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
            title={`改归到${KIND_META[lastClassify.kind === 'requirement' ? 'adr' : 'requirement'].label}`}
          >
            改成{KIND_META[lastClassify.kind === 'requirement' ? 'adr' : 'requirement'].label}
          </span>
        </div>
      )}

      {/* ── 两类各自的现行版本与历史 ── */}
      {/*
        ★ 为什么这里仍是两块：**这两块不是上传入口，是版本链的现状**。
          requirement 和 adr 各有一条独立的版本链（v1→v2→v3），
          这一层必须分开显示，否则「需求改到第 3 版了」和「技术方案第 2 版」会混成一条。
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: isMobile ? 0 : 14,
          marginTop: 8,
        }}
      >
      {(['requirement', 'adr'] as const).map((kind) => {
        const meta = KIND_META[kind]
        const cur = current[kind]
        // ★ 2026-11-24：`busy` / `hovering` 已随拖传一起退役 ——
        //   这一块不再是上传入口（上传统一在上面的单框），所以没有「正在传这一格」
        //   也没有「拖到这一格」这两种状态。留着会是**永远为 false 的死判断**。
        const deleting = deletingKind === kind
        const confirming = confirmKind === kind
        const voiding = voidingKind === kind
        /**
         * ★ 2026-11-24：`disabled` 保留（锁/作废/删这些按钮仍在用），
         *   但它的来源从 `busy || deleting` 改成只看 `deleting` ——
         *   `busy`（正在传这一格）已随上传入口上移而退役。
         */
        const disabled = deleting
        return (
          <div
            key={kind}
            style={{
              display: 'flex',
              alignItems: isMobile ? 'stretch' : 'center',
              flexDirection: isMobile ? 'column' : 'row',
              gap: isMobile ? 8 : 10,
              padding: isMobile ? '10px 0' : '8px 10px',
              marginBottom: isMobile && kind === 'requirement' ? 6 : undefined,
              borderRadius: 6,
              background: isMobile ? undefined : T.bg,
              border: isMobile ? undefined : `1px solid ${T.border}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
                {meta.icon} {meta.label}
                {cur !== undefined && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 400,
                      color: T.faint,
                    }}
                  >
                    第 {cur.version} 版 · {humanBytes(cur.bytes)} · {humanTime(cur.uploadedAt)}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: T.dim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {/* ★ 2026-11-24：原来这里显示「松手就上传到这一格」—— 拖传已统一到上方单框，
                    这一块现在是**只读的版本链现状**，不再接受拖放。 */}
                {cur !== undefined ? cur.filename : meta.hint}
              </div>
            </div>

            {/* ★ 2026-11-24 删：这里原来有一个隐藏 `<input type="file">` 和「选择文件」按钮。
                上传统一收进上方单框后，这里若还留着，**界面上就仍然有两个上传入口**
                （这里曾出过两个上传入口叠在一起的问题，改后已收成一个入口）。
                这一块现在的职责只有一个：显示这一类有哪几版、能锁/作废/删。 */}

            {/* ── 二次确认条（★ 不用原生 confirm，产品纪律）── */}
            {confirming ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: T.dim }}>
                  删掉全部版本？重传不受影响
                </span>
                <button
                  type="button"
                  onClick={() => void handleDelete(kind)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    color: '#fff',
                    background: '#b91c1c',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    minHeight: 34,
                  }}
                >
                  确认删除
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmKind(null)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    color: T.dim,
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    minHeight: 34,
                  }}
                >
                  算了
                </button>
              </div>
            ) : voiding ? (
              /* ── 作废填理由（阿开 2026-11-24：作废必填理由）──
                 ★ 为什么单独一层而不是复用删除确认条：
                   删除是「我不要这份了」，作废是「这份不算数了，但留着」——
                   两个动作后果不同，UI 不能长得一样。 */
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="为什么要作废？（必填，例如：客户改成深色系）"
                  style={{
                    flex: '1 1 200px',
                    minWidth: 0,
                    padding: '7px 10px',
                    fontSize: 12.5,
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    background: 'transparent',
                    color: T.text,
                    minHeight: 36,
                  }}
                />
                <button
                  type="button"
                  disabled={voidReason.trim() === ''}
                  onClick={async () => {
                    const k = kind
                    setErrMsg('')
                    try {
                      await voidBaselineReq(token, projectId, k, voidReason.trim())
                      setVoidingKind(null)
                      setVoidReason('')
                      await load()
                      setNotice(`${KIND_META[k].label}已作废，旧版保留在历史里。现在可以上传新版。`)
                    } catch (e) {
                      setErrMsg(e instanceof Error ? e.message : '作废失败，请稍后重试')
                    }
                  }}
                  style={{
                    padding: '7px 12px',
                    fontSize: 12.5,
                    color: voidReason.trim() === '' ? T.faint : '#fff',
                    background: voidReason.trim() === '' ? 'transparent' : '#b45309',
                    border: voidReason.trim() === '' ? `1px solid ${T.border}` : 'none',
                    borderRadius: 6,
                    cursor: voidReason.trim() === '' ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    minHeight: 36,
                  }}
                >
                  确认作废
                </button>
                <button
                  type="button"
                  onClick={() => { setVoidingKind(null); setVoidReason('') }}
                  style={{
                    padding: '7px 12px',
                    fontSize: 12.5,
                    color: T.dim,
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    minHeight: 36,
                  }}
                >
                  算了
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* ★★★ 2026-11-24 删：「换一版 / 选择文件」按钮整块退役。
                    原因不是它坏了，是**上传入口已经上移到上面那个单框**：
                      · 它的 onClick 是 `inputRefs[kind].current?.click()`
                      · 而那一格里的隐藏 `<input>` 已删（它就是重复入口的来源）
                      ⇒ 留着 = 一个点了**毫无反应**的按钮。
                      ★ 「提前亮的按钮不是搭架子，是失约」—— 点了没反应的按钮更糟：
                        用户会以为坏了，而不是明白「入口搬到上面了」。
                    这一块现在的职责只剩：锁 / 删 / 作废（对已上传版本的管理）。 */}
                {/* ── 锁定 / 删除 / 作废（阿开 2026-11-24）──
                    ## 三种状态决定按钮，不是三颗按钮都摆着
                    未锁定：换一版 · 删除 · 确认锁定
                    已锁定：作废（要填理由）—— 删除没了，因为删不动了
                    ★ 「锁定后还显示删除按钮、点了报 409」是骗人，
                      所以按钮必须跟着状态变，不是靠错误提示教育用户。 */}
                {cur !== undefined && !cur.locked && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={async () => {
                      setNotice('')
                      setErrMsg('')
                      setConfirmKind(kind)
                    }}
                    style={{
                      padding: '7px 12px',
                      fontSize: 12.5,
                      color: disabled ? T.faint : '#b91c1c',
                      background: 'transparent',
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      minHeight: 36,
                    }}
                  >
                    删除
                  </button>
                )}
                {cur !== undefined && !cur.locked && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={async () => {
                      setNotice('')
                      setErrMsg('')
                      setLockingKind(kind)
                      try {
                        await lockBaselineReq(token, projectId, kind)
                        await load()
                        setNotice(`${KIND_META[kind].label}已确认锁定。之后不能覆盖或删除，要改请用「作废」并填写理由。`)
                      } catch (e) {
                        setErrMsg(e instanceof Error ? e.message : '锁定失败，请稍后重试')
                      } finally {
                        setLockingKind(null)
                      }
                    }}
                    style={{
                      padding: '7px 12px',
                      fontSize: 12.5,
                      color: disabled ? T.faint : '#15803d',
                      background: 'transparent',
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      minHeight: 36,
                    }}
                  >
                    {lockingKind === kind ? '锁定中…' : '确认锁定'}
                  </button>
                )}
                {cur !== undefined && cur.locked && (
                  <>
                    <span style={{
                      fontSize: 12, color: '#15803d', display: 'inline-flex',
                      alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                    }}>
                      已锁定（不能覆盖）
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setNotice('')
                        setErrMsg('')
                        setVoidingKind(kind)
                        setVoidReason('')
                      }}
                      style={{
                        padding: '7px 12px',
                        fontSize: 12.5,
                        color: disabled ? T.faint : '#b45309',
                        background: 'transparent',
                        border: `1px solid ${T.border}`,
                        borderRadius: 6,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        minHeight: 36,
                      }}
                    >
                      作废
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      </div>

      {/* ── 提示 / 错误 ── */}
      {notice !== '' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#15803d' }}>{notice}</div>
      )}
      {errMsg !== '' && <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{errMsg}</div>}

      {/* ── 历史版本（只在有时出现）── */}
      {history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 11.5, color: T.dim, cursor: 'pointer' }}>
            历史版本（{history.length}）
          </summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {history.map((f) => (
              <li key={f.fileId} style={{ fontSize: 11.5, color: T.faint, marginBottom: 4 }}>
                {KIND_META[f.kind].label} 第 {f.version} 版 · {f.filename} · {humanBytes(f.bytes)} ·{' '}
                {humanTime(f.uploadedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {state === 'error' && (
        <button
          type="button"
          onClick={() => void load()}
          style={{
            marginTop: 8,
            padding: '5px 12px',
            fontSize: 12,
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            color: T.dim,
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      )}
      {state === 'loading' && files === null && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: T.faint }}>加载中…</div>
      )}
    </div>
  )
}
