const { chromium } = require("playwright");

const baseUrl = "http://localhost:3000";

async function gotoApp(page, path, readySelector) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySelector, { timeout: 30000 });
  await page.waitForTimeout(700);
}

const shots = [
  ["pipelines", async (page) => gotoApp(page, "/pipelines", ".flow-shell")],
  [
    "tekton",
    async (page) => {
      await gotoApp(page, "/pipelines", ".flow-shell");
      await page.locator("button.flow-nav-item").filter({ hasText: "Tekton 控制面" }).click();
      await page.waitForSelector(".flow-workspace-grid, .tekton-components-panel", { timeout: 10000 });
      await page.waitForTimeout(500);
    },
  ],
  [
    "artifacts",
    async (page) => {
      await gotoApp(page, "/pipelines", ".flow-shell");
      await page.locator("button.flow-nav-item").filter({ hasText: "制品与镜像" }).click();
      await page.waitForSelector(".artifact-center-page", { timeout: 10000 });
      await page.waitForTimeout(500);
    },
  ],
  ["run-detail", async (page) => gotoApp(page, "/runs/run-1", ".run-detail-page")],
  ["pipeline-edit", async (page) => gotoApp(page, "/pipelines/pipe-custom-1/edit", ".pipeline-config-page")],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 900 }, deviceScaleFactor: 1 });
    for (const [name, prepare] of shots) {
      await prepare(page);
      await page.screenshot({ path: `.codex-tmp/visual-audit-${name}.png`, fullPage: true });
      console.log(`captured ${name}`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
