/**
 * ChatPane —— 右栏主对话流
 * =====================================================================
 * ★ 设计取舍（README §3.2）：「聊天是常态，卡片是插曲」
 *
 * ★★ 空态纪律（阿开铁律「界面做成『演的』是本项目首要风险」）：
 *   没有真实对话数据时，**显示空态说明，不摆假消息**。
 *
 * ★★ 第 6 批：加了「接入凭据」入口
 *   没有凭据时不是报「服务异常」，而是引导填 Key ——
 *   客户第一次进来必然没有凭据，报错等于第一天就吓跑他。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, ChatItem, Message } from '../lib/contract'
import { ChatItemView } from './ChatItemView'
import { listMessages, sendMessage } from '../lib/api'
import { useMessageStream } from '../lib/useMessageStream'

const TOKEN_KEY = 'pm097.token'

/**
 * ISO 时间 → 本地「时:分」。
 *
 * ★ 只显示时:分，不显示日期：同一天内的对话居多，显示完整日期反而噪音。
 * ★ 解析失败就返回空串（不显示 "Invalid Date" 吓人）。
 */
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

interface Props {
  agent: Agent | null
  loadState: 'loading' | 'ready' | 'error'
  errorMsg: string | null
  needToken: boolean
  /** 当前租户的凭据（用于拉消息 / 发消息 / 连 SSE） */
  token: string | null
}

export function ChatPane({ agent, loadState, errorMsg, needToken, token }: Props) {
  // ★ 凭据输入（stub 期方案，见 README §九）
  const [tokenInput, setTokenInput] = useState('')

  // ── 对话状态（2026-11-22 第 5 批补完）──
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [msgError, setMsgError] = useState<string | null>(null)
  /**
   * PM 正在想回复。
   *
   * ★★ 为什么需要这个状态：服务端是「先返回 201，再异步生成回复」。
   *   若不显示「PM 正在回复」，客户发完看到自己那条消息孤零零挂着，
   *   会以为没发出去或对面没人管。
   */
  const [pmThinking, setPmThinking] = useState(false)
  /** 已收到的最后一条 messageId —— SSE 重连时带给服务端补齐 */
  const lastMessageIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const projectId = agent?.currentProjectId ?? null

  /**
   * 拉消息。
   *
   * ★★ 用 `after=<最后一条>` 增量拉，不是每次全拉：
   *   全拉会让每来一条消息就重传整个对话，几百条之后明显卡。
   *   增量拉 + 用 messageId 去重，两条路都安全。
   */
  const reload = useCallback(async () => {
    if (token === null || projectId === null) {
      setMessages([])
      return
    }
    const after = lastMessageIdRef.current
    const r = await listMessages(token, {
      projectId,
      ...(after !== null ? { after, limit: 200 } : { limit: 200 }),
    })
    if (!r.ok) {
      // ★ 拉消息失败不摧毁整个右栏 —— 左栏 Agent 还在，只是这次没拉到
      setMsgError(
        r.failure.kind === 'auth'
          ? '凭据无效'
          : r.failure.kind === 'network'
            ? '网络不通'
            : r.failure.kind === 'insufficient-credits'
              ? '余额不足'
              : r.failure.message,
      )
      return
    }
    setMsgError(null)
    if (r.data.messages.length === 0) return

    setMessages((prev) => {
      // ★ 按 messageId 去重：SSE 通知可能重复（重连补齐 + 正常推送各来一次）
      const seen = new Set(prev.map((m) => m.messageId))
      const merged = [...prev, ...r.data.messages.filter((m) => !seen.has(m.messageId))]
      const last = merged[merged.length - 1]
      if (last !== undefined) lastMessageIdRef.current = last.messageId
      return merged
    })
  }, [token, projectId])

  // 切 Agent / 换项目 ⇒ 重置列表并重拉
  useEffect(() => {
    setMessages([])
    lastMessageIdRef.current = null
    void reload()
  }, [reload])

  // ★ SSE：有变化就重新增量拉一次（推送里没有正文，真值在库里）
  useMessageStream({
    token,
    projectId,
    onNewMessage: () => {
      void reload()
      // ★ 收到任何新消息都结束「PM 正在回复」—— 若来的是 pm 消息，说明回完了；
      //   若是别人（同租户另一客户端）发的，也不该继续转圈。
      //   宁可早一点收掉转圈，也不要让它一直转。
      setPmThinking(false)
    },
    onPmError: (reason) => {
      setPmThinking(false)
      // ★ 把服务端分类翻译成客户看得懂的话。
      //   不显示原始错误 —— 里面可能有内部信息（模型名、余额细节）。
      setMsgError(
        reason === 'empty_reply'
          ? 'PM 这次没说出内容，可以再发一次'
          : 'PM 暂时没能回复，稍后再试',
      )
    },
    lastMessageIdRef,
  })

  // 新消息进来后滚到底部（聊天常态：看最新的）
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])

  async function onSend() {
    const text = draft.trim()
    if (text === '' || sending || token === null || projectId === null) return

    setSending(true)
    setMsgError(null)
    const r = await sendMessage(token, { projectId, content: text })
    setSending(false)

    if (!r.ok) {
      // ★ 失败时**保留草稿**，客户不用重打一遍
      setMsgError(
        r.failure.kind === 'network'
          ? '网络不通，消息没发出去'
          : r.failure.kind === 'insufficient-credits'
            ? '余额不足'
            : r.failure.kind === 'auth'
              ? '凭据无效'
              : r.failure.message,
      )
      return
    }
    // ★ 清空输入并立刻拉一次 —— 不依赖 SSE 到得快
    //   （SSE 万一断着，自己拉这一下能保证「我发的消息我自己看得见」）
    setDraft('')
    void reload()
    // ★ 进入「PM 正在回复」—— 服务端是异步生成，会先在 SSE 上推 message 或 pm_error
    setPmThinking(true)
  }

  if (needToken) {
    return (
      <section className="right" aria-label="对话区">
        <div className="pane-empty">
          <h2>接入你的铺子</h2>
          <p className="hint">
            粘贴你的 API Key。它保存在这台浏览器里，不会发给别人。
          </p>
          <div className="token-form">
            <input
              type="password"
              placeholder="sk-kp_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              aria-label="API Key"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn primary"
              disabled={tokenInput.trim() === ''}
              onClick={() => {
                try {
                  localStorage.setItem(TOKEN_KEY, tokenInput.trim())
                } catch {
                  /* 禁用 storage ⇒ 照样刷一次，只是下次要重填 */
                }
                window.location.reload()
              }}
            >
              接入
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (loadState === 'error') {
    return (
      <section className="right" aria-label="对话区">
        <div className="pane-empty error">
          <h2>连不上</h2>
          <p>{errorMsg ?? '未知错误'}</p>
          <p className="hint">
            如果反复出现，请联系我们 —— 不要自己反复重试。
          </p>
          <div className="card-actions" style={{ justifyContent: 'center' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                try {
                  localStorage.removeItem(TOKEN_KEY)
                } catch {
                  /* ignore */
                }
                window.location.reload()
              }}
            >
              换一个 Key
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (loadState === 'loading') {
    return (
      <section className="right" aria-label="对话区">
        <div className="pane-empty">载入中…</div>
      </section>
    )
  }

  if (!agent) {
    return (
      <section className="right" aria-label="对话区">
        <div className="pane-empty">
          <h2>还没有 Agent</h2>
          <p className="hint">派一个任务之后，会有 Agent 出现在左边。</p>
        </div>
      </section>
    )
  }

  // ══════════════════════════════════════════════════════════
  // 对话流：真实消息（2026-11-22 第 5 批补完）
  // ══════════════════════════════════════════════════════════
  //
  // ★ 消息 → ChatItem 的映射：
  //   role 'client' ⇒ from 'human'（客户自己）
  //   role 'pm'     ⇒ from 'pm'
  //   role 'system' ⇒ 也显示，但标注「系统」（预算冻结之类的公告）
  //
  // ★★ 不做「乐观更新」（发出去就立刻显示假消息）：
  //   乐观更新在失败时会留下一条「其实没发出去」的消息，客户以为说了其实没说。
  //   这里发成功后立刻 reload 一次，体验上已经够快（本机毫秒级）。
  const items: ChatItem[] = []

  return (
    <section className="right" aria-label="对话区">
      <header className="pane-head">
        <div className="pane-title">{agent.displayName}</div>
        {agent.currentProject && <div className="pane-sub">{agent.currentProject}</div>}
      </header>

      <div className="chat-scroll" aria-live="polite" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>这里会显示你和 {agent.displayName} 的对话。</p>
            <p className="hint">
              需要你拍板的时候，会有一张卡片插进来（预算、接入密钥、验收结果）。
            </p>
            {agent.currentAction && (
              <p className="hint">
                此刻：{agent.currentAction}
                {agent.currentProject ? ` · ${agent.currentProject}` : ''}
              </p>
            )}
            {projectId === null && (
              <p className="hint">
                ★ 这个 Agent 现在没有挂项目，所以还不能对话。派个任务给它之后就有了。
              </p>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.messageId}
              // ★ 复用已有的 .msg.mine/.theirs + .bubble 样式（不另造一套）：
              //   client = 我自己说的（右侧蓝底），pm/system = 对方（左侧白底）
              className={`msg ${m.role === 'client' ? 'mine' : 'theirs'}${m.role === 'system' ? ' sys' : ''}`}
              data-role={m.role}
              data-message-id={m.messageId}
            >
              {m.role === 'pm' && <div className="msg-who">{agent.displayName}</div>}
              <div className="bubble">{m.content}</div>
              <div className="msg-time">{formatTime(m.createdAt)}</div>
            </div>
          ))
        )}
        {/*
          ★ PM 正在回复 —— 三条点动画 + 文案。
            不加会怎样：客户发完看到自己那条孤零零挂着，以为没人管。
          ★ 只有 pmThinking 为真才渲染：若 PM 秒回，这里一闪而过也不碍事。
          ★ role="status" 让读屏软件读出来（不是纯装饰）
        */}
        {pmThinking && (
          <div className="msg theirs thinking" role="status" aria-live="polite">
            {/* ★ 此处 agent 必非 null（第 254 行已提前返回），直接访问即可 */}
            <div className="msg-who">{agent.displayName}</div>
            <div className="bubble thinking-bubble">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="thinking-text">正在看项目状态…</span>
            </div>
          </div>
        )}
        {items.length > 0 && items.map((it, i) => <ChatItemView key={i} item={it} />)}
      </div>

      {msgError !== null && (
        <div className="composer-error" role="alert">
          {msgError}
        </div>
      )}

      <footer className="composer">
        <input
          type="text"
          placeholder={
            projectId === null
              ? '这个 Agent 还没有项目，暂时不能对话'
              : `跟 ${agent.displayName} 说点什么…`
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // ★ Enter 发送，Shift+Enter 换行（不过这里是单行输入框，留着以后换多行）
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
          disabled={projectId === null || sending}
          aria-label="消息输入框"
          maxLength={20000}
        />
        <button
          type="button"
          className="btn primary"
          disabled={draft.trim() === '' || sending || projectId === null}
          onClick={() => void onSend()}
        >
          {sending ? '发送中…' : '发送'}
        </button>
      </footer>
    </section>
  )
}
