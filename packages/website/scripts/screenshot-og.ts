import { type ChildProcess, spawn } from "node:child_process"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "playwright"

const PORT = 4399
const URL = `http://localhost:${PORT}/og`
const OUTPUT = "public/og.png"
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

let server: ChildProcess | null = null

async function waitForServer(url: string, timeout = 15_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Ignore connection failures while the dev server starts.
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Server did not start within ${timeout}ms`)
}

try {
  console.log("Starting dev server...")
  server = spawn("bunx", ["astro", "dev", "--port", String(PORT)], {
    stdio: "pipe",
    cwd: `${SCRIPT_DIR}/..`,
  })

  await waitForServer(URL)
  console.log("Server ready, taking screenshot...")

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(URL, { waitUntil: "networkidle" })

  // Wait for graph SVG to render and fonts to load
  await page.waitForSelector("[data-graph-ready]", { timeout: 5000 }).catch(() => {
    // Fall back to a timed wait when the graph marker never appears.
  })
  await page.waitForTimeout(800)

  await page.screenshot({ path: OUTPUT, type: "png" })
  await browser.close()

  console.log(`Screenshot saved to ${OUTPUT}`)
} finally {
  server?.kill()
}
