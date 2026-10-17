// Builds the MV3 extension into extension/dist. Every script is a classic IIFE (content scripts
// can't be modules), so each entry is its own Vite library build.

import { cpSync, mkdirSync, rmSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = resolve(here, 'dist')
const entries = ['background', 'offscreen', 'popup']

rmSync(dist, { recursive: true, force: true })

for (const [i, name] of entries.entries()) {
  await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: i === 0 ? resolve(here, 'public') : false,
    resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: false,
      sourcemap: true,
      lib: {
        entry: resolve(here, 'src', `${name}.ts`),
        formats: ['iife'],
        name: `aegis_${name}`,
        fileName: () => `${name}.js`
      }
    }
  })
}

// Same tokens, fonts and component styles as the app (design-system/).
mkdirSync(resolve(dist, 'ds'), { recursive: true })
cpSync(resolve(root, 'design-system/tokens.css'), resolve(dist, 'ds/tokens.css'))
cpSync(resolve(root, 'design-system/components/bundle.css'), resolve(dist, 'ds/bundle.css'))
cpSync(resolve(root, 'design-system/fonts'), resolve(dist, 'ds/fonts'), { recursive: true })

console.log(`Built extension → ${dist}`)
