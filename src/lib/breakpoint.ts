/**
 * 响应式断点 —— **单一来源**（阿开 2026-11-24「网页版支持手机端适应」）
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★★ 为什么要有这个文件，而不是各页面自己写 `window.innerWidth < 700`
 *
 *   同一套断点写在 6 个页面里 = 六个地方各自维护一个数字。
 *   改断点时漏一处，那个页面就在手机上错位 —— 而且**不会报错**，
 *   只是「这个页面怎么怪怪的」。
 *   ⇒ 断点只在这里定义一次，页面 `import` 用。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★★ 为什么用 `matchMedia` 而不是读 `innerWidth`
 *
 *   `innerWidth` 只在渲染那一刻读一次，转屏 / 拖窗口不会重渲染 ⇒ 布局不跟随。
 *   `matchMedia` + `change` 监听会真正触发生效。
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ 断点取值依据
 *
 *   `MOBILE_MAX = 700`
 *     —— 手机竖屏最宽约 430（iPhone 16 Pro Max），横屏约 932。
 *        700 是「手机横屏也算手机」的界：向下覆盖全部手机，
 *        而 iPad 竖屏（768）与桌面窄窗口（>700）走桌面布局。
 *   `NARROW_MAX = 980`
 *     —— 平板竖屏 / 小笔记本。这一档不塌左导航，只把内容区压缩、
 *        表格横向滚动（表格在 700~980 之间横向滚动比拆成卡片更好读）。
 */
import { useEffect, useState } from 'react'

/** 手机断点：≤ 此值走移动布局（左导航变底部/抽屉，内容单列） */
export const MOBILE_MAX = 700

/** 窄屏断点：≤ 此值内容区收紧（表格允许横向滚动） */
export const NARROW_MAX = 980

/**
 * 订阅一个 media query。
 *
 * ★ SSR 安全：`window` 不存在时返回 `false`（按桌面渲染）。
 *   本项目是纯 SPA，但 hydrate 时报错比布局错更难查，所以照 SSR 写。
 */
function useMedia(query: string): boolean {
  const [hit, setHit] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent): void => { setHit(e.matches) }
    // ★ 挂载时对齐一次：首帧 useState 的初值可能与此刻不一致
    //   （转屏发生在 render 与 effect 之间）
    setHit(mq.matches)
    mq.addEventListener('change', onChange)
    return () => { mq.removeEventListener('change', onChange) }
  }, [query])

  return hit
}

/** 是否手机（≤ MOBILE_MAX） */
export function useIsMobile(): boolean {
  return useMedia(`(max-width: ${MOBILE_MAX}px)`)
}

/** 是否窄屏（≤ NARROW_MAX） */
export function useIsNarrow(): boolean {
  return useMedia(`(max-width: ${NARROW_MAX}px)`)
}
