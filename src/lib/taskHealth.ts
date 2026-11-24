/**
 * taskHealth.ts —— 任务「卡住」判定（前端唯一出口）
 * =====================================================================
 * ★★ 为什么单独一个文件，不写在页面里：
 *   这个判定会被「任务详情页」「项目详情页列表」「PM 决策面板」多处用到。
 *   写在某一页里，别处必然复制一份 ⇒ 同一语义多处实现 ⇒ 必漂移
 *   （城邦铁律）。所以只留这一个出口。
 *
 * ★★ 阈值必须与后端一致：
 *   后端 `agent-io.ts` 的 `TASK_STALLED_MS` 默认 2 小时（阿开 2026-11-23 拍）。
 *   前端**不自己写一个 2 小时**，而是从后端下发的 `stalledMs` 取；
 *   拿不到时才回落这个常量，并在注释里写明「这是兜底，不是真值」。
 *
 * ★ 语义边界（不许改）：
 *   「卡住」= 需要 PM **看一眼**，不是「该自动收回」。
 *   到点只标黄，**绝不自动改任务归属** —— 改了就是机器替 PM 做决定。
 */

/** 兜底值：与后端 `TASK_STALLED_MS` 默认值一致。★ 后端下发优先。 */
export const DEFAULT_TASK_STALLED_MS = 2 * 60 * 60 * 1000

/** 只有这两种状态才谈得上「卡住」—— 待领/已交/已验收/已取消都不是 */
const STALLABLE_STATUSES = new Set(['running', 'dispatched'])

export interface TaskHealthInput {
  status: string
  /** ISO 时间串（后端 pm_tasks.updated_at） */
  updatedAt?: string | null
}

export interface TaskHealth {
  /** 是否算「卡住」（该标黄让 PM 看见） */
  stalled: boolean
  /** 已经多久没更新（毫秒）；无法计算时为 null */
  idleMs: number | null
  /** 人话时长，如「2 小时 13 分」；无法计算时为空串 */
  idleText: string
}

/**
 * 判一条任务是否卡住。
 *
 * @param task   任务（只要 status + updatedAt）
 * @param nowMs  当前时间（毫秒）—— **由调用方传**，不在这里取 `Date.now()`
 *               ⇒ 这样判据可以喂固定时间做确定性测试，不依赖跑的时刻。
 * @param stalledMs 阈值；不传用兜底值
 */
export function assessTaskHealth(
  task: TaskHealthInput,
  nowMs: number,
  stalledMs: number = DEFAULT_TASK_STALLED_MS,
): TaskHealth {
  if (!STALLABLE_STATUSES.has(task.status)) {
    return { stalled: false, idleMs: null, idleText: '' }
  }
  const t = task.updatedAt ? Date.parse(task.updatedAt) : NaN
  if (Number.isNaN(t)) {
    // ★ 时间解析不出来 ⇒ 不能当成「没卡住」蒙混过去，也不能当成「卡住」冤枉人。
    //   如实返回 null（界面显示「更新时间未知」），让 PM 自己看一眼。
    return { stalled: false, idleMs: null, idleText: '' }
  }
  const idleMs = nowMs - t
  // ★ 未来时间（时钟偏差）不算卡住：负数一律归 0
  const safeIdle = idleMs > 0 ? idleMs : 0
  return {
    stalled: safeIdle >= stalledMs,
    idleMs: safeIdle,
    idleText: humanizeDuration(safeIdle),
  }
}

/** 毫秒 → 「2 小时 13 分」这种人话 */
export function humanizeDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 1) return '不到 1 分钟'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}
