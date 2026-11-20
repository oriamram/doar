// Draws the app's icon and saves every size of it into public/.
//
// The icon is drawn here, as an SVG: a yellow slip with a few lines of writing, lying a
// little crooked on an airmail-blue card that is lit from the top left (the same light as
// the red card under Doar's envelope). The hidden browser turns it into pictures.
//
//   npm run icons        (in apps/notes)

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, sleep } from '../../../tools/browser.ts'

const PUBLIC = join(import.meta.dirname, '..', 'public')

type Shape = {
  /** The card's rounded corners; 0 when the device cuts the corners itself (maskable, Apple). */
  corner: number
  /** How large the slip is on the card (1 fills about three fifths of it). */
  slip: number
  /** Fine paper grain on the card. Left out of the small vector favicon. */
  grain: boolean
}

function icon({ corner, slip, grain }: Shape): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="light" cx="30%" cy="24%" r="95%">
      <stop offset="0" stop-color="#2f529b"/>
      <stop offset="1" stop-color="#1b3060"/>
    </radialGradient>
    <linearGradient id="paper" x1="0.46" y1="0" x2="0.54" y2="1">
      <stop offset="0" stop-color="#f9ecae"/>
      <stop offset="1" stop-color="#efd87c"/>
    </linearGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="190%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="13"/>
      <feOffset dx="5" dy="17"/>
      <feColorMatrix values="0 0 0 0 0.02  0 0 0 0 0.04  0 0 0 0 0.12  0 0 0 0.6 0"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="card"><rect width="512" height="512" rx="${corner}"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="512" height="512" fill="url(#light)"/>
    ${grain ? '<rect width="512" height="512" filter="url(#grain)" opacity="0.05" style="mix-blend-mode: overlay"/>' : ''}
    <g transform="translate(254 258) rotate(-7) scale(${slip})">
      <g filter="url(#shadow)">
        <path d="M-150-150H150V104A46 46 0 0 1 104 150H-150Z" fill="url(#paper)"/>
      </g>
      <path d="M-150-150H150V104A46 46 0 0 1 104 150H-150Z" fill="none" stroke="#7a6014" stroke-opacity="0.22" stroke-width="2"/>
      <g fill="none" stroke="#33301f" stroke-opacity="0.8" stroke-width="17" stroke-linecap="round">
        <path d="M100-74H-92"/>
        <path d="M100-18H-58"/>
        <path d="M100 38H4"/>
      </g>
    </g>
  </g>
</svg>`
}

const ROUNDED: Shape = { corner: 100, slip: 1, grain: true }
const PICTURES: { file: string; size: number; shape: Shape }[] = [
  { file: 'pwa-64x64.png', size: 64, shape: ROUNDED },
  { file: 'pwa-192x192.png', size: 192, shape: ROUNDED },
  { file: 'pwa-512x512.png', size: 512, shape: ROUNDED },
  { file: 'favicon-48.png', size: 48, shape: ROUNDED },
  // The device cuts these to its own shape, so the card fills the square and the slip keeps to the middle.
  { file: 'maskable-icon-512x512.png', size: 512, shape: { corner: 0, slip: 0.82, grain: true } },
  { file: 'apple-touch-icon-180x180.png', size: 180, shape: { corner: 0, slip: 0.94, grain: true } },
]

writeFileSync(join(PUBLIC, 'favicon.svg'), icon({ ...ROUNDED, grain: false }) + '\n')

const browser = await launch()
try {
  for (const { file, size, shape } of PICTURES) {
    const html = `<!doctype html><html><body style="margin:0;background:transparent">${icon(shape).replace('<svg ', '<svg style="display:block;width:100vw;height:100vh" ')}</body></html>`
    const page = await browser.open(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, { width: size, height: size })
    await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('svg')`)
    await sleep(150)
    // The corners outside the card stay see-through.
    await page.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    const { data } = await page.cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(PUBLIC, file), Buffer.from(data, 'base64'))
    console.log(`${file}  ${size}x${size}`)
    page.close()
  }
} finally {
  await browser.close()
}
