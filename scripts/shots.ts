/** Screenshots out/*.html into docs/screens/*.png at 1440 wide, full page. Needs `pnpm render` first. */
import { readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const out = fileURLToPath(new URL('../out/', import.meta.url))
const dest = fileURLToPath(new URL('../docs/screens/', import.meta.url))
mkdirSync(dest, { recursive: true })
const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  for (const f of readdirSync(out).filter((x) => x.endsWith('.html')).sort()) {
    await page.goto(`file://${out}${f}`, { waitUntil: 'networkidle0' })
    // Three web fonts: shoot only once they have loaded, or the PNG shows the fallback faces.
    await page.evaluate('document.fonts.ready')
    const png = `${dest}${f.replace(/\.html$/, '.png')}`
    await page.screenshot({ path: png as `${string}.png`, fullPage: true })
    console.log(png)
  }
} finally {
  await browser.close()
}
