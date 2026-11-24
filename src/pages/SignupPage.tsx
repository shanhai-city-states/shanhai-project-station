/**
 * SignupPage —— 自助注册入口（2026-11-23）
 * =====================================================================
 * ★★★ 这个页面存在的理由：**没有它，后端那道闸就只对我方自己有用。**
 *   注册端点 `POST /api/signup` 四道闸全实拦（contact/ip/daily/breaker），
 *   但前端没入口 ⇒ 客户拿不到 Key ⇒ 只能我方手工发 —— 四道闸等于白建。
 *
 * ★★ 三条产品纪律（都是本仓踩过的坑的镜像）：
 *
 *   ① **Key 只显示一次，必须让客户「确认已保存」才放行**
 *      库里只有 hash，明文丢了就真找不回来。若只显示不拦，
 *      客户一划走就永远进不来了 —— 那时他会认为「这产品坏了」。
 *      ⇒ 成功态**盖住整个表单**，勾了「我已保存」才给「进入」按钮。
 *
 *   ② **不许把 429 说成「服务异常」**
 *      「今天的名额用完了」和「服务器坏了」是两件事：
 *      前者客户能自己解释（明天再来），后者只会让人反复重试。
 *
 *   ③ **前端做真实格式校验，服务端只做粗校验**
 *      服务端那条 `contact.length > 200` 只是为了挡垃圾流量，
 *      真正的「这看起来像邮箱/手机吗」在客户眼前做 —— 早说一句比晚报 400 好。
 *
 * ★ 成功注册后**自动把 Key 存进 localStorage 并进入主界面**（与 TokenGate 同一套凭据位）。
 *   这不是替客户做决定 —— Key 已经展示了、也强制确认过了，存下他只是省一步粘贴。
 */

import { useState } from 'react'
import { signup } from '../lib/api'
import type { SignupResult } from '../lib/api'
import { T } from '../styles/tokens'

/** 粗判：像邮箱或像手机号。★ 只做「明显不像」的拦截，不做严格 RFC 校验 —— 严格正则误杀真实用户。 */
function looksLikeContact(s: string): boolean {
  const v = s.trim()
  if (v === '') return false
  // 邮箱：有 @ 且 @ 两边都非空，且 @ 后的域名里有点、且不以点开头/结尾
  // ★ 为什么必须判「不以点开头」：`a@.co` 的 tail 是 `.co` —— 含点、非空，
  //   但这是无效域名。这个坑第一版就踩到过（双向测试才暴露）。
  if (v.includes('@')) {
    const at = v.indexOf('@')
    const head = v.slice(0, at)
    const tail = v.slice(at + 1)
    return (
      head.length > 0 &&
      tail.length > 0 &&
      tail.includes('.') &&
      !tail.startsWith('.') &&
      !tail.endsWith('.')
    )
  }
  // 手机号：去掉 +、-、空格后是 7~15 位纯数字
  const digits = v.replace(/[\s+-]/g, '')
  return /^\d{7,15}$/.test(digits)
}

export function SignupPage({
  onDone,
  onBack,
}: {
  /** 注册成功（Key 已存入凭据位）后回调 —— 由 App 接管进主界面 */
  onDone: (token: string) => void
  onBack: () => void
}) {
  const [contact, setContact] = useState('')
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 成功态：★ 非 null 就盖住整个表单（见文件头 ①） */
  const [result, setResult] = useState<SignupResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  const contactOk = looksLikeContact(contact)
  const canSubmit = contactOk && projectName.trim() !== '' && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    const r = await signup({ contact, projectName })
    setBusy(false)
    if (r.ok) {
      setResult(r.data)
      return
    }
    // kind 已在 api.ts 归好类，这里只负责「说人话」
    setErr(r.message)
  }

  async function copyKey() {
    if (result === null) return
    try {
      await navigator.clipboard.writeText(result.ownerKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板被拒（非 https / 权限）⇒ 不报错，客户可以手选
      setCopied(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: T.bg,
        color: T.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: 420, maxWidth: '100%' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>山海 · 项目台</div>

        {/* ════════ 成功态：盖住整个表单 ════════ */}
        {result !== null ? (
          <>
            <div style={{ fontSize: 13, color: T.dim, marginBottom: 16, lineHeight: 1.8 }}>
              注册好了。下面是你的通行证 ——{' '}
              <strong style={{ color: T.text }}>它只显示这一次，我们也不存明文。</strong>
              <br />
              用它可以登录、雇 Agent、看你的项目。
            </div>

            <div
              style={{
                padding: '12px 14px',
                background: T.surface,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 11, color: T.faint, marginBottom: 6 }}>
                通行证（kp_own_ 开头，这是你自己的）
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  lineHeight: 1.7,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                  color: T.text,
                }}
              >
                {result.ownerKey}
              </div>
              <button
                onClick={() => void copyKey()}
                style={{
                  marginTop: 10,
                  padding: '6px 12px',
                  fontSize: 12,
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  background: 'transparent',
                  color: T.dim,
                  cursor: 'pointer',
                }}
              >
                {copied ? '已复制' : '复制'}
              </button>
            </div>

            <div
              style={{
                padding: '10px 12px',
                background: '#fffbe8',
                border: '1px solid #f0e0a0',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.8,
                color: '#8a6d00',
                marginBottom: 14,
              }}
            >
              丢了这串 Key 就找不回来了 —— 我们库里只有它的指纹。请先存到安全的地方
              （密码管理器 / 你自己的笔记），再来往下一步。
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 12.5,
                color: T.text,
                cursor: 'pointer',
                marginBottom: 14,
                lineHeight: 1.7,
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: 3, cursor: 'pointer' }}
              />
              <span>我已把这串通行证保存好了</span>
            </label>

            <button
              onClick={() => onDone(result.ownerKey)}
              disabled={!confirmed}
              style={{
                width: '100%',
                padding: '9px 0',
                fontSize: 13,
                border: 'none',
                borderRadius: 6,
                background: confirmed ? T.accent : T.surfaceSoft,
                color: confirmed ? '#fff' : T.faint,
                cursor: confirmed ? 'pointer' : 'default',
              }}
            >
              进入项目管理
            </button>
          </>
        ) : (
          /* ════════ 表单态 ════════ */
          <>
            <div style={{ fontSize: 13, color: T.dim, marginBottom: 20, lineHeight: 1.8 }}>
              一个项目一张台：需求、拆解、派活、验收，都在台面上。
              <br />
              先留个联系方式，领取你的通行证。
            </div>

            {err !== null && (
              <div
                style={{
                  padding: '8px 12px',
                  background: '#fdf0f0',
                  border: '1px solid #f0c0c0',
                  borderRadius: 6,
                  color: '#b91c1c',
                  fontSize: 12,
                  marginBottom: 12,
                  lineHeight: 1.7,
                }}
              >
                {err}
              </div>
            )}

            <Field label="联系方式（邮箱或手机号）">
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                placeholder="you@example.com"
                autoFocus
                style={inputStyle}
              />
              {contact.trim() !== '' && !contactOk && (
                <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
                  这看起来不像邮箱或手机号，看一眼？
                </div>
              )}
            </Field>

            <Field label="项目名">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                placeholder="我的第一个项目"
                style={inputStyle}
              />
            </Field>

            <button
              onClick={() => void submit()}
              disabled={!canSubmit}
              style={{
                width: '100%',
                padding: '9px 0',
                fontSize: 13,
                border: 'none',
                borderRadius: 6,
                background: canSubmit ? T.accent : T.surfaceSoft,
                color: canSubmit ? '#fff' : T.faint,
                cursor: canSubmit ? 'pointer' : 'default',
                marginTop: 4,
              }}
            >
              {busy ? '领取中…' : '领取通行证'}
            </button>

            <button
              onClick={onBack}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '9px 0',
                fontSize: 13,
                background: 'transparent',
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                color: T.dim,
                cursor: 'pointer',
              }}
            >
              我已有通行证
            </button>

            <div style={{ fontSize: 11, color: T.faint, marginTop: 16, lineHeight: 1.7 }}>
              你的联系方式只以不可逆指纹形式记录，原文不进数据库 ——
              我们只需要知道「你是一个不同的人」，不需要知道你是谁。
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 12px',
  fontSize: 13,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  background: T.surface,
  color: T.text,
  outline: 'none',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}
