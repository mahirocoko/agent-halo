import { expect, test } from "@playwright/test";

test("setup view stays capability-aware in browser demo", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByTitle("Setup").click();

  await expect(page.getByText("Setup")).toBeVisible();
  await expect(page.getByText("Bridge", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo mode")).toBeVisible();
  await expect(page.getByText("Letta mod")).toBeVisible();
  await expect(page.getByText("Tauri runtime needed")).toBeVisible();
  await expect(page.getByText("Open desktop runtime")).toBeVisible();
  await expect(page.getByText("Browser demo cannot install or check the mod")).toBeVisible();
  await expect(page.getByText("Session controls")).toBeVisible();
  await expect(page.getByText("Focus/end unavailable in current bridge")).toBeVisible();
  await expect(page.getByText("Keep display awake")).toBeVisible();
  await expect(page.getByText("Off · display follows macOS idle settings")).toBeVisible();

  await page.getByRole("button", { name: "Enable keep display awake" }).click();
  await expect(page.getByText("Desktop runtime required")).toBeVisible();
  await page.reload();
  await page.getByTitle("Setup").click();
  await expect(page.getByRole("button", { name: "Disable keep display awake" })).toBeVisible();
  await page.getByRole("button", { name: "Disable keep display awake" }).click();

  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Native controls need Tauri runtime")).toBeVisible();

  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByText("Open with pnpm desktop:dev")).toBeVisible();
});
