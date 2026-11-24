/**
 * 状态形状标记 —— 「此刻状态」的视觉编码
 *
 * ═══════════════════════════════════════════════════════════════════
 * ## 为什么用形状，不用纯颜色
 * 改前 `idle`(#6b7280) 与 `offline`(#9ca3af) 是两个分不出的灰 ——
 * 商户看到一个灰点，不知道是「闲着」还是「叫不应」。**这是信息缺失。**
 *
 * ## 编码规则（小砚 V1.0 稿 §状态编码谱）
 *   实心 + 外晕  = 正在动    → 干活中（绿）、等你拍板（橙）
 *   空心灰环    = 人还在    → 空闲
 *   灰点 + 斜杠 = 失联      → 离线
 *
 * ★ 为什么「等你拍板」也用实心：它是**需要你动手**的状态，
 *   视觉权重必须和「干活中」同档 —— 但它用橙色，因为**要你干活的是你**。
 *
 * ★ 为什么离线不用红色：红色留给「失败/错误」。离线是正常的，
 *   天天红一片会让真正的红色警报失效（同族：狼来了）。
 * ═══════════════════════════════════════════════════════════════════
 */
import type { PresenceShape } from '../styles/tokens'

interface Props {
  shape: PresenceShape
  /** 主色（来自 PRESENCE_TONE） */
  color: string
  /** 尺寸，默认 8 */
  size?: number
  /** 给读屏用 —— 形状本身对读屏无意义，文字标签在调用处 */
  ariaHidden?: boolean
}

export function PresenceDot({ shape, color, size = 8, ariaHidden = true }: Props) {
  const aria = ariaHidden ? { 'aria-hidden': true as const } : {}

  // ── 空心：只有描边，表示「人还在，只是手上没活」──
  if (shape === 'hollow') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 10 10"
        style={{ flexShrink: 0, display: 'block' }}
        {...aria}
      >
        <circle cx="5" cy="5" r="3.6" fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    )
  }

  // ── 斜杠：灰点 + 一道斜线，表示「失联」──
  if (shape === 'slash') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 10 10"
        style={{ flexShrink: 0, display: 'block' }}
        {...aria}
      >
        <circle cx="5" cy="5" r="4" fill={color} opacity="0.35" />
        <line
          x1="2.2"
          y1="7.8"
          x2="7.8"
          y2="2.2"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  // ── 实心 + 外晕：正在动 ──
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flexShrink: 0, display: 'block' }}
      {...aria}
    >
      <circle cx="5" cy="5" r="4.6" fill={color} opacity="0.18" />
      <circle cx="5" cy="5" r="2.9" fill={color} />
    </svg>
  )
}
