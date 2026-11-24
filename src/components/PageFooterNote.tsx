import React, { useEffect, useRef } from 'react';
import { BOTTOM_H } from './AppShell';
import { useIsMobile } from '../lib/breakpoint';

/**
 * 页面底部固定说明条（阿开 2026-11-24）。
 *
 * ## 为什么做成共用组件，而不是两页各写一份
 * 阿开连着两次要求：「积分页底部那行字固定到底部」「Key 管理页底部那行字也固定」。
 * 若两页各写一份 `position: fixed`，那些位移量（侧栏宽、标签栏高、z-index）
 * 就会各有各的写法 —— 改一处忘一处，下次又是「一边对一边不对」。
 * ⇒ 位移量只在这里写一次，两页只传内容进来。
 *
 * ## 为什么横跨整页宽度（left: 0），不避开侧栏
 * 第一版是 `left: 168px`（只覆盖右侧内容区）。实测左侧栏底边虽与右侧齐平，
 * 但右侧底部有一条灰底收尾、左侧底部是大片空白 —— 阿开说「看起来不是很好看」。
 * 把底条拉到整页宽，左侧栏底部也被接住。
 *
 * ## ★★★ 关键：把自身高度写进 CSS 变量 `--sh-footer-h`
 * 阿开第三次说：「页面的左侧栏竖栏跟右侧的底部不对齐」。
 *
 * 真因：底条是 `position: fixed`（浮在最上层），左侧栏在文档流里，
 *      两者都贴视口底 ⇒ 底条把左侧栏底部**盖住 39px**，竖线看起来被切断。
 *
 * 解法：底条运行时**量出自己有多高**，写进 `--sh-footer-h`；
 *      AppShell 的左侧栏读这个变量做 `marginBottom` ⇒ 侧栏背景与右边框
 *      一起停在底条上沿，左右底边才真正齐平。
 *
 * ★ 为什么用「运行时测量」而不是写死 39：
 *   底条高度随文案行数、字号、手机/桌面 padding 变化。
 *   写死一个数，改文案就再次不齐 —— 本仓栽过多次「同一事实两处各算一份」。
 *   测量是唯一不会漂移的做法。
 *
 * ★ 为什么用 ResizeObserver 而不是只测一次：
 *   窗口缩放会让文字重新折行 ⇒ 高度变 ⇒ 必须持续跟随。
 *   卸载时把变量清掉，否则离开本页后侧栏还留着上页的缺口（会露白）。
 */
export function PageFooterNote({ children }: { children: React.ReactNode }): React.ReactElement {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;

    const sync = (): void => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty('--sh-footer-h', `${h}px`);
    };
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(el);

    return () => {
      ro.disconnect();
      // ★ 离开本页 ⇒ 清掉变量，让没有底条的页面（项目 / 我的 Agent）侧栏恢复满高
      document.documentElement.style.removeProperty('--sh-footer-h');
    };
  }, [isMobile]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // ★ 手机端叠在 56px 标签栏之上；桌面端贴视口最底
        bottom: isMobile ? BOTTOM_H : 0,
        zIndex: 9,
        background: 'var(--sh-surface, #fff)',
        borderTop: '1px solid var(--sh-border, #e5e7eb)',
        padding: isMobile ? '8px 12px' : '10px 20px',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--sh-faint, #9ca3af)',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}
