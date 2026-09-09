import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = resolve(root, 'public')
const icons = resolve(pub, 'icons')
mkdirSync(icons, { recursive: true })

// The in-app brand mark: a white rocket (lucide) centred on the ink square.
const rocket = `
  <g transform="translate(136,136) scale(10)" fill="none" stroke="#ffffff"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
  </g>`

// Rounded for "any"/apple; full-bleed square for maskable (OS applies its mask).
const svgRounded = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#1B1A17"/>${rocket}</svg>`
const svgSquare = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="#1B1A17"/>${rocket}</svg>`

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()

const jobs = [
  ['icons/icon-192.png', svgRounded, 192],
  ['icons/icon-512.png', svgRounded, 512],
  ['icons/maskable-512.png', svgSquare, 512],
  ['apple-touch-icon.png', svgRounded, 180],
  ['favicon-32.png', svgRounded, 32],
]

for (const [rel, svg, size] of jobs) {
  const buf = await png(svg, size)
  writeFileSync(resolve(pub, rel), buf)
  console.log('wrote', rel, `(${size})`)
}
writeFileSync(resolve(pub, 'favicon.svg'), svgRounded)
console.log('wrote favicon.svg')
