// Counter-only fatigue and searchable libraries/panels in the disposable world.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1600, height: 1100}}); page.setDefaultTimeout(12000);
const id = "swade-better-effects", prefix = `Fatigue HUD ${Date.now()}`, shots = process.env.FOUNDRY_QA_SCREENSHOTS, errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && /swade-better-effects|swade-hud/.test(m.text())) errors.push(m.text()); });
const pass = text => console.log(`PASS ${text}`);
async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications{pointer-events:none!important}"});
}
async function penalties() {
  return page.evaluate(async () => {
    const {default: CharRoll} = await import("/modules/swade-tools/scripts/class/CharRoll.js");
    const roll = new CharRoll(fh.actor); roll.baseModifiers();
    const mods = fh.actor.getTraitRollModifiers({modifier: 0}, {});
    return {fatigue: fh.actor.calcFatiguePenalties(), counter: fh.actor.system.fatigue.value, source: fh.actor._source.system.fatigue.value,
      wounds: mods.find(m => m.label === game.i18n.localize("SWADE.Wounds"))?.value,
      toolsFatigue: roll.reasons.filter(reason => reason.startsWith(game.i18n.localize("SWADE.Fatigue") + ":")),
      toolsWounds: roll.reasons.filter(reason => reason.startsWith(game.i18n.localize("SWADE.Wounds") + ":"))};
  });
}
async function openPanel(key) {
  await page.evaluate(key => { fh.hud.closeSidebar(); fh.hud.activeSidebar = key; fh.hud.render(); }, key);
  const panel = page.locator("#swade-hud-sidebar"); await panel.waitFor();
  await page.keyboard.press("f"); await panel.locator('input[type="text"]').waitFor(); return panel;
}
async function counter(key) { return page.evaluate(key => key === "bennies" ? fh.actor.system.bennies.value : fh.actor.system.powerPoints.general.value, key); }
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready();
  await page.evaluate(async id => {
    await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-hud": true, "swade-tools": true});
    await game.settings.set("core", "noCanvas", false);
  }, id);
  await page.reload(); await ready();
  await page.evaluate(async ({id, prefix}) => {
    await game.settings.set("swade-tools", "noWoundFatigueIcon", true);
    globalThis.fh = {api: game.modules.get(id).api, hud: game.modules.get("swade-hud").api};
    fh.actor = await Actor.create({name: prefix, type: "character", system: {fatigue: {value: 2}, wounds: {value: 1}, bennies: {value: 3}, powerPoints: {general: {value: 6, max: 10}}}, items: [
      {name: "Fire Sword", type: "weapon", system: {damage: "1d8"}}, {name: "Ice Spear", type: "weapon"},
      {name: "Travel Pack", type: "gear"}, {name: "Fire Bolt", type: "power", system: {damage: "2d6"}},
      {name: "Ice Jet", type: "power", system: {damage: "1d6"}},
      {name: "Fighting", type: "skill", system: {swid: "fighting", attribute: "agility"}}, {name: "Notice", type: "skill", system: {swid: "notice", attribute: "smarts"}},
      {name: "Dodge", type: "edge"}, {name: "Onslaught", type: "edge"}, {name: "Clumsy", type: "hindrance"}
    ]});
    const scene = await Scene.create({name: prefix, active: true, width: 1200, height: 900, padding: 0,
      tokens: [{name: prefix, actorId: fh.actor.id, actorLink: true, x: 200, y: 200}]}); await scene.view();
  }, {id, prefix});
  await page.waitForFunction(() => canvas.ready && canvas.tokens?.placeables.some(t => t.actor?.id === fh.actor.id));
  await page.evaluate(() => { fh.token = canvas.tokens.placeables.find(t => t.actor?.id === fh.actor.id); fh.token.control({releaseOthers: true}); });
  await page.locator("#swade-hud-persistent").waitFor();
  assert.equal(await page.locator('#swade-hud-persistent [data-panel="shortcuts"] .shortcut.empty').count(), 18);
  assert.equal(await page.evaluate(() => fh.hud.shortcuts().every(slot => slot === null)), true);
  pass("a newly created actor has an empty shortcut grid despite owning weapons and powers");
  await page.evaluate(async () => { await fh.hud.setShortcut(0, {type: "Item", uuid: fh.actor.items.getName("Fire Sword").uuid}); fh.hud.render(); });
  assert.equal(await page.locator('#swade-hud-persistent [data-panel="shortcuts"] .shortcut.item').count(), 1);
  assert.equal(await page.evaluate(() => fh.actor.effects.size), 0);
  let result = await penalties(); assert.equal(result.fatigue, -2); assert.deepEqual(result.toolsFatigue, ["Fatigue: -2"]);
  await page.evaluate(async () => { [fh.drink] = await fh.actor.createEmbeddedDocuments("ActiveEffect", [{name: "Energy Drink", system: {changes: [{key: "sbe.modifyFlag", type: "subtract", value: "fatigue", phase: "initial"}]}}]); });
  result = await penalties(); assert.deepEqual(result, {fatigue: 0, counter: 2, source: 2, wounds: -1, toolsFatigue: [], toolsWounds: ["Wounds: -1"]});
  await page.evaluate(() => { fh.pending = fh.actor.rollAttribute("agility"); }); await page.locator(".roll-dialog").waitFor();
  assert.equal(await page.evaluate(() => [...foundry.applications.instances.values()].find(app => app.element?.classList.contains("roll-dialog")).modifiers.some(m => m.label === game.i18n.localize("SWADE.Fatigue") && Number(m.value) < 0)), false);
  await page.evaluate(async () => { await [...foundry.applications.instances.values()].find(app => app.element?.classList.contains("roll-dialog")).close(); await fh.pending; });
  await page.evaluate(() => fh.drink.update({disabled: true})); result = await penalties(); assert.equal(result.fatigue, -2); assert.deepEqual(result.toolsFatigue, ["Fatigue: -2"]);
  await page.evaluate(async () => { await fh.drink.update({disabled: false}); [fh.antidote] = await fh.actor.createEmbeddedDocuments("ActiveEffect", [{name: "Antidote", system: {changes: [{key: "sbe.modifyFlag", type: "subtract", value: "energy-drink", phase: "initial"}]}}]); });
  assert.equal((await penalties()).fatigue, -2); await page.evaluate(() => fh.antidote.delete()); assert.equal((await penalties()).fatigue, 0);
  pass("Suppress fatigue removes counter penalties in native dialogs and SWADE Tools, preserves wounds/counters, and restores fatigue when its source is disabled or suppressed");

  await page.evaluate(async () => {
    const {rememberFlags} = await import("/modules/swade-better-effects/scripts/flags.mjs"); await rememberFlags([]);
    await game.settings.set("swade-better-effects", "flagLibrary", ["persist-alpha", "persist-beta", "fire-ward"]); fh.api.openFlagLibrary();
  });
  let library = page.locator("#sbe-flag-library"); await library.waitFor();
  await library.getByLabel("Search flags", {exact: true}).fill("FIRE ward");
  assert.deepEqual(await library.locator('[data-library-flag]:not([hidden]) > span').allTextContents(), ["fire-ward"]);
  await library.getByLabel("Search flags", {exact: true}).fill("persist-alpha"); await library.getByRole("button", {name: "Remove persist-alpha", exact: true}).click();
  await library.getByLabel("New flags", {exact: true}).fill("Spark Form"); await library.getByLabel("New flags", {exact: true}).press("Enter");
  await library.getByLabel("Search flags", {exact: true}).fill("spark");
  await library.locator('[data-library-flag="spark-form"]:not([hidden])').waitFor();
  if (shots) await library.screenshot({path: `${shots}/flag-library-search.png`, animations: "disabled"});
  await library.getByRole("button", {name: "Save library", exact: true}).click(); await library.waitFor({state: "hidden"});
  const stored = await page.evaluate(() => game.settings.get("swade-better-effects", "flagLibrary"));
  assert.ok(stored.includes("spark-form") && stored.includes("persist-beta") && stored.includes("fire-ward") && !stored.includes("persist-alpha"));
  pass("flag library search normalizes names, supports adding/removing matches, and preserves hidden entries on save");

  const hud = page.locator("#swade-hud-persistent");
  assert.equal(await hud.locator('[data-panel="resources"] .fa-caret-left,[data-panel="resources"] .fa-caret-right,[data-panel="shortcuts-menu"] .fa-caret-left,[data-panel="shortcuts-menu"] .fa-caret-right').count(), 0);
  for (const key of ["bennies", "powerPoints"]) {
    const initial = await counter(key), row = hud.locator(`[data-panel="resources"] [data-section="${key}"]`);
    await row.locator(".resource-icon").click(); await page.waitForFunction(({key, value}) => (key === "bennies" ? fh.actor.system.bennies.value : fh.actor.system.powerPoints.general.value) === value, {key, value: initial + 1});
    await row.locator(".resource-value").click({button: "right"}); await page.waitForFunction(({key, value}) => (key === "bennies" ? fh.actor.system.bennies.value : fh.actor.system.powerPoints.general.value) === value, {key, value: initial});
    await row.locator(".resource-value").click(); await page.waitForFunction(({key, value}) => (key === "bennies" ? fh.actor.system.bennies.value : fh.actor.system.powerPoints.general.value) === value, {key, value: initial + 1});
    await row.locator(".resource-icon").click({button: "right"}); await page.waitForFunction(({key, value}) => (key === "bennies" ? fh.actor.system.bennies.value : fh.actor.system.powerPoints.general.value) === value, {key, value: initial});
  }
  await hud.locator(".shortcut-page-icon").click(); await page.waitForFunction(() => fh.hud.page === 1);
  assert.equal(await hud.locator('[data-panel="shortcuts"] .shortcut.empty').count(), 18);
  await hud.locator('[data-action="shortcut-page"].value').click({button: "right"}); await page.waitForFunction(() => fh.hud.page === 0);
  assert.equal(await hud.locator('[data-panel="shortcuts"] .shortcut.item').count(), 1);
  await hud.locator('[data-action="shortcut-page"].value').click(); await page.waitForFunction(() => fh.hud.page === 1);
  await hud.locator(".shortcut-page-icon").click({button: "right"}); await page.waitForFunction(() => fh.hud.page === 0);
  await hud.locator(".shortcut-page-icon").click({button: "right"}); assert.equal(await page.evaluate(() => fh.hud.page), 0);
  if (shots) await hud.screenshot({path: `${shots}/hud-no-resource-arrows.png`, animations: "disabled"});
  pass("saved manual shortcuts survive page changes while new pages stay empty");
  pass("Benny/PP arrows are absent and both icon/number gestures still work; shortcut icon and number support LMB-next/RMB-previous within page bounds");
  for (const [key, query, expected] of [["actions", "fire", "Fire Sword"], ["items", "travel", "Travel Pack"], ["spells", "fire", "Fire Bolt"], ["skills", "fight", "Fighting"], ["feats", "dodge", "Dodge"], ["extras", "energy", "Energy Drink"]]) {
    const sidebar = await openPanel(key); await sidebar.locator('input[type="text"]').fill(query);
    const entries = await sidebar.locator("[data-filter-value]").evaluateAll(rows => rows.map(row => ({name: row.dataset.filterValue, hidden: getComputedStyle(row).display === "none", highlight: row.classList.contains("filtered")})));
    assert.ok(entries.some(e => e.name === expected.toLowerCase() && !e.hidden));
    assert.ok(entries.every(e => e.hidden === !e.name.includes(query) && !e.highlight));
    if (key === "spells") assert.equal(await sidebar.locator('.variants[data-filter-value="ice jet"]').evaluate(el => getComputedStyle(el).display), "none");
    if (key === "extras") {
      assert.equal(await sidebar.locator(".system-effect-list").isVisible(), false);
      await sidebar.locator('input[type="text"]').fill("shaken"); assert.equal(await sidebar.locator(".actor-effect-list").isVisible(), false);
      assert.equal(await sidebar.locator(".system-effect-list").isVisible(), true);
    }
    await sidebar.locator('input[type="text"]').fill("zz-no-match"); await sidebar.locator(".search-empty").waitFor();
    assert.equal(await sidebar.locator("header:not([hidden])").count(), 0);
    await sidebar.locator('input[type="text"]').fill(""); assert.equal(await sidebar.locator("[data-filter-value][hidden]").count(), 0);
  }
  pass("all six HUD panels hide unmatched rows, power action controls, empty headers and effect columns; clearing search restores the full list");
  const sidebar = await openPanel("actions"); await sidebar.locator('input[type="text"]').fill("fire");
  if (shots) await sidebar.screenshot({path: `${shots}/hud-filter-only-matches.png`, animations: "disabled"});
  assert.deepEqual(errors, []); pass("no browser JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors);
  if (shots) await page.screenshot({path: `${shots}/fatigue-hud-failure.png`}).catch(() => {});
  throw error;
} finally { await browser.close(); }
