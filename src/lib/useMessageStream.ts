/**
 * lib/useMessageStream.ts —— SSE 订阅（有新消息就通知，正文自己去拉）
 * =====================================================================
 * ★★ 为什么用 EventSource 而不是自己写 fetch+ReadableStream：
 *   EventSource 自带**断线自动重连**，并且重连时会自动带 `Last-Event-ID` 头。
 *   自己写流式读取要手写重连、退避、游标管理 —— 这三样每一样写错都是「消息丢了但不报错」。
 *   浏览器原生的东西能用就用。
 *
 * ★★★ 为什么收到通知后要「自己去拉」而不是直接用推送内容：
 *   推送里**没有正文**（服务端 sse.ts 铁律①就是这么设计的）。
 *   推送只是「有变化」的信号，真值永远在库里。
 *   这样即使推送漏了，下一次拉取也会把库里的真状态同步回来。
 *
 * ★ 生命周期：
 *   挂载时连，卸载时关。切项目要重建连接（URL 带 projectId）。
 *   不做「一个连接听所有项目」—— 那会让过滤逻辑散到客户端，服务端就管不住泄露了。
 */

import { useEffect, useRef } from 'react'

interface Options {
  /** 没有凭据时不连（连了也是 401，白白刷日志） */
  token: string | null
  projectId: string | null
  /** 收到「有新消息」时调这个 —— 调用方负责去拉 */
  onNewMessage: () => void
  /**
   * PM 这次没回成。
   *
   * ★★ 为什么需要这个回调：客户发完消息会等回复。
   *   若服务端只是「不推 message」，前端无从区分
   *   「PM 还在想」和「PM 已经失败了」—— 客户会一直等到自己放弃。
   */
  onPmError: (reason: string) => void
  /** 已收到的最后一条 messageId，重连时带给服务端补齐 */
  lastMessageIdRef: { current: string | null }
}

const BASE = '/api'

export function useMessageStream({
  token,
  projectId,
  onNewMessage,
  onPmError,
  lastMessageIdRef,
}: Options): void {
  // ★ 用 ref 存回调，避免回调变化导致连接反复重连
  //   （onNewMessage 是个新函数实例时，若进依赖数组，每次渲染都会断线重连 —— 消息会漏）
  const cbRef = useRef(onNewMessage)
  cbRef.current = onNewMessage
  const errRef = useRef(onPmError)
  errRef.current = onPmError

  useEffect(() => {
    if (token === null) return

    const qs = new URLSearchParams()
    if (projectId !== null) qs.set('projectId', projectId)

    // ★ EventSource 不能加自定义 header ⇒ 凭据放 query。
    //   ⚠️ 这是 stub 期的妥协：URL 里的凭据会进 Nginx access log。
    //   正式版必须换成「短期票据」或把凭据放 Cookie（见 README §九）。
    //   我把这条限制写在这里而不是藏起来 —— 免得以后当成「已经解决了」。
    qs.set('token', token)

    const url = `${BASE}/events?${qs.toString()}`
    let es: EventSource | null = null
    let closed = false

    try {
      es = new EventSource(url)
    } catch {
      // 构造失败（极少见）⇒ 静默放弃，不影响主流程（拉取仍能工作）
      return
    }

    es.addEventListener('message', () => {
      // ★ 只当信号用，不解析内容
      cbRef.current()
    })

    // ★ PM 没回成 —— 必须让界面知道，否则客户一直等
    //   事件名由服务端 `event: pm_error` 决定，不是默认的 message
    es.addEventListener('pm_error', (ev: Event) => {
      let reason = 'unknown'
      try {
        const data = JSON.parse((ev as MessageEvent).data as string) as { reason?: unknown }
        if (typeof data.reason === 'string') reason = data.reason
      } catch {
        // ★ 解析失败也要通知（宁可显示「未知原因」，也不让界面静默）
      }
      errRef.current(reason)
    })

    // ★ 错误处理：EventSource 会自己重连，这里**不做手动重连**（会重复连）
    //   只在 readyState 变成 CLOSED 说明彻底失败时才放弃。
    es.addEventListener('error', () => {
      if (es !== null && es.readyState === EventSource.CLOSED) {
        es.close()
        es = null
      }
    })

    return () => {
      closed = true
      if (es !== null) {
        es.close()
        es = null
      }
      // closed 只是标记，避免清理期间回调再触发拉取
      void closed
    }
  }, [token, projectId, lastMessageIdRef])
}
