// Run only against the disposable effects-qa world. See README for Playwright setup.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const id = "swade-better-effects";
const itemName = `Native A.E.G.I.S. Comparison ${Date.now()}`;
const screenshotDirectory = process.env.FOUNDRY_QA_SCREENSHOTS;
const pass = message => console.log(`PASS ${message}`);

async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 30000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa", "Refusing a non-test world");
  await page.addStyleTag({content: "#notifications {visibility:hidden!important}"});
}
async function geometry() {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const root = document.querySelector(".active-effect-wizard");
    await Promise.all([...root.querySelectorAll("img")].map(img => img.decode().catch(() => {})));
    const origin = root.getBoundingClientRect();
    const box = selector => {
      const rect = root.querySelector(selector).getBoundingClientRect();
      return {x: Math.round(rect.x - origin.x), y: Math.round(rect.y - origin.y), width: Math.round(rect.width), height: Math.round(rect.height)};
    };
    return {title: root.querySelector(".window-title").textContent, size: {width: Math.round(origin.width), height: Math.round(origin.height)},
      grid: getComputedStyle(root.querySelector(".main-grid")).gridTemplateColumns,
      basics: box(".effect-basics"), name: box(".effect-basics .name"), rounds: box(".effect-basics .turns"), expiration: box(".effect-basics .behavior"),
      preview: box(".preview"), presets: box(".presets"),
      categories: [...root.querySelectorAll(".presets > details")].map(details => ({category: details.dataset.category,
        label: details.querySelector("summary").textContent.trim(), buttons: [...details.querySelectorAll("button")].map(b => b.textContent.trim())})),
      fields: [...root.querySelectorAll(".effect-basics input,.effect-basics select")].map(input => input.name),
      conditional: !!root.querySelector('[name="system.conditionalEffect"]')};
  });
}

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready();
  await page.evaluate(async id => {
    if (game.settings.settings.has("core.noCanvas")) await game.settings.set("core", "noCanvas", true);
    await game.settings.set("core", "moduleConfiguration", {[id]: false, "swade-targeted-damage": true});
  }, id);
  await page.reload(); await ready();
  await page.evaluate(async name => {
    globalThis.layoutItem = await Item.create({name, type: "ability"});
    await new game.swade.apps.ActiveEffectWizard({document: layoutItem}).render({force: true});
  }, itemName);
  const native = await geometry();
  if (screenshotDirectory) await page.screenshot({path: `${screenshotDirectory}/native.png`, animations: "disabled"});
  pass("captured original SWADE A.E.G.I.S.");
  await page.evaluate(id => game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-targeted-damage": true}), id);
  await page.reload(); await ready();
  await page.evaluate(name => {
    globalThis.layoutItem = game.items.getName(name);
    globalThis.layoutEditor = game.modules.get("swade-better-effects").api.openAegis(layoutItem);
  }, itemName);
  await page.locator(".sbe-aegis .preview").waitFor();
  const modified = await geometry();
  assert.equal(modified.title, native.title);
  assert.deepEqual(modified.size, {width: 680, height: 660});
  assert.ok(modified.size.width < native.size.width && modified.size.height < native.size.height);
  assert.deepEqual(modified.fields, native.fields);
  assert.equal(modified.conditional, native.conditional);
  assert.ok(modified.basics.height < native.basics.height, "Basics use less vertical space");
  assert.ok(modified.presets.width <= native.presets.width * .70, "Changes keeps the narrowed column");
  assert.ok(modified.preview.width > native.preview.width, "Preview uses the freed space");
  assert.equal(await page.locator(".sbe-damage-rules, [data-action=addRule]").count(), 0);
  pass("native layout and fields remain in a narrower window; controls are compact and Damage rules is absent");
  const derived = page.locator(".sbe-aegis details[data-category=derived]");
  if (!await derived.evaluate(el => el.open)) await derived.locator("summary").click();
  await page.locator('.sbe-aegis [data-key="system.stats.toughness.value"]').click();
  await page.locator(".sbe-change input.value").fill("4");
  await page.locator(".sbe-change .sbe-condition-details > summary").click();
  const builder = page.locator(".sbe-change .sbe-condition");
  const rootGroup = builder.locator(":scope > .sbe-condition-group");
  const addCondition = rootGroup.locator(':scope > .sbe-condition-actions > [data-condition-action="add-condition"]');
  await addCondition.click();
  await page.locator(".sbe-change .sbe-condition input").fill("fire");
  await page.locator(".sbe-change .sbe-condition input").press("Tab");
  await addCondition.click();
  await builder.getByLabel("Flag", {exact: true}).nth(1).fill("insect");
  await builder.getByLabel("Flag", {exact: true}).nth(1).press("Tab");
  await builder.getByLabel("Flag source", {exact: true}).nth(1).selectOption("target");
  await builder.getByLabel("Match conditions").selectOption("any");
  assert.deepEqual(await builder.getByLabel("Flag", {exact: true}).evaluateAll(inputs => inputs.map(i => i.value)), ["fire", "insect"]);
  assert.equal(await page.evaluate(() => game.modules.get("swade-better-effects").api.testPredicate(layoutEditor.rows[0].predicate, {hasRoll: true, roll: ["fire"]})), true);
  await builder.getByLabel("Match conditions").selectOption("all");
  assert.equal(await page.evaluate(() => game.modules.get("swade-better-effects").api.testPredicate(layoutEditor.rows[0].predicate, {hasRoll: true, roll: ["fire"]})), false);
  await builder.getByLabel("Condition operator", {exact: true}).nth(1).selectOption("not");
  assert.deepEqual(await builder.getByLabel("Flag", {exact: true}).evaluateAll(inputs => inputs.map(i => i.value)), ["fire", "insect"]);
  await builder.getByLabel("Condition operator", {exact: true}).nth(1).selectOption("flag");
  await rootGroup.locator(':scope > .sbe-condition-actions > [data-condition-action="add-group"]').click();
  const nested = builder.locator(".sbe-condition-group").nth(1);
  await nested.locator(':scope > .sbe-predicate-bar > select').selectOption("any");
  const addNested = nested.locator(':scope > .sbe-condition-actions > [data-condition-action="add-condition"]');
  await addNested.click();
  await nested.getByLabel("Flag", {exact: true}).nth(0).fill("magical");
  await nested.getByLabel("Flag", {exact: true}).nth(0).press("Tab");
  await addNested.click();
  await nested.getByLabel("Flag", {exact: true}).nth(1).fill("silver");
  await nested.getByLabel("Flag", {exact: true}).nth(1).press("Tab");
  pass("multiple conditions, nested groups, AND/OR and IF/IF NOT preserve all entered flags");
  await page.locator('.sbe-aegis [name="duration.value"]').fill("3");
  await page.locator('.sbe-aegis [name="duration.expiry"]').selectOption("turnStart");
  await page.locator('.sbe-aegis [name="system.conditionalEffect"]').check();
  assert.deepEqual(await page.locator(".sbe-aegis .presets,.sbe-aegis .preview")
    .evaluateAll(panes => panes.map(pane => Math.max(0, pane.scrollWidth - pane.clientWidth))), [0, 0]);
  pass("checking Conditional Effect does not introduce horizontal overflow");
  if (screenshotDirectory) await page.screenshot({path: `${screenshotDirectory}/restored.png`, animations: "disabled"});
  await page.locator('.sbe-aegis button[type="submit"]').click();
  await page.locator(".sbe-aegis").waitFor({state: "hidden"});
  const saved = await page.evaluate(() => {
    const effect = layoutItem.effects.contents[0];
    const duration = effect.toObject().duration;
    return {count: layoutItem.effects.size, value: effect.system.changes[0].value, rounds: duration.value, units: duration.units,
      expiry: duration.expiry, conditional: effect.system.conditionalEffect,
      predicate: effect.getFlag("swade-better-effects", "conditions")[0].predicate};
  });
  assert.equal(saved.count, 1); assert.equal(Number(saved.value), 4);
  assert.equal(saved.rounds, 3); assert.equal(saved.units, "rounds"); assert.equal(saved.expiry, "turnStart"); assert.equal(saved.conditional, true);
  assert.deepEqual(saved.predicate, {op: "all", children: [
    {op: "flag", source: "roll", flag: "fire"}, {op: "flag", source: "target", flag: "insect"},
    {op: "any", children: [{op: "flag", source: "roll", flag: "magical"}, {op: "flag", source: "roll", flag: "silver"}]}
  ]});
  pass("multiple conditions and native duration controls persist on the effect");
  await page.evaluate(() => {
    globalThis.layoutEditor = game.modules.get("swade-better-effects").api.openAegis(layoutItem, layoutItem.effects.contents[0]);
  });
  await page.locator(".sbe-change input.value").fill("6");
  await page.locator('.sbe-aegis button[type="submit"]').click();
  await page.locator(".sbe-aegis").waitFor({state: "hidden"});
  assert.deepEqual(await page.evaluate(() => ({count: layoutItem.effects.size, value: Number(layoutItem.effects.contents[0].system.changes[0].value)})), {count: 1, value: 6});
  pass("editing reopens all saved conditions and updates the existing effect");
  await page.evaluate(async id => {
    const effect = layoutItem.effects.contents[0];
    const conditions = structuredClone(effect.getFlag(id, "conditions"));
    conditions[0].predicate = {op: "not", child: {op: "flag", source: "roll", flag: "silver"}};
    await effect.setFlag(id, "conditions", conditions);
    globalThis.layoutEditor = game.modules.get(id).api.openAegis(layoutItem, effect);
  }, id);
  await page.locator(".sbe-change .sbe-condition-details > summary").click();
  assert.equal(await builder.getByLabel("Flag", {exact: true}).inputValue(), "silver");
  assert.equal(await builder.getByLabel("Condition operator", {exact: true}).inputValue(), "not");
  await addCondition.click();
  await builder.getByLabel("Flag", {exact: true}).nth(1).fill("fire");
  await builder.getByLabel("Flag", {exact: true}).nth(1).press("Tab");
  await page.locator('.sbe-aegis button[type="submit"]').click();
  await page.locator(".sbe-aegis").waitFor({state: "hidden"});
  assert.deepEqual(await page.evaluate(id => layoutItem.effects.contents[0].getFlag(id, "conditions")[0].predicate, id), {op: "all", children: [
    {op: "not", child: {op: "flag", source: "roll", flag: "silver"}}, {op: "flag", source: "roll", flag: "fire"}
  ]});
  pass("older single-condition effects can add another condition without losing IF NOT or its flag");
  await page.evaluate(id => {
    globalThis.layoutCreation = Item.createDialog({type: `${id}.effect`});
  }, id);
  await page.locator('dialog.application [name="name"]').fill(`${itemName} Effect`);
  await page.locator('dialog.application button[type="submit"]').click();
  await page.locator(".sbe-aegis").waitFor();
  assert.equal(await page.locator(".sbe-effect-item").count(), 0);
  pass("creating an Effect opens only A.E.G.I.S., without an empty overview");
  const newDerived = page.locator(".sbe-aegis details[data-category=derived]");
  if (!await newDerived.evaluate(el => el.open)) await newDerived.locator("summary").click();
  await page.locator('.sbe-aegis [data-key="system.stats.toughness.value"]').click();
  await page.locator(".sbe-change input.value").fill("2");
  await page.locator('.sbe-aegis button[type="submit"]').click();
  await page.locator(".sbe-aegis").waitFor({state: "hidden"});
  assert.equal(await page.locator(".sbe-effect-item").count(), 0);
  await page.evaluate(async () => { globalThis.freshEffectItem = await layoutCreation; await freshEffectItem.sheet.render({force: true}); });
  await page.locator(".sbe-effect-item").waitFor();
  assert.deepEqual(await page.locator(".sbe-effect-item button").allTextContents(), ["Effect builder", "Manual edit"]);
  assert.equal(await page.locator(".sbe-effect-item img").count(), 1);
  assert.equal(await page.locator(".sbe-effect-item h2").textContent(), await page.evaluate(() => freshEffectItem.name));
  assert.equal(await page.locator(".sbe-effect-item p,.sbe-effect-entry").count(), 0);
  await page.getByRole("button", {name: "Effect builder", exact: true}).click();
  await page.locator(".sbe-aegis").waitFor();
  assert.equal(await page.locator(".sbe-effect-item").count(), 0);
  await page.locator('.sbe-aegis [data-action="close"]').click();
  await page.evaluate(() => freshEffectItem.sheet.render({force: true}));
  await page.getByRole("button", {name: "Manual edit", exact: true}).click();
  await page.waitForFunction(() => freshEffectItem.effects.contents[0].sheet.rendered);
  assert.equal(await page.locator(".sbe-effect-item").count(), 0);
  await page.evaluate(() => freshEffectItem.effects.contents[0].sheet.close());
  pass("saved Effects show only icon, name and two editor choices, and close before either editor opens");
  await page.evaluate(async () => { globalThis.layoutModules = new foundry.applications.sidebar.apps.ModuleManagement(); await layoutModules.render({force: true}); });
  const targeted = page.locator('input[name="swade-targeted-damage"]');
  assert.equal(await targeted.isChecked(), true);
  await page.locator(`input[name="${id}"]`).click();
  const resolution = page.locator(".application").filter({has: page.locator(".window-title").filter({hasText: /^Dependency Resolution$/})});
  await resolution.getByRole("button", {name: "Deactivate", exact: true}).waitFor();
  assert.equal((await resolution.innerText()).includes("SWADE Targeted Damage"), false);
  await resolution.getByRole("button", {name: "Deactivate", exact: true}).click();
  await resolution.waitFor({state: "hidden"});
  assert.equal(await page.locator(`input[name="${id}"]`).isChecked(), false);
  assert.equal(await targeted.isChecked(), true);
  assert.equal(await page.locator("dialog.application").count(), 0);
  pass("the native Effect-document warning never selects Targeted Damage for deactivation");
  assert.deepEqual(errors, []);
  pass("no browser JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors);
  if (screenshotDirectory) await page.screenshot({path: `${screenshotDirectory}/failure.png`, animations: "disabled"}).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
