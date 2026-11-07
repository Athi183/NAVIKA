// Copies the Ramanujan floor data from the viewer (its single source of truth)
// into this app's public/data. Runs automatically before `npm run dev` and
// `npm run build`; the copies are git-ignored.
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '../../ramanujan-viewer/public/data')
const target = join(here, '../public/data')

if (!existsSync(source)) {
  console.warn(`sync-ramanujan-data: ${source} not found, keeping existing copies`)
  process.exit(0)
}

const entries = readdirSync(source).filter((name) => name.startsWith('Ramanujan_F') || name === 'floor_slab_footprints.json')
for (const name of entries) {
  cpSync(join(source, name), join(target, name), { recursive: true })
}
console.log(`sync-ramanujan-data: copied ${entries.join(', ')}`)
