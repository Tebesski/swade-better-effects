// Actor preparation, native status effects, timed suppression, and both editors.
// Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}}); page.setDefaultTimeout(12000);
const id = "swade-better-effects", prefix = `Effect flags ${Date.now()}`, shots = process.env.FOUNDRY_QA_SCREENSHOTS, errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && m.text().includes(id)) errors.push(m.text()); });
const pass = text => console.log(`PASS ${text}`);
async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications{pointer-events:none!important}"});
}
async function wizard(effect) {
  await page.evaluate(name => ef.api.openAegis(ef.actor, name ? ef.actor.effects.getName(name) : undefined), effect);
  const app = page.locator(".sbe-aegis"); await app.waitFor();
  assert.equal(await app.locator("details[open]").count(), 0);
  return app;
}
async function save(app) { await app.locator('button[type="submit"]').click(); await app.waitFor({state: "hidden"}); }
async function state() {
  return page.evaluate(() => ({toughness: ef.actor.system.stats.toughness.value, distracted: ef.actor.system.status.isDistracted,
    fatigueActive: ef.fatigue.active, suppressed: ef.fatigue.isSuppressed, disabled: ef.fatigue.disabled,
    sourceDisabled: ef.fatigue._source.disabled, flags: ef.api.getFlags(ef.actor)}));
}
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready();
  await page.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true}); await game.settings.set("core", "noCanvas", true); }, id);
  await page.reload(); await ready();
  await page.evaluate(async ({id, prefix}) => {
    globalThis.ef = {api: game.modules.get(id).api};
    ef.actor = await Actor.create({name: prefix, type: "character", system: {attributes: {vigor: {die: {sides: 8}}}}, flags: {[id]: {tags: ["elf", "fatigue"]}}});
  }, {id, prefix});
  let app = await wizard();
  await app.locator('[name="name"]').fill("Fatigue");
  const flags = app.getByLabel("Effect flags", {exact: true}); assert.equal(await flags.inputValue(), "fatigue");
  const layout = await app.evaluate(el => {
    const name = el.querySelector('[name="name"]').getBoundingClientRect(), flags = el.querySelector('[name="sbe.effectTags"]').getBoundingClientRect();
    return {below: flags.top >= name.bottom, width: flags.width, overflow: el.querySelector(".main-grid").scrollWidth - el.querySelector(".main-grid").clientWidth};
  });
  assert.ok(layout.below && layout.width > 300 && layout.overflow <= 1);
  await flags.fill("fatigue, Tired"); await flags.press("Tab");
  await app.locator('[data-category="derived"] > summary').click(); await app.locator('[data-key="system.stats.toughness.value"]').click();
  await app.locator("input.value").fill("-2"); await save(app);
  await page.evaluate(async () => { ef.fatigue = ef.actor.effects.getName("Fatigue"); await ef.fatigue.update({statuses: ["distracted"]}); });
  assert.deepEqual(await state(), {toughness: 4, distracted: true, fatigueActive: true, suppressed: false, disabled: false, sourceDisabled: false, flags: ["elf", "fatigue", "size0", "tired"]});
  assert.equal(await page.evaluate(id => ef.fatigue.getFlag(id, "nameFlag"), id), "fatigue");
  pass("effect Flags sits below Name, normalizes custom flags, and automatically supplies its active flags to the actor");
  app = await wizard(); await app.locator('[name="name"]').fill("Energy Drink");
  await app.getByLabel("Effect flags", {exact: true}).fill("energy-drink, Energised"); await app.getByLabel("Effect flags", {exact: true}).press("Tab");
  assert.deepEqual(await app.locator('[name="duration.units"] option').allTextContents(), ["Rounds", "Minutes", "Hours"]);
  assert.equal(await app.locator(".turns label").textContent(), "Duration");
  await app.locator('[name="duration.value"]').fill("1"); await app.getByLabel("Duration unit", {exact: true}).selectOption("minutes");
  await app.locator('[name="duration.expiry"]').selectOption("turnStart");
  await app.locator('[data-category="other"] > summary').click(); await app.getByRole("button", {name: "Add flag rule", exact: true}).click();
  assert.deepEqual(await app.locator(".sbe-change select.type option").allTextContents(), ["Add", "Suppress"]);
  await app.locator(".sbe-change select.type").selectOption("subtract");
  await app.getByLabel("Flag name", {exact: true}).fill("Fatigue"); await app.getByLabel("Flag name", {exact: true}).press("Tab");
  const controlFit = await app.evaluate(el => ['[name="duration.units"]', '.sbe-flag-change select.type'].map(selector => {
    const select = el.querySelector(selector), style = getComputedStyle(select), ctx = document.createElement("canvas").getContext("2d");
    ctx.font = style.font;
    return select.clientWidth >= ctx.measureText(select.selectedOptions[0].textContent).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 24;
  }));
  assert.deepEqual(controlFit, [true, true]);
  if (shots) await app.screenshot({path: `${shots}/effect-flags-duration-suppress.png`, animations: "disabled"});
  await save(app); await page.evaluate(() => { ef.drink = ef.actor.effects.getName("Energy Drink"); });
  assert.deepEqual(await state(), {toughness: 6, distracted: false, fatigueActive: false, suppressed: true, disabled: false, sourceDisabled: false, flags: ["elf", "energised", "energy-drink", "size0"]});
  pass("Suppress fatigue suspends native modifiers and statuses as well as inherited/custom flags, preserving the source effect's disabled state");
  app = await wizard("Energy Drink");
  assert.equal(await app.locator('[name="duration.value"]').inputValue(), "1"); assert.equal(await app.getByLabel("Duration unit", {exact: true}).inputValue(), "minutes");
  await app.getByLabel("Duration unit", {exact: true}).selectOption("hours"); await app.locator('[name="duration.value"]').fill("2"); await save(app);
  assert.deepEqual(await page.evaluate(() => ({value: ef.drink.duration.value, units: ef.drink.duration.units})), {value: 2, units: "hours"});
  app = await wizard("Energy Drink"); await app.getByLabel("Duration unit", {exact: true}).selectOption("minutes"); await app.locator('[name="duration.value"]').fill("1"); await save(app);
  await page.evaluate(() => ef.drink.update({disabled: true}));
  assert.equal((await state()).toughness, 4); assert.equal((await state()).distracted, true); assert.ok((await state()).flags.includes("tired")); assert.ok(!(await state()).flags.includes("energy-drink"));
  await page.evaluate(() => ef.drink.update({disabled: false})); assert.equal((await state()).toughness, 6);
  await page.evaluate(() => game.time.advance(61));
  await page.waitForFunction(() => !ef.actor.effects.getName("Energy Drink")?.active, null, {timeout: 20000});
  assert.equal((await state()).toughness, 4); assert.equal((await state()).distracted, true); assert.ok((await state()).flags.includes("tired"));
  pass("rounds/minutes/hours persist through editing; disabling or timing out the drink restores the original effect automatically");
  app = await wizard("Fatigue"); await app.locator('[name="name"]').fill("Heavy Fatigue");
  assert.equal(await app.getByLabel("Effect flags", {exact: true}).inputValue(), "heavy-fatigue, tired");
  await save(app); assert.equal(await page.evaluate(id => ef.fatigue.getFlag(id, "nameFlag"), id), "heavy-fatigue");
  await page.evaluate(() => ef.fatigue.sheet.render({force: true}));
  const manual = page.locator(".active-effect-config"); await manual.waitFor();
  const manualFlags = manual.locator(".sbe-tags-field input"); assert.equal(await manualFlags.inputValue(), "heavy-fatigue, tired");
  const manualLayout = await manual.evaluate(el => ({name: el.querySelector('[name="name"]').getBoundingClientRect().bottom, flags: el.querySelector(".sbe-tags-field").getBoundingClientRect().top}));
  assert.ok(manualLayout.flags >= manualLayout.name);
  await manualFlags.fill("heavy-fatigue, tired, Lasting"); await manualFlags.press("Tab");
  await page.waitForFunction(() => ef.api.getFlags(ef.actor).includes("lasting"));
  if (shots) await manual.screenshot({path: `${shots}/manual-effect-flags.png`, animations: "disabled"});
  await page.evaluate(() => ef.fatigue.sheet.close()); pass("effect renames replace the generated flag and the manual editor exposes the same Flags field below Name");
  await page.evaluate(async () => { await ef.actor.toggleActiveEffect("shaken", {active: true}); await ef.actor.toggleActiveEffect("vulnerable", {active: true}); });
  const systemEffects = await page.evaluate(id => ["shaken", "vulnerable"].map(status => {
    const effect = ef.actor.effects.find(e => e.statuses.has(status)), flag = ef.api.normalizeFlag(effect.name);
    return {name: effect.name, flag, stored: effect.getFlag(id, "nameFlag"), own: ef.api.getFlags(effect).includes(flag), inherited: ef.api.getFlags(ef.actor).includes(flag)};
  }), id);
  assert.ok(systemEffects.every(e => e.flag === e.stored && e.own && e.inherited));
  pass("native SWADE status effects receive and inherit their generated flags when applied");
  await page.evaluate(async id => {
    [ef.gear] = await ef.actor.createEmbeddedDocuments("Item", [{name: "Heavy pack", type: "gear", system: {equipStatus: 3}, effects: [
      {name: "Pack Burden", transfer: true, flags: {[id]: {tags: ["burden"]}}, system: {changes: [{key: "system.stats.toughness.value", type: "add", value: "-1", phase: "initial"}]}}
    ]}]);
    ef.gearEffect = ef.gear.effects.contents[0];
    [ef.suppressor] = await ef.actor.createEmbeddedDocuments("ActiveEffect", [{name: "Strength Tonic", system: {changes: [{key: "sbe.modifyFlag", type: "subtract", value: "burden", phase: "initial"}]}}]);
  }, id);
  assert.equal(await page.evaluate(() => ef.gearEffect.active), false); assert.equal(await page.evaluate(() => ef.gearEffect.disabled), false);
  await page.evaluate(() => ef.suppressor.delete()); assert.equal(await page.evaluate(() => ef.gearEffect.active), true);
  const sheetId = await page.evaluate(async () => {
    await ef.actor.sheet.render({force: true});
    return ef.actor.sheet.id;
  });
  const actorSheet = page.locator(`#${sheetId}`);
  await actorSheet.locator('[data-action="tab"][data-tab="effects"]').click();
  const gearEffectId = await page.evaluate(() => ef.gearEffect.id);
  await actorSheet.locator(`[data-effect-id="${gearEffectId}"] [data-action="openEffect"]`).click();
  await page.getByRole("dialog").filter({hasText: "Edit Effect: Pack Burden"}).getByRole("button", {name: "Effect builder"}).click();
  assert.equal(await page.locator('.sbe-aegis [name="name"]').inputValue(), "Pack Burden");
  await page.locator('.sbe-aegis [data-action="close"]').first().click();
  await page.evaluate(() => ef.actor.sheet.close());
  await page.evaluate(async () => { await ef.actor.toggleActiveEffect("shaken", {active: false}); await ef.actor.toggleActiveEffect("vulnerable", {active: false}); await ef.gear.delete(); });
  pass("actor-local suppression also suspends and restores transferring item effects");
  const libraryFlags = await page.evaluate(async id => {
    const template = await Item.create({name: "Ward Template", type: `${id}.effect`, effects: [
      {name: "Fire Ward", transfer: false, flags: {[id]: {tags: ["resistant"]}}, system: {changes: []}}
    ]});
    const other = await Actor.create({name: "Ward recipient", type: "npc"});
    const [applied] = await ef.api.applyEffectTemplate(template, other);
    const active = ef.api.getFlags(other), own = ef.api.getFlags(applied), persisted = applied.getFlag(id, "nameFlag");
    await applied.update({disabled: true}); const inactive = ef.api.getFlags(other);
    await other.delete(); await template.delete();
    return {active, own, persisted, inactive};
  }, id);
  assert.deepEqual(libraryFlags, {active: ["fire-ward", "resistant", "size0"], own: ["fire-ward", "resistant"], persisted: "fire-ward", inactive: ["size0"]});
  pass("library templates retain own flags when applied and inheritance ends when the actor copy is disabled");
  await page.reload(); await ready();
  await page.evaluate(({id, prefix}) => { globalThis.ef = {api: game.modules.get(id).api, actor: game.actors.getName(prefix)}; ef.fatigue = ef.actor.effects.getName("Heavy Fatigue"); }, {id, prefix});
  assert.ok((await state()).flags.includes("heavy-fatigue")); assert.ok((await state()).flags.includes("lasting")); assert.equal((await state()).toughness, 4);
  assert.deepEqual(errors, []); pass("effect flags and restored native values survive reload without JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors);
  if (shots) await page.screenshot({path: `${shots}/effect-flags-failure.png`}).catch(() => {});
  throw error;
} finally { await browser.close(); }
