/**
 * KeysPage —— Key 管理（2026-11-23）
 * =====================================================================
 * ★★★ 这个页面解决的是**结构缺陷**，不是加个功能：
 *   首把 Key 30 天有效，而此前只有「发」没有「续 / 换 / 销」
 *   ⇒ **第 31 天客户必然进不来，我方只能手工改库。**
 *   四个端点（list / renew / revoke / rotate）后端已齐，没这个页面
 *   就等于「有钥匙孔但没有门」—— 客户仍要打电话。
 *
 * ★★★ 换发必须「一步换锁」—— 这是本页最容易写成灾难的一处（2026-11-23 修）
 *
 *   服务端 `/keys/rotate` 是**发新 + 吊销旧同事务**，旧 Key 请求完那一刻就 401 了。
 *   所以前端只要还拿着旧 Key，**下一页任何请求都是 401** ——
 *   页面看起来「换发成功了」，实际是把自己锁在门外，而且是客户自己点的。
 *
 *   ⇒ 唯一正确的时机：**客户勾「我已保存」→ 在这一刻把新 Key 交上去**。
 *     ① 不能更早：他还没抄下来，先换了 app 的 token ⇒ 一旦关掉遮罩，
 *        库里只有 sha256，明文永远没了，他手里那把又已吊销 ⇒ 当场死锁。
 *     ② 不能更晚：点「完成」之后页面要重新拉列表，那时必须已经是新 Key。
 *
 *   ⇒ 实现靠 `onKeyChanged(newKey)` 回到 App 的 `saveToken()`，
 *     它同时写 localStorage + setTokenState ⇒ 后续所有页面自动用新 Key。
 *
 * ★★ 三条产品纪律
 *
 *   ① **换发后必须强制展示新 Key 并确认保存**
 *      库里只有 sha256，明文这一刻不展示就永远没了。
 *      若客户手滑关掉，他手里那把新的没用过、旧的已吊销 ⇒ 当场锁死。
 *      ⇒ 换发成功后用**全屏遮罩**盖住列表，勾了「已保存」才放开。
 *
 *   ② **不许吊销「当前正在用的这一把」**（服务端 409 挡，前端也要说清）
 *      吊销它 = 立刻把自己锁在门外，而且他还没拿到替代品。
 *      前端**不给这个按钮**（而不是点了才报错）—— 「能点但报错」是诱导犯错。
 *
 *   ③ **倒计时说人话**
 *      `expiresAt` 是 ISO 串，客户看不出「还有几天」。
 *      剩 ≤7 天标黄、已过期标红，并且**每天都给一个续期按钮**，
 *      不要求他先发现快过期（等发现时通常已经过期了）。
 *
 * ★ 不显示什么（安全底线）：
 *   ✗ 明文 —— 后端只给 8 位 hint，前端也无从显示（换发那一次除外，且必须确认保存）
 *   ✗ 完整 sha256 —— hint 够认出「是哪一把」，整串是凭据材料
 */

import { useCallback, useEffect, useState } from 'react'
import type { KeyInfo } from '../lib/api'
import { listKeys, renewKeyReq, revokeKeyReq, rotateKeyReq } from '../lib/api'
import { T } from '../styles/tokens'
import { EmptyState } from '../components/base'
import { ConfirmBar } from '../components/ConfirmBar'
import { fmtDate, fmtDateTime, daysLeft, humanLeft } from '../lib/datetime'
import { apiBaseUrl, buildIntegrationDoc, renderIntegrationText } from '../lib/agent-integration'
import { PageFooterNote } from '../components/PageFooterNote'

// ★ `daysLeft` / `humanLeft` 已搬进 `lib/datetime.ts`（2026-11-24）——
//   项目详情页的「通行证续期」也要用同一套「剩几天」口径，两处各写一份必漂移。

function statusColor(k: KeyInfo): { fg: string; bg: string; text: string } {
  if (k.status === 'revoked') return { fg: '#6b7280', bg: '#f3f4f6', text: '已吊销' }
  if (k.status === 'expired') return { fg: '#b91c1c', bg: '#fdf0f0', text: '已过期' }
  return { fg: '#15803d', bg: '#f0fdf4', text: '有效' }
}

export function KeysPage({
  token,
  onKeyChanged,
}: {
  token: string
  /** ★ 换发后把新 Key 交回 App（写 localStorage + 换内存 token）。
   *  不给这个回调 = 换发即锁死，所以它是必传项，不是可选项。 */
  onKeyChanged: (newKey: string) => void
}) {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [now, setNow] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** 换发后的新 Key —— ★ 非 null 就用全屏遮罩盖住（见文件头 ①） */
  const [rotated, setRotated] = useState<{
    apiKey: string
    keyHint: string
    message: string
    projectName?: string | null | undefined
    projectId?: string | undefined
  } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)
  /**
   * 待确认的危险动作 —— ★ 2026-11-23 阿开要求
   *
   * 「点击就直接执行了，建议点击弹一个或者切换一个确认？取消？
   *   避免用户好奇想看看会怎么样就直接换掉了。」
   *
   * 为什么用 state 而不是 window.confirm：见 components/ConfirmBar.tsx 文件头。
   * 值为 null = 没有待确认动作 ⇒ 按钮直接执行（保持原行为，不改变日常手感）。
   */
  const [pending, setPending] = useState<
    { kind: 'rotate' } | { kind: 'renew'; hint: string } | { kind: 'revoke'; hint: string } | null
  >(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await listKeys(token)
    setLoading(false)
    if (r.ok) {
      setKeys(r.data.keys)
      setNow(r.data.now)
      setErr(null)
    } else {
      setErr('暂时读不到 Key 列表，稍后再试')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function doRenew(hint: string, days: number) {
    setBusy(hint)
    setErr(null)
    const r = await renewKeyReq(token, hint, days)
    setBusy(null)
    if (r.ok) {
      await load()
    } else {
      // 409 key_revoked / 400 bad_request 都从 failure.message 来
      setErr(
        r.failure.kind === 'conflict' || r.failure.kind === 'server-error'
          ? r.failure.message
          : '续期没成功，稍后再试',
      )
    }
  }

  async function doRevoke(hint: string) {
    setBusy(hint)
    setErr(null)
    const r = await revokeKeyReq(token, hint)
    setBusy(null)
    if (r.ok) {
      await load()
    } else {
      setErr(r.failure.kind === 'conflict' ? r.failure.message : '吊销没成功，稍后再试')
    }
  }

  async function doRotate() {
    setBusy('__rotate__')
    setErr(null)
    const r = await rotateKeyReq(token)
    setBusy(null)
    if (r.ok) {
      setRotated({
        apiKey: r.data.apiKey,
        keyHint: r.data.keyHint,
        message: r.data.message,
        projectName: r.data.projectName,
        projectId: r.data.projectId,
      })
      setConfirmed(false)
      // ★★★ 换发成功后**故意不 load()**。
      //   此刻服务端的旧 Key 已经吊销，而本组件手里还是旧 token ⇒
      //   任何一次 load() 都会 401（console 里出现一条假的「加载失败」，客户会怕）。
      //   列表要等客户勾「我已保存」→ onKeyChanged 换 token → load 回调重建 → 自动重载。
      //   ⇒ 那一次重载用的才是新 Key，一次成功，零 401。
    } else {
      setErr('换发没成功，旧 Key 仍然有效，请稍后再试')
    }
  }

  /**
   * ★★★ 2026-11-23 阿开：「派发钥匙的复制按钮目前只是一个钥匙 key，
   *   发给 Agent 不知道怎么回事，缺少如何接入山海·项目台的接入配置说明」
   *
   * ⇒ 现在复制的**不是一串 Key**，是「整份自包含的接入说明」：
   *   Key + 这枚 Key 只能用于哪个项目 + 怎么鉴权 + 接口地址 + 最小跑通顺序 + 错误码怎么办。
   *
   * ★ 为什么必须这样：用户点「复制」之后，这串东西是交给**另一个 AI 或另一个开发者**的。
   *   对方只有这串文本，没有我们的界面、没有我们的文档。
   *   只给 Key = 对方不知道往哪发、发什么、怎么算成功。
   */
  async function copyKey() {
    if (rotated === null) return
    let text = rotated.apiKey
    try {
      const doc = buildIntegrationDoc(apiBaseUrl(), rotated.projectName ?? '（项目）')
      text = renderIntegrationText(doc, rotated.apiKey, '你的 Agent')
    } catch {
      // 拼说明失败也必须给出 Key —— 宁可少说明，不可交不出通行证
      text = rotated.apiKey
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  // ════════ 换发成功：全屏遮罩，勾确认才放开 ════════
  if (rotated !== null) {
    return (
      <div style={{ padding: '40px 20px', maxWidth: 560, margin: '0 auto', fontSize: 13 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>新的通行证已生成</div>
        <div style={{ color: T.dim, lineHeight: 1.8, marginBottom: 16 }}>
          旧的那把<strong style={{ color: T.text }}>已经同步作废</strong>。
          这串新的<strong style={{ color: T.text }}>只显示这一次</strong>，我们库里只有它的指纹。
        </div>

        <div
          style={{
            padding: '12px 14px',
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 11, color: T.faint, marginBottom: 6 }}>新通行证（Key）</div>
          <div
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.7,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {rotated.apiKey}
          </div>
          <button
            onClick={() => void copyKey()}
            style={{
              marginTop: 10,
              padding: '6px 12px',
              fontSize: 12,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              background: 'transparent',
              color: T.dim,
              cursor: 'pointer',
            }}
          >
            {copied ? '已复制（含接入说明）' : '复制（含接入说明）'}
          </button>
        </div>

        <div
          style={{
            padding: '10px 12px',
            background: '#fffbe8',
            border: '1px solid #f0e0a0',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.8,
            color: '#8a6d00',
            marginBottom: 14,
          }}
        >
          手滑关掉这页就再也看不到它了。旧 Key 已作废，新的没保存 = 进不来。
          请先存到密码管理器或你自己的笔记。
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 12.5,
            cursor: 'pointer',
            marginBottom: 14,
            lineHeight: 1.7,
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              const on = e.target.checked
              setConfirmed(on)
              // ★★★ 就是这一刻 —— 换锁的唯一正确时机
              //   勾上 = 他确认已抄下新 Key ⇒ 立刻把它交给 App（写 localStorage + 换内存 token）。
              //   从此本页任何一次 load() 用的都是新 Key，不会再 401。
              //   勾回取消也不回滚：服务端旧 Key 早已吊销，退回去只会把人锁死。
              if (on) onKeyChanged(rotated.apiKey)
            }}
            style={{ marginTop: 3 }}
          />
          <span>我已把新的通行证保存好了</span>
        </label>

        <button
          onClick={() => {
            setRotated(null)
            setConfirmed(false)
          }}
          disabled={!confirmed}
          style={{
            width: '100%',
            padding: '9px 0',
            fontSize: 13,
            border: 'none',
            borderRadius: 6,
            background: confirmed ? T.accent : T.surfaceSoft,
            color: confirmed ? '#fff' : T.faint,
            cursor: confirmed ? 'pointer' : 'default',
          }}
        >
          完成
        </button>
      </div>
    )
  }

  // ════════ 列表 ════════
  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: T.faint, fontSize: 13 }}>加载中…</div>
  }

  return (
    <div style={{
      padding: '20px 24px',
      // 底部固定说明条会盖住内容 ⇒ 留出它的高度（手机还要让开底部标签栏）
      paddingBottom: 56,
      maxWidth: 820,
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>通行证（API Key）</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 4, lineHeight: 1.7 }}>
            这些是你接入山海项目台的凭证。明文我们不留，所以这里只显示前 8 位用来认。
          </div>
        </div>
        <button
          onClick={() => setPending({ kind: 'rotate' })}
          disabled={busy !== null || pending !== null}
          style={{
            padding: '8px 14px',
            fontSize: 12.5,
            border: 'none',
            borderRadius: 6,
            background: busy === null && pending === null ? T.accent : T.surfaceSoft,
            color: busy === null && pending === null ? '#fff' : T.faint,
            cursor: busy === null && pending === null ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
          }}
          title="发一把新的、同时作废当前这把（怀疑泄露时用）"
        >
          {busy === '__rotate__' ? '换发中…' : '换发新 Key'}
        </button>
      </div>

      {/* ★ 换发确认 —— 这是全页最危险的动作：新 Key 生效的同一刻旧 Key 作废 */}
      {pending?.kind === 'rotate' && (
        <ConfirmBar
          tone="danger"
          confirmLabel="换发"
          busy={busy === '__rotate__'}
          consequence={
            <>
              <b>换发后当前这把当场作废</b>，正在用它连的地方会立刻断开。
              <div style={{ color: T.dim, marginTop: 2 }}>
                新 Key 只会显示一次，记得先准备好抄下来。
              </div>
            </>
          }
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            void doRotate()
          }}
        />
      )}

      {err !== null && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fdf0f0',
            border: '1px solid #f0c0c0',
            borderRadius: 6,
            color: '#b91c1c',
            fontSize: 12,
            marginBottom: 12,
            lineHeight: 1.7,
          }}
        >
          {err}
        </div>
      )}

      {keys.length === 0 ? (
        <EmptyState title="还没有通行证" hint="点右上角「换发新 Key」生成一把。" />
      ) : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {keys.map((k, i) => {
            const c = statusColor(k)
            const left = humanLeft(k.expiresAt, now)
            const urgent = k.status === 'active' && daysLeft(k.expiresAt, now) <= 7
            const isBusy = busy === k.keyHint
            return (
              <div
                key={k.keyHint}
                style={{
                  // ★★★ 2026-11-24 阿开第五点：
                  //   「续期30天点击展开需要向外一层容器，当前容器挤到左边的了」
                  //
                  // 真因：原来这行是 display:flex 横排【左信息】【右按钮列】，
                  //      而 ConfirmBar 写在**按钮列内部**（flexShrink:0 的 div 里）
                  //      ⇒ 它的可用宽度 = 按钮列宽度 ⇒ 只能缩在右侧，看着局促。
                  //
                  // 解法（就是阿开说的「向外一层容器」）：外层改成纵向两行：
                  //   第一行：信息 + 按钮（横排，原样）
                  //   第二行：确认条，横跨整行
                  // ★ 关键不是加样式，是**把确认条从按钮列里挪出来**——
                  //   留在那个 flex 行里，写 width:100% 也是相对被压缩的父容器算。
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : `1px solid ${T.border}`,
                  background: k.status === 'revoked' ? '#fafafa' : 'transparent',
                }}
              >
                {/* ── 第一行：信息 + 按钮（横排）── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <code
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12.5,
                        color: k.status === 'revoked' ? T.faint : T.text,
                      }}
                    >
                      {k.keyHint}…
                    </code>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 7px',
                        borderRadius: 10,
                        background: c.bg,
                        color: c.fg,
                      }}
                    >
                      {c.text}
                    </span>
                    {urgent && (
                      <span style={{ fontSize: 11, color: '#b45309' }}>快到期了</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.dim, lineHeight: 1.7 }}>
                    {k.status === 'revoked'
                      ? `已于 ${fmtDateTime(k.revokedAt)} 吊销`
                      : `${left}（${fmtDate(k.expiresAt)} 到期）`}
                    {' · '}
                    {/* ★ 建于精确到秒（阿开 2026-11-23 要求）——
                        同一秒内可能发多把，只到日就分不清哪把是哪把。 */}
                    建于 {fmtDateTime(k.createdAt)}
                  </div>
                </div>

                {k.status !== 'revoked' && (
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setPending({ kind: 'renew', hint: k.keyHint })}
                        disabled={isBusy || pending !== null}
                        style={btnStyle}
                        title="再续 30 天（这把继续用，只换到期时间）"
                      >
                        {isBusy ? '…' : '续期 30 天'}
                      </button>
                      {/*
                        ★ 吊销按钮：**已吊销的不给、正在进行的不给**
                          不是因为服务端会拒（它会 409），而是「能点但报错」本身就是诱导犯错。
                          但前端无法判断哪把是「当前正在用的」——
                          服务端知道（比对 hash），所以 409 仍是最后一道。
                          这里只对「已过期」的显示吊销：过期了不能续，留着没用。
                      */}
                      {k.status === 'expired' && (
                        <button
                          onClick={() => setPending({ kind: 'revoke', hint: k.keyHint })}
                          disabled={isBusy || pending !== null}
                          style={{ ...btnStyle, color: '#b91c1c' }}
                          title="作废这把（不可逆）"
                        >
                          吊销
                        </button>
                      )}
                    </div>
                  </div>
                )}
                </div>
                {/* ── 第一行闭合（信息 + 按钮）── */}

                {/* ★ 续期确认条：挂在外层，横跨整行（阿开说的「向外一层容器」） */}
                {pending?.kind === 'renew' && pending.hint === k.keyHint && (
                  <div style={{ marginTop: 10 }}>
                    <ConfirmBar
                      tone="normal"
                      confirmLabel="续期 30 天"
                      busy={isBusy}
                      consequence={
                        <>
                          <b>{k.keyHint}…</b> 到期时间往后推 30 天，
                          Key 本身不变，正在用它的地方不受影响。
                        </>
                      }
                      onCancel={() => setPending(null)}
                      onConfirm={() => {
                        setPending(null)
                        void doRenew(k.keyHint, 30)
                      }}
                    />
                  </div>
                )}

                {/* ★ 吊销确认条：同理，在外层横跨整行 */}
                {pending?.kind === 'revoke' && pending.hint === k.keyHint && (
                  <div style={{ marginTop: 10 }}>
                    <ConfirmBar
                      tone="danger"
                      confirmLabel="吊销"
                      busy={isBusy}
                      consequence={
                        <>
                          <b>{k.keyHint}…</b> 将永久作废，<b>不可恢复</b>。
                        </>
                      }
                      onCancel={() => setPending(null)}
                      onConfirm={() => {
                        setPending(null)
                        void doRevoke(k.keyHint)
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/*
        ★ 底部说明条（阿开 2026-11-24）：
          原来它在页面内容最末尾，Key 多了要滚 700+ px 才看得到。
          这两句话是「续期 vs 换发」的判据 —— 用户正是在按钮旁边不知道按哪个，
          往下滚才看到说明等于没写。⇒ 固定到底部，与积分页同一组件。
      */}
      <PageFooterNote>
        续期是「同一把继续用，只换时间」—— 换发是「新的一把生效、旧的当场作废」。
        怀疑泄露时用换发，只是快到期用续期。
      </PageFooterNote>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '5px 11px',
  fontSize: 12,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  background: 'transparent',
  color: T.dim,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
