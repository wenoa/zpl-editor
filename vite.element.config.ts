import { defineConfig, mergeConfig } from 'vitest/config'
import app from './vite.config'

// <zplab-editor> as an npm package (web-component/): one ES module with every
// dependency and asset inside, so any bundler or a plain <script type="module"> takes it.
export default mergeConfig(app, defineConfig({
  mode: 'element',
  publicDir: false,
  // Library builds leave process.env alone; React needs it settled.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'web-component/dist',
    emptyOutDir: true,
    lib: { entry: 'src/element.tsx', formats: ['es'], fileName: 'zplab' },
  },
}))
