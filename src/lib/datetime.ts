/**
 * datetime —— 时间显示的唯一出口
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要这个文件（2026-11-23 阿开要求）
 * ══════════════════════════════════════════════════════════════════
 *
 *   「还有建于（创建日期显示到秒）」
 *
 * ★ 后端给的时间**本来就是到微秒的**：
 *     `2026-11-22T15:21:43.920867+00:00`
 *   是前端自己 `slice(0, 10)` 砍成 `2026-11-22` 的。
 *   ⇒ 数据不缺，缺的是显示。这里补的就是那一步。
 *
 * ★★ 为什么不用 `toLocaleString()`
 *   它跟着浏览器语言走 ⇒ 同一个客户换台电脑看到不同格式，
 *   而「几点几分建的」是要跟服务端日志对得上的（排查问题靠它）。
 *   ⇒ 一律手拼 `YYYY-MM-DD HH:mm:ss`，**不受 locale 影响**。
 *
 * ★★★ 为什么统一转当地时间、并明说时区
 *   ISO 里带 `+00:00`（UTC）。如果原样显示本地时间又不标时区，
 *   客户跟服务端日志比对时会差 8 小时，看着像「时间错了」。
 *   ⇒ 显示本地时间，并在需要的地方由调用方标「本机时间」。
 */

/** 补零到 2 位 */
function p2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 完整日期时间：`2026-11-22 23:21:43`（本地时区，到秒）
 *
 * 给「创建于 / 建于」这类**需要精确时刻**的地方用。
 * 解不出返回空串 —— 不显示 `Invalid Date`，那比空白更吓人。
 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    ` ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  )
}

/**
 * 只到日：`2026-11-22`（本地时区）
 *
 * 给「到期日」这类**按天算**的地方用 —— 到期精确到秒没有意义，
 * 反而让客户以为「过了一秒就不能用了」。
 */
export function fmtDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/**
 * 剩多少天（向下取整；负数 = 已过期多少天）
 *
 * ★ 为什么搬到这里（2026-11-24）：原本是 `KeysPage` 里的局部函数，
 *   项目详情页的「通行证续期」也要判「是否进入续期窗口」。
 *   两处各写一份 ⇒ 将来一边改了取整方式，另一边的按钮就会在错误的日子亮起来。
 *   ⇒ 算法只有一处，两个页面共用。
 *
 * ★ 为什么是「日」，不是「小时」：到期是给人看的日子，不是秒表。
 *   剩 23 小时应该叫「今天到期」，而不是「还剩 0 天」的另一种说法。
 */
export function daysLeft(expiresAt: string, now: string): number {
  const ms = Date.parse(expiresAt) - Date.parse(now)
  return Math.floor(ms / 86400000)
}

/** 人话：还剩几天 / 已过期几天 */
export function humanLeft(expiresAt: string, now: string): string {
  const d = daysLeft(expiresAt, now)
  if (d < 0) return `已过期 ${-d} 天`
  if (d === 0) return '今天到期'
  return `还剩 ${d} 天`
}

/**
 * 文件大小：`512 B` / `8.1 KB` / `509.1 KB` / `1.2 MB`
 *
 * ★ 为什么不用「一律显示字节数」：`521317 B` 人脑换算不出来有多大。
 *   客户看交付件，第一个念头是「这东西大不大、要不要等」。
 *
 * ★ 为什么 B 不取整：小于 1KB 的文件本来就小，显示 `0.0 KB` 反而是失真。
 *   （本仓纪律：不许为了好看让读数不准。）
 */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
