/**
 * 097 · 山海 PM Agent · 设计令牌
 * =====================================================================
 * ★★ 本文件与 083 `plugin-wisdom/src/client/theme.ts` 的关系（必须读清）
 *
 *   083 那份的主题变量是 `var(--dsw-alias-*)` —— **那是 DSH 宿主注入的**。
 *   097 是**独立站**（pm.ak2029.com），没有宿主 ⇒ 照搬会全部 fallback 成兜底值，
 *   等于把「跟宿主统一」写在纸面上、实际根本没生效。
 *
 *   ⇒ 所以这里**自己定义 CSS 变量**（见 styles/tokens.css），本文件只是它们的 TS 引用。
 *
 * ★ 保留了什么：**语义色值逐字对齐 083**（VERDICT_TONE / SEVERITY_TONE）。
 *   理由是这些是**产品语义**不是主题，两边必须一眼看上去是同一个产品。
 *   ★ 改色 = 改视觉契约，须走评审。
 */

/** 容器/文字/边框 —— 全部经 CSS 变量，支持深浅主题切换 */
export const T = {
  text: 'var(--pm-text)',
  dim: 'var(--pm-text-dim)',
  faint: 'var(--pm-text-faint)',
  border: 'var(--pm-border)',
  borderSoft: 'var(--pm-border-soft)',
  surface: 'var(--pm-surface)',
  surfaceSoft: 'var(--pm-surface-soft)',
  bg: 'var(--pm-bg)',
  accent: 'var(--pm-accent)',
  accentSoft: 'var(--pm-accent-soft)',
} as const

/**
 * ★ 验收结论四态 —— 与 083 `VERDICT_TONE` **取值逐字一致**。
 *   `bg` 用于实底（配白字，双主题都可读）；`fg` 用于文字/图标（浅底场景）。
 *   ⚠️ 两套不可混用。
 */
export const VERDICT_TONE = {
  pass: { bg: '#15803d', fg: '#15803d' },
  conditional: { bg: '#b45309', fg: '#b45309' },
  fail: { bg: '#b91c1c', fg: '#b91c1c' },
  unverifiable: { bg: '#5b21b6', fg: '#5b21b6' },
} as const

export type VerdictKey = keyof typeof VERDICT_TONE

/** 差异级别：只做「看得见的层级差」，状态不只靠颜色（与 083 一致） */
export const SEVERITY_TONE = {
  high: { bg: '#b91c1c', label: 'high' },
  mid: { bg: '#b45309', label: 'mid' },
  low: { bg: '#4b5563', label: 'low' },
} as const

export type SeverityKey = keyof typeof SEVERITY_TONE

/**
 * ★ Agent 此刻状态（presence）—— 四态 · **形状编码**（2026-11-25 小砚 V1.0 稿）
 *
 * ══════════════════════════════════════════════════════════════════
 * ## ★★★ 为什么加「形状」不只是加颜色
 * 改前四种态里 `idle`(#6b7280) 和 `offline`(#9ca3af) 是两个几乎分不出的灰 ——
 * 商户看到灰点不知道是「闲着」还是「叫不应」。这是**信息缺失**，不是审美问题。
 *
 * ⇒ 形状轴：实心=正在动（干活中/等你拍板）、空心=人还在只是没活（空闲）、
 *           斜杠=失联（离线）。**色盲/黑白打印下也分得开。**
 *
 * ## ★★★ `blocked` 的语义纠正（2026-11-25 实测的真 bug）
 * 后端 `presence='blocked'` 此前被两处前端各译了一遍：
 *   · tokens.ts 这里写「等你拍板」
 *   · AgentsPage.tsx 的 PRESENCE_HINT 写「账号已停用」
 * ⇒ 商户看到「等你拍板 · 账号已停用」，**以为账号被封了**。
 *
 * 根因不是文案笔误，是**一个字段承担了两个语义**：
 *   账号 suspended      → blocked  （这是账号级）
 *   有 delivered 任务   → blocked  （这是此刻级）
 * 现已拆开（见 `derive.ts` 的 accountState）：**`blocked` 只留给「等你拍板」**，
 * 「账号已停用」走 accountState + 行底色，不再占 presence。
 * ══════════════════════════════════════════════════════════════════
 */
export type PresenceShape = 'filled' | 'hollow' | 'slash'

export const PRESENCE_TONE = {
  busy: { bg: '#15803d', label: '干活中', shape: 'filled' as PresenceShape },
  idle: { bg: '#6b7280', label: '空闲', shape: 'hollow' as PresenceShape },
  blocked: { bg: '#b45309', label: '等你拍板', shape: 'filled' as PresenceShape },
  offline: { bg: '#9ca3af', label: '离线', shape: 'slash' as PresenceShape },
} as const

/**
 * ★ 账号级状态（accountState）—— 与 presence **正交的两轴**
 *
 * 小砚 V1.0 稿 §一之2：「两个『灰』拆成两轴」
 *   · 账号级：在职 / 已停用  → chip + 行底色 + 按钮置灰
 *   · 此刻级：干活中/空闲/等你拍板/离线 → 形状编码
 *
 * ★ 为什么必须两轴：账号停用是「这个人不能用了」（长期），
 *   此刻离线是「这个人现在叫不应」（暂时）。混成一个灰点 = 信息丢失。
 */
export const ACCOUNT_STATE_TONE = {
  active: { label: '在职', chipBg: 'transparent', chipFg: '#6b7280', rowBg: 'transparent' },
  suspended: { label: '已停用', chipBg: '#f3f4f6', chipFg: '#6b7280', rowBg: '#fafafa' },
  revoked: { label: '已退役', chipBg: '#f3f4f6', chipFg: '#9ca3af', rowBg: '#fafafa' },
} as const

export type AccountStateKey = keyof typeof ACCOUNT_STATE_TONE

export type PresenceKey = keyof typeof PRESENCE_TONE

/**
 * ★ 字号 —— 与 083 对齐（正文 13，辅助 12，最低 11）。
 *   083 的取值来自小砚设计稿 §8.4，同族产品不该两套字号。
 */
export const FONT = {
  body: '13px',
  small: '12px',
  tiny: '11px',
  title: '15px',
  h1: '20px',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
} as const
