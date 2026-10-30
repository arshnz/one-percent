import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The Mac app icon: the iOS icon's rocket on the same ink, but drawn on the
// macOS icon grid — an 824px rounded square centred on a 1024 canvas, with the
// transparent margin the Dock expects — since macOS doesn't mask icons the way
// iOS does. Every size the Mac asks for, from 16pt @1x to 512pt @2x.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dir = resolve(root, 'ios/OnePercent/Resources/Assets.xcassets/AppIconMac.appiconset')
mkdirSync(dir, { recursive: true })

const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#1B1A17"/>
  <g transform="translate(284,284) scale(19)" fill="none" stroke="#ffffff"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
  </g></svg>`

const images = []
for (const pt of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = pt * scale
    const filename = `mac-${pt}@${scale}x.png`
    writeFileSync(resolve(dir, filename), await sharp(Buffer.from(svg), { density: 144 }).resize(px, px).png().toBuffer())
    images.push({ filename, idiom: 'mac', scale: `${scale}x`, size: `${pt}x${pt}` })
  }
}
writeFileSync(resolve(dir, 'Contents.json'), JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n')
console.log('wrote', images.length, 'icons to', dir)
