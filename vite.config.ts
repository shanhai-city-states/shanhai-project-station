import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 097 · 山海 PM Agent · 前端构建配置
 *
 * ★ 开发期代理：/api → 你的后端服务地址（见下）
 *   生产期由反向代理（Nginx 等）把 /api 转到后端。
 *   ⇒ 前端代码里**一律写相对路径 /api/xxx**，不写死域名。
 *     否则开发/生产两套地址，迟早有一边写错。
 *
 *   ★ 开发期代理目标由环境变量 `VITE_DEV_API_TARGET` 给出，**不写死任何主机/端口**。
 *     部署方按自己的后端地址配置；未设置时只提示、不给默认内网地址。
 *     （最初写死过本机端口，改为可配置。）
 */
const devApiTarget = process.env.VITE_DEV_API_TARGET

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: devApiTarget
      ? {
          '/api': {
            target: devApiTarget,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // ★ 不生成 hash 以外的多余产物；dist 由部署脚本同步到静态站点目录
    emptyOutDir: true,
  },
})
