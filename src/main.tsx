/**
 * 097 · 入口
 * ★ 为什么不用 React Router：主形态是「左列表 + 右对话」，
 *   切换 Agent 是 state 变化不是页面跳转（与 083 设计稿 §8.1 同口径：
 *   面板内多态用 React state，不写 URL）。
 *   ★ 但独立站需要**能深链**（刷新后还在同一个 Agent）⇒ 用 URL hash 同步 state，
 *     不上路由器。这样刷新不丢位置，又不引入路由库。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/app.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
