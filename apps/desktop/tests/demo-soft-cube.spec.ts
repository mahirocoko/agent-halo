import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("Soft Cube uses deterministic form, layered state assets, and target dimensions", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  const pet = page.locator('.session-row .halo-soft-cube[data-state="working"]');
  await expect(pet).toHaveCount(1);
  const initialForm = await pet.getAttribute("data-form");
  expect(["core", "cat-corner", "sprout"]).toContain(initialForm);
  await expect(pet.locator(".halo-soft-cube-body")).toHaveCSS("background-size", "64px 24px");
  await expect(pet.locator(".halo-soft-cube-mote")).toHaveCSS("background-size", "32px 8px");

  const dimensions = await pet.evaluate(async (element) => {
    const body = getComputedStyle(element.querySelector(".halo-soft-cube-body")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const mote = getComputedStyle(element.querySelector(".halo-soft-cube-mote")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const read = async (url: string | undefined) => {
      if (!url) return null;
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    };
    return { body: await read(body), mote: await read(mote) };
  });
  expect(dimensions).toEqual({ body: [32, 12], mote: [16, 4] });

  await page.reload();
  await expect(page.locator(".session-row .halo-soft-cube")).toHaveAttribute("data-form", initialForm ?? "");
});

test("Soft Cube maps attention, done, and error to distinct truthful states", async ({ page }) => {
  for (const scenario of ["attention", "done", "error"] as const) {
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    await page.locator(".session-row-main").click();
    const pet = page.locator(`.session-context-summary .halo-soft-cube[data-state="${scenario}"]`);
    await expect(pet).toBeVisible();
    await expect(pet.locator(".halo-soft-cube-body")).toHaveCSS("background-image", new RegExp(`/halo-soft-cube/body/.+/${scenario}\\.png`));
    await expect(pet.locator(".halo-soft-cube-mote")).toHaveCSS("background-image", new RegExp(`/halo-soft-cube/motes/${scenario}\\.png`));
  }
});

test("done settles on the final frame while reduced motion stays static", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const donePet = page.locator('.session-context-summary .halo-soft-cube[data-state="done"]');
  await expect(donePet.locator(".halo-soft-cube-body")).toHaveCSS("background-position", "-32px 0px");
  await expect(donePet.locator(".halo-soft-cube-mote")).toHaveCSS("background-position", "-8px 0px");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=long-llm");
  const reducedPet = page.locator(".session-row .halo-soft-cube");
  await expect(reducedPet.locator(".halo-soft-cube-body")).toHaveCSS("animation-name", "none");
  await expect(reducedPet.locator(".halo-soft-cube-mote")).toHaveCSS("animation-name", "none");
});
