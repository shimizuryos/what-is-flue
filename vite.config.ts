import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// フロントエンド（学習用UI）のビルド設定。
// レッスン本文とサンプルコードは /lessons から ?raw で読み込みます。
export default defineConfig({
  root: 'web',
  plugins: [react()],
  // 実行のたびに .playground/ にファイルが書かれるので、開発サーバーの監視対象から外す
  server: { fs: { allow: ['..'] }, watch: { ignored: ['**/.playground/**'] } },
  // CodeMirror を含むため 1 ファイルが大きめ（ローカル学習用アプリなので分割しない）
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
