import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await (await b.newContext({ storageState: "e2e/.auth/super-admin.json", viewport:{width:1440,height:900} })).newPage();
for (const [path,name] of [["/customers","converted-customers"],["/branches","unconverted-branches"]]) {
  await p.goto("http://localhost:3000"+path, { waitUntil: "networkidle" });
  await p.screenshot({ path: `.look-${name}.png` });
  const bg = await p.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  const h = await p.locator("h1,h2").first();
  console.log(`${name}: heading="${await h.textContent()}" <${await h.evaluate(e=>e.tagName)}> bodyBg=${bg}`);
}
await b.close();
