/**
 * AppShell —— 顶栏 + 左导航（6 页共用）
 * =====================================================================
 * 设计依据：小砚设计稿 §四「页面骨架（顶栏 + 左导航）算第 9 个，`AppShell`，一次写完 6 页复用」
 *
 * ★★ 主形态已定（小D 2026-11-23 拍板）：
 *     「列表为主，对话为辅」—— 097 是任务大厅，不是聊天工具。
 *
 *   ⚠️ 本文件替代的是旧 `App.tsx` 的「左 Agent 列表 + 右对话」两栏壳。
 *      旧壳依据是阿开 2026-11-22 的口述（「参考 Grok bot / 飞书的左列表右沟通」），
 *      当时是 stub 期形态判断；小D 2026-11-23 按产品定位改判为「列表为主」。
 *
 *   ⇒ 所以这不是「在旧壳上加页面」，是**换主壳**。旧 App.tsx 的对话区
 *     降级为 P3 任务详情页里的一个 tab（下一步做）。
 *
 * ★ 角色（客户 / 铺主）：**现在不做切换**。
 *   UI 核对已标「无角色概念，需产品语义定夺」。
 *   这里只留一个 `role` 入参和一个渲染位，**不放假开关** ——
 *   放个点了没用的按钮比没有更糟（产品铁律：提前亮的按钮不是搭架子，是失约）。
 */

import type { ReactNode } from 'react'
import { T } from '../styles/tokens'
import { useIsMobile } from '../lib/breakpoint'

export type NavKey = 'projects' | 'agents' | 'billing' | 'keys'

/**
 * ★ 布局尺寸的唯一来源（阿开 2026-11-24）。
 *
 * 为什么要导出：积分页要放一条「固定在底部」的说明条，它得知道
 * ① 桌面端左边侧栏多宽（fixed 的 left 要避开它）
 * ② 手机端底部标签栏多高（fixed 的 bottom 要叠在它上面）
 *
 * ★★ 不许两处各写一个 168 / 56 —— 那是「同一事实两处各算一份」，
 *    改一处忘一处就漂移（本仓已栽过多次的形态）。
 */
export const SIDE_W = 168
export const BOTTOM_H = 56

/**
 * ★★★ 2026-11-24 阿开拍板：「雇人」与「派活看板」合并成一项「我的 Agent」
 *
 *   原话：「雇人页面一个 Agent 的一栏很长，可以把状态展示在右边的空间，
 *         且每一栏右边增加一个派活按钮自动跳到项目页面是否体验感更好」
 *
 *   合并前是两栏（库=改 / 状态=看），合并后一栏两区（左名单 / 右状态），
 *   每行末尾一个「派活」按钮 —— 看完这个人立刻能给他派活，不用切页。
 *
 *   ★ 为什么原来坚持分栏是对的、现在合并也是对的：
 *     原来分栏要解决的是「找不到在哪雇人」。现在雇人入口已经稳定，
 *     真正卡手的是「看到人 → 要派活 → 得先去项目 → 再选人」这一跳。
 *     ⇒ 阶段变了，问题变了，结构跟着变。**不是推翻自己，是问题换了。**
 *
 *   ★ 历史 NavKey `agent-library` 保留兼容：老链接 / 老代码里可能还有它，
 *     在 App.tsx 里把它映射到 'agents'，不报错。
 */
const NAV: { key: NavKey; label: string; ready: boolean; icon: string }[] = [
  { key: 'projects', label: '项目', ready: true, icon: '▤' },
  { key: 'agents', label: '我的 Agent', ready: true, icon: '◉' },
  // ★ 2026-11-24：billing 页做出来了 ⇒ ready 改 true，去掉「待建」标签。
  //   「待建」是给客户的一个诚实标记 —— 做完了还挂着它，就是把做好的说成没做好。
  { key: 'billing', label: '积分 / 账单', ready: true, icon: '◈' },
  { key: 'keys', label: 'Key 管理', ready: true, icon: '⌘' },
]

export interface AppShellProps {
  active: NavKey
  onNav: (k: NavKey) => void
  /**
   * 顶栏右侧自定义内容
   * ★ 写 `ReactNode | undefined` 而不是 `?: ReactNode`：
   *   本仓开了 `exactOptionalPropertyTypes`，「不传」与「传了 undefined」是两回事。
   *   写成 `?` 时调用方 `onBack={cond ? fn : undefined}` 会编译报错。
   */
  right?: ReactNode | undefined
  children: ReactNode
  /** 服务版本号（来自 /api/health，★ 前端不许手写） */
  version?: string | null | undefined
  /** 返回上一级（详情页用），不传则不显示 */
  onBack?: (() => void) | undefined
  /** 面包屑文字，如「项目 / 川财对账」 */
  breadcrumb?: string | undefined
  /**
   * 返回按钮上的**目的地**文字（2026-11-24 加）。
   *
   * ★ 为什么不写死「返回」：阿开第二次说「还是没有返回项目详情页的按钮」。
   *   按钮一直在，但纯文字「← 返回」紧贴面包屑，读起来像路径的一部分。
   *   「返回」只说了方向，「项目详情」说了**去哪** ——
   *   他要的不是「能退」，是「退到那个具体的页」。
   * ★ 不传时退回「返回」：别的入口（未来的设置页等）没有固定上级，硬编一个地名会撒谎。
   */
  backLabel?: string | undefined
  /**
   * 顶栏**下方**的通栏插槽 —— 预算止损横幅放这儿。
   *
   * ★ 为什么在 AppShell 里留位、而不是各页面自己塞：
   *   阿开定「在顶部菜单栏下方长时间展示」。如果每个页面自己插，
   *   将来新加一个页面忘了插 ⇒ **那个页面上预警就消失了** ——
   *   而预警消失比没有预警更危险（客户以为没事）。
   *   ⇒ 位置由壳统一提供，页面只决定「传不传内容」，不可能漏。
   */
  banner?: ReactNode | undefined
  /**
   * 页面自己管滚动（默认 false = 壳管整页滚）。
   *
   * ★★★ 2026-11-24 加，起因是一个真 bug：
   *   上一轮为了让任务详情页能「输入框钉底、消息区自己滚」，
   *   把本壳的高度写成了 `height: calc(100vh - 52px)` —— 高度定了，
   *   但**别的页面靠「整页滚」**（项目详情页的任务表格在视口下方）。
   *   height 一定 ⇒ 溢出部分被祖先裁掉 ⇒ 项目详情页滚不到任务表格。
   *   阿开实测报：「项目详情页滚动都坏了任务显示不全」。
   *
   * ★ 为什么不统一成「都内部滚」：项目详情页是**从上到下读的长页面**
   *   （页头/统计/附件/Agent/任务表），它天生就该整页滚；
   *   强行塞进一个定高容器里，要么裁掉、要么再造一层内滚，
   *   用户要在一个 500px 高的盒子里滚一张表 —— 更难受。
   *
   * ★ 所以形状是：**壳默认整页滚，要钉底的那一页显式说「不」**。
   *   默认值选「整页滚」而不是「内部滚」，因为多数页面是长页面；
   *   少数派（任务详情）显式声明，读代码的人一眼看到它就是那个例外。
   */
  noPageScroll?: boolean | undefined
}

export function AppShell({
  active,
  onNav,
  right,
  children,
  version,
  onBack,
  breadcrumb,
  backLabel,
  banner,
  noPageScroll = false,
}: AppShellProps) {
  const isMobile = useIsMobile()

  // ── 手机：底部标签栏 ──────────────────────────────────────────
  // ★ 为什么手机不能用左导航：
  //   左导航固定 168px，手机竖屏总宽 390 ⇒ 剩 222px 放内容，表格必爆。
  //   改成底部栏是手机端的通行做法：拇指够得着，且不占水平空间。
  // ★ 底部栏要预留 safe-area（iPhone 底部横条），否则最后一项被横条压住。
  // ★ BOTTOM_H 已提到模块顶层导出（积分页的固定底条要用），此处不再重复定义
  return (
    <div style={{
      minHeight: '100vh',
      background: T.bg,
      color: T.text,
      fontSize: 13,
      // ★ 手机给底部栏留出空间，否则内容最后一行被遮住
      paddingBottom: isMobile ? BOTTOM_H + 8 : 0,
      boxSizing: 'border-box',
    }}>
      {/* ── 顶栏 ── */}
      <div
        style={{
          height: isMobile ? 46 : 52,
          display: 'flex',
          alignItems: 'center',
          padding: isMobile ? '0 12px' : '0 20px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          gap: isMobile ? 10 : 20,
          // ★ 顶栏吸顶：手机上滚长列表时不希望顶栏跟着跑掉
          position: isMobile ? 'sticky' : undefined,
          top: isMobile ? 0 : undefined,
          zIndex: isMobile ? 10 : undefined,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>山海 · 项目台</div>

        {breadcrumb !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: isMobile ? 12 : 13, minWidth: 0 }}>
            {onBack !== undefined && (
              <button
                onClick={onBack}
                /**
                 * ★★★ 2026-11-24 改（阿开第二次说「还是没有返回项目详情页的按钮」）：
                 *
                 * 按钮**一直在**（第一版就是这样），但它是这样一个东西：
                 *   background: transparent + border: none + 13px 纯文字 + 紧贴面包屑
                 * ⇒ 视觉上和「项目 / 需求-项目详情页UI重设计 / 任务」连成一行，
                 *   用户读下来是**一段路径文字**，不是**一个可点的操作**。
                 *
                 * ★ 我的错不在于「没加按钮」，而在于**加了却没法被看见**。
                 *   「存在」和「被看见」是两件事；用户说的是后者。
                 *   ★★★ 这与本仓反复栽的形态同族：
                 *     改的是「我以为用户在看的地方」，而不是「用户真正看的地方」。
                 *
                 * 三条一起改：
                 *   ① 给它**边框 + 浅底** —— 让它有按钮的形状（形状即功能提示）
                 *   ② 文字从「← 返回」改成「← 项目详情」——
                 *      「返回」只说了方向，「项目详情」说了**目的地**；
                 *      用户要的从来不是「能退」，是「退到那个具体的页」
                 *   ③ 与面包屑拉开 10px —— 让它们读起来是两件事
                 *
                 * ★ 为什么不改成「放在内容区里的大按钮」：
                 *   顶栏返回是全网通行位置（飞书/钉钉/GitHub 都在左上），
                 *   挪到内容区反而要重新学。**位置不改，把它做成按钮。**
                 */
                title={backLabel === undefined ? '返回上一级' : `返回${backLabel}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: T.bg,
                  border: `1px solid ${T.border}`,
                  color: T.accent,
                  cursor: 'pointer',
                  fontSize: isMobile ? 12 : 12.5,
                  fontFamily: 'inherit',
                  padding: '3px 9px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  // ★ 不参与收缩：面包屑再长也不能把按钮挤没
                  flexShrink: 0,
                }}
              >
                ← {backLabel === undefined ? '返回' : backLabel}
              </button>
            )}
            {/* ★ 按钮与面包屑之间多留一点 —— 8px 时两者会视觉粘连 */}
            {onBack !== undefined && <span style={{ width: 2 }} />}
            {/* ★ 手机上面包屑可能很长（「项目 / 某某项目名」），
                单行省略号，不然顶栏被撑爆 */}
            <span style={{
              color: T.dim,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{breadcrumb}</span>
          </div>
        )}

        <div style={{ flex: 1 }} />
        {right}
        {/* ★ 手机不显示版本号：顶栏太挤，版本号是开发者关心的 */}
        {version != null && !isMobile && (
          <span style={{ fontSize: 11, color: T.faint, whiteSpace: 'nowrap' }}>v{version}</span>
        )}
      </div>

      {/* ── 顶栏下方通栏：预算止损横幅（阿开定位置）── */}
      {banner}

      {/* ★ noPageScroll 时（任务详情页）才有确定高度，供内部 flex 计算。
          其余页面保持 minHeight —— 内容高了就让 body 滚，与改造前一致。 */}
      {/*
        ★★★ 2026-11-24 阿开第四次指出（关键修正）：
          「好像不行，滚动条往下滚左侧就不够长了，除非左侧也固定与底部连接上，
            滚动的只是右边的部分」

        ## 我前三次都改错了地方
        前三次都在调「侧栏底边 vs 底条顶边」的静态对齐（改 margin、改 CSS 变量）。
        静态下确实对齐了（761 == 761），但**一滚就崩**：
          实测 Key 页滚到底 ⇒ 侧栏 top=-801 / bottom=-92
          ⇒ 侧栏整条跟着内容滚出屏幕，缺口 853px。
        根因：**左侧栏原本是滚动容器的子节点**，滚动容器滚，它就跟着滚。

        ## 现在的形状（阿开说的「左侧固定，只滚右边」）
          <div flex 定高 overflowY:hidden>   ← 只当容器，自己不滚
             ├─ 左侧栏（block 子项，永不滚动）
             └─ <div flex:1 overflowY:auto>  ← ★ 唯一滚动者
                   └─ 主内容

        ## ★ 为什么要给左栏加 marginBottom（不是 paddingBottom）
        底条是 `position:fixed` 浮在最上层（在整页最底），而左栏只到容器底。
        容器底 = 视口底（桌面）⇒ 底条仍会盖住左栏底部 39px。
        所以左栏仍要让出 `--sh-footer-h`（底条运行时量出的高度）。
        ★ 用 margin：padding 只塞空白，背景和边框仍画到底，竖线照样被切。
        ★ 这次它只影响"静态高度"，滚动已由结构解决 —— 两者互补。

        ## ★★★ 为什么滚动容器要用 overflowY:hidden 包一层，而不是直接 overflow:auto
        若左栏与内容同一个滚动容器，无论怎么调 margin 都没用 —— 滚动时一起走。
        必须**结构上分开**：外层只负责「撑满视口高度」，内层负责滚。
      */}
      <div style={{
        display: 'flex',
        height: isMobile ? undefined : 'calc(100vh - 52px)',
        minHeight: isMobile ? undefined : 'calc(100vh - 52px)',
        // ★ 外层不再滚 —— 溢出交给右侧内容区自己滚（阿开：只滚右边）
        overflow: 'hidden',
      }}>
        {/* ── 左导航（仅桌面）── */}
        {!isMobile && (
          <div
            style={{
              width: SIDE_W,
              borderRight: `1px solid ${T.border}`,
              padding: '12px 0',
              background: T.surface,
              flexShrink: 0,
              /**
               * ★★★ 2026-11-24 阿开第四次指出后的最终形态：
               *   「除非左侧也固定与底部连接上，滚动的只是右边的部分」
               *
               * 结构上左栏已与滚动容器分开（外层 overflow:hidden，只右栏滚），
               * 所以它天然「固定」，不会跟着内容跑。
               *
               * 这里要解决的是**静态高度**：底条 `position:fixed` 浮在整页最底，
               * 而容器底 = 视口底 ⇒ 底条会盖住左栏底部（实测 39px）。
               *
               * ★ 用 marginBottom 不用 paddingBottom：
               *   padding 只往里塞空白，**背景色与右边框仍画到最底** ⇒
               *   竖线照样顶进底条里，视觉上还是被切。（第一版写错，已改）
               *   margin 才是真把盒子缩上去，背景和边框一起停在底条上沿。
               *
               * ★ 读 CSS 变量不写死 39：底条高度随文案/字号/设备变，写死必漂移。
               * ★ 无底条的页面（项目 / 我的 Agent）变量未定义 ⇒ 回退 0，不受影响。
               */
              marginBottom: 'var(--sh-footer-h, 0px)',
              // ★ 高度由 flex 拉伸撑满（不写 height，避免与 marginBottom 打架）
              alignSelf: 'stretch',
              // ★ 左栏自己也不滚：菜单项少，且滚动会让「固定」失效
              overflowY: 'auto',
            }}
          >
            {NAV.map((item) => {
              const isActive = item.key === active
              return (
                <div
                  key={item.key}
                  onClick={() => onNav(item.key)}
                  style={{
                    padding: '9px 18px',
                    fontSize: 13,
                    cursor: 'pointer',
                    color: isActive ? T.accent : item.ready ? T.text : T.faint,
                    background: isActive ? T.accentSoft : 'transparent',
                    borderLeft: isActive ? `2px solid ${T.accent}` : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {item.label}
                  {!item.ready && <span style={{ fontSize: 10, color: T.faint }}>待建</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* ── 主内容 ──
            ★★★ 2026-11-24 两处修正（阿开实测报「项目详情页滚动坏了、任务显示不全」）：

            【错1】原来无条件写 `display:flex; flexDirection:column`。
              我当初想的是「任务详情页要纵向 flex 才能钉底」——
              但**别的页面被这条也拖下水了**：纵向 flex 下子项默认 flex-shrink:1，
              项目详情页内容超过可用高度时，DataTable 容器被**压成 2px**
              （实测：TABLE 144px 的父 div 只有 2px 且 overflow:hidden）
              ⇒ 表格被裁掉、滚动区也算不进它的高度 ⇒ 滚到底也看不见。
              ★ 教训：为了 A 页面加的一条布局，会改掉 B 页面的既有行为。
                「一处改动的作用范围」要按**所有使用方**算，不是按我想到的那个算。

            【错2】把「壳管滚动」和「页管滚动」混在一层里，两个都想管 ⇒ 都不对。

            【现在的形状】
              · 默认：`block` 布局 —— 内容多高就多高，外层 overflowY:auto 整页滚。
              · noPageScroll（任务详情）：`flex column` + minHeight:0 —— 子项可收缩、
                可 flex:1 分高度 ⇒ 消息区内部滚、输入框钉底。
            ★ 这个分支是「侧栏不跟着滚动」的唯一保障，改坏会导致整页滚动错位。 */}
        <div style={{
          flex: 1,
          // ★★★ 2026-11-24 阿开「现在状态那些太挤右边了，适当往左边均衡一下」的真根因：
          //
          //   不是列宽 —— 列宽改了四轮，实测右侧各列已严格按声明值（484px 合计），
          //   最后一列文字离右边界还有 44px，不贴边。
          //
          //   真根因在这行 padding：左边有 168px 侧栏，右边只有 24px。
          //   视觉重心 = 左边 168+24=192px 留白 vs 右边 24px 留白 ⇒ 整页向右偏。
          //   表格 1222px 宽、右边只差视口 25px 就顶到屏幕边，看起来就是「挤右边」。
          //
          //   ⇒ 右侧给到 56px，让左右呼吸感接近。
          //     ★ 为什么不是 192px：右边留 192 会让表格只剩 1054px，
          //       「任务」列跟着缩水 —— 那是从「挤右边」换成「挤中间」。
          //       56px 是实测出来的均衡点。
          //
          //   ★★★ CSS shorthand 顺序坑（本轮实撞）：`padding: 上 右 下 左`。
          //     第一版写成 '20px 24px 20px 56px' ⇒ 右=24、左=56，**左右写反了**，
          //     于是左侧更宽、右侧没变，等于把一个错误换成另一个错误。
          //     早期的检查没抓到，因为它也从同一字符串按第 4 位读 ——
          //     尺子和被测物用了同一个错误假设。
          //     ⇒ 现在写成四值显式 '20px 56px 20px 24px'，读第 2 位才准。
          padding: isMobile ? '14px 12px' : '20px 56px 20px 24px',
          minWidth: 0,
          /**
           * ★★★ 2026-11-24：主内容区成为**唯一滚动者**（阿开：只滚右边）
           *
           * 外层已改成 overflow:hidden 不滚，所以溢出必须在这里消化，
           * 否则内容直接被裁掉（比滚动丢失更糟 —— 看不见 = 不存在）。
           *
           * ★ noPageScroll（任务详情页）例外：它自己那一套 flex column +
           *   内部 overflowY:auto 已经在管滚动，这里再 auto 会套两层滚动条，
           *   且会把内部的 minHeight:0 链条打断。所以它给 hidden。
           */
          overflowY: noPageScroll ? 'hidden' : 'auto',
          ...(noPageScroll
            ? {
                // ── 任务详情页：纵向 flex，供内部 flex:1 + overflowY:auto 算高度
                display: 'flex',
                flexDirection: 'column' as const,
                minHeight: 0,
              }
            : {
                // ── 其余页面：普通块布局，内容自然撑高，本层滚
                //   ★ 不写 display:flex —— 写了就会压扁 DataTable（见上方错1）
                minHeight: '100%',
              }),
        }}>{children}</div>
      </div>

      {/* ── 底部标签栏（仅手机）── */}
      {isMobile && (
        <nav style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: `calc(${BOTTOM_H}px + env(safe-area-inset-bottom, 0px))`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          display: 'flex',
          background: T.surface,
          borderTop: `1px solid ${T.border}`,
          zIndex: 20,
        }}>
          {NAV.map((item) => {
            const isActive = item.key === active
            return (
              <div
                key={item.key}
                onClick={() => onNav(item.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  cursor: 'pointer',
                  color: isActive ? T.accent : T.dim,
                  // ★ 触摸目标 ≥ 44px 是 iOS/Android 的可用性下限
                  minHeight: 44,
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>{item.label}</span>
              </div>
            )
          })}
        </nav>
      )}
    </div>
  )
}
