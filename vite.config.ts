import { defineConfig } from 'vite';

// base 使用相对路径，确保部署到 Qoder Sites 任意子路径时资源都能正确加载
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    // three.js 体积较大，放宽单 chunk 警告阈值（首屏资源整体仍控制在 3MB 红线内）
    chunkSizeWarningLimit: 1500,
  },
});
