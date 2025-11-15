import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { sveltePreprocess } from 'svelte-preprocess'
import tailwindcss from '@tailwindcss/vite'

const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [svelte({ preprocess: sveltePreprocess() }), tailwindcss()],
  server: {
    port: 3000,
    hmr: {
      overlay: false
    }
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        format: 'es'
      }
    }
  }
})
