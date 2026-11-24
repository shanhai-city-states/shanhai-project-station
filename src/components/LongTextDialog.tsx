/**
 * LongTextDialog —— 长文本查看弹窗（2026-11-24 · 阿开实测报的 bug）
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 为什么要有这个件（阿开原话）：
 *   「任务说明字太多了，点击展开就只能看到当前的内容，底部的内容就被截断了。」
 *
 * 实测确认（不是猜的）：
 *   任务说明展开后 div 高 608px，而视口只有 577px
 *   ⇒ 它自己就比屏幕高，底部必然看不见；
 *   同时它 `flexShrink:0` 在左栏里，把消息区压到只剩 121px
 *   ⇒ **一次点开，两处受害**：说明看不全，对话也没了。
 *
 * ★ 为什么改成弹窗而不是「内联滚动」：
 *   内联给 `maxHeight + overflowY:auto` 也能不溢出，但会得到
 *   「页面里一个滚动条 + 里面又一个滚动条」—— 用户滚错条的体验差，
 *   而且在 577px 高的屏里再切 300px 给一个内滚盒，读 700 字很憋。
 *   ⇒ 弹窗把它**抬到整个视口的高度**，读长文本就该占满屏幕。
 *
 * ★ 为什么不复用 AgentLifecycleDialogs 里的 Dialog：
 *   那个 maxWidth 写死 440px（为「确认一句话」设计的），
 *   且它是该文件的私有函数。给确认框加「可宽可滚动」是两种用途混一件，
 *   以后改确认框会牵连阅读器。**一件只做一件事。**
 *
 * ★ 与「预览」的边界：本件只读，不编辑。
 *   任务说明是派单方写定的内容，任务页不该改它（改了等于改历史任务书）。
 */
import { useEffect } from 'react'
import { T } from '../styles/tokens'

export function LongTextDialog({
  title,
  text,
  onClose,
}: {
  title: string
  text: string
  onClose: () => void
}) {
  // Esc 关闭 + 打开期间锁 body 滚动（否则背景页面会在弹窗后面跟着滚）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(16,24,40,0.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      // 点遮罩关闭；卡片内部点一下不该关
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: '100%',
          // 宽一点：长文本一行能放更多字，眼睛少跳行
          maxWidth: 760,
          // ★ 关键：maxHeight 用 vh 而不是固定像素 —— 屏幕高就多给，矮就少给，
          //   永远不会超过视口（这正是内联展开做不到的）。
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(16,24,40,0.18)',
          // 小屏留出上下呼吸
          margin: '0 0 env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* 标题栏：固定不滚 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 18px',
            borderBottom: `1px solid ${T.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600, color: T.text }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              padding: '4px 10px',
              fontSize: 12.5,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: T.dim,
              background: 'transparent',
              border: `1px solid ${T.border}`,
              whiteSpace: 'nowrap',
            }}
          >
            关闭
          </button>
        </div>

        {/* 正文：这里才是滚动容器 —— 只有一条滚动条 */}
        <div
          style={{
            // minHeight:0 是这个 flex 子项能真正收缩的前提，
            // 少了它，内容会把盒子撑开、overflow 不生效（本仓栽过）
            minHeight: 0,
            overflowY: 'auto',
            // ★ 底部留白比顶部大（18 已经不够，实测滚到底时最后一行贴着盒子下沿）
            padding: '14px 18px 32px',
            fontSize: 13.5,
            lineHeight: 1.85,
            whiteSpace: 'pre-wrap',
            // 长 URL / 长 ID 不撑破
            overflowWrap: 'anywhere',
            color: T.text,
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}
