const { chromium } = require("playwright");

const baseUrl = "http://localhost:3000";

async function capture(page, path, readySelector, name) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySelector, { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `.codex-tmp/visual-audit-mobile-${name}.png`, fullPage: true });
  console.log(`captured mobile ${name}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await capture(page, "/pipelines", ".flow-shell", "pipelines");
    await capture(page, "/runs/run-1", ".run-detail-page", "run-detail");
    await capture(page, "/pipelines/pipe-custom-1/edit", ".pipeline-config-page", "pipeline-edit");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
