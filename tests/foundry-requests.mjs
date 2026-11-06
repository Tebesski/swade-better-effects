// Token Controls, settings library, legacy migration, roles and native requests.
// Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const id = "swade-better-effects", oldPack = "world.better-effects-roll-requests", prefix = `Controls ${Date.now()}`, errors = [], shots = process.env.FOUNDRY_QA_SCREENSHOTS;
async function ready(page) {
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, {timeout: 60000}); assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications {display:none!important}"});
  await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); });
}
async function join(name) {
  const page = await (await browser.newContext({viewport: {width: 1440, height: 1050}})).newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001"); await page.locator('select[name="userId"]').selectOption({label: name});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready(page); return page;
}
const card = (page, key) => page.locator(`#chat .chat-message[data-message-id="${key}"]`);
async function openForm(page) {
  const tokens = page.locator('#scene-controls [data-control="tokens"]');
  if (await tokens.getAttribute("aria-pressed") !== "true") await tokens.click();
  const tool = page.locator('#scene-controls [data-tool="sbeRollRequest"]'); await tool.waitFor();
  assert.equal(await tool.evaluate(el => el.classList.contains("fa-dice")), true); await tool.click();
  await page.locator(".sbe-roll-request").waitFor({timeout: 45000}); return page.locator(".sbe-roll-request");
}
async function generate(page, form) {
  const previous = await page.evaluate(() => game.messages.contents.at(-1)?.id);
  await form.getByRole("button", {name: "Generate Request", exact: true}).click(); await form.waitFor({state: "hidden"});
  await page.waitForFunction(old => game.messages.contents.at(-1)?.id !== old, previous); return page.evaluate(() => game.messages.contents.at(-1).id);
}
async function submit(page) {
  const dialog = page.locator(".roll-dialog"); await dialog.waitFor();
  const previous = await page.evaluate(() => game.messages.contents.at(-1)?.id);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click(); await dialog.waitFor({state: "hidden"});
  await page.waitForFunction(old => game.messages.contents.at(-1)?.id !== old, previous); return page.evaluate(() => game.messages.contents.at(-1).id);
}
let gm;
try {
  gm = await join("Gamemaster");
  await gm.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-better-setting": true}); }, id); await gm.reload(); await ready(gm);
  await gm.waitForFunction(oldPack => !game.packs.has(oldPack), oldPack);
  const legacy = await gm.evaluate(async ({id, prefix}) => {
    const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({name: "better-effects-roll-requests", label: "Roll Requests", type: "Macro", system: "swade"});
    const request = {version: 1, kind: "skill", trait: "Athletics", name: "Athletics", targetNumber: 7, flags: ["grapple"], recipients: []};
    const doc = await Macro.create({name: `${prefix} Legacy`, type: "script", command: "", flags: {[id]: {requestTemplate: request}}}, {pack: pack.collection});
    await game.macros.importFromCompendium(pack, doc.id, {}, {renderSheet: false});
    await Macro.create({name: `${prefix} Custom`, type: "script", command: "return 42;"}, {pack: pack.collection});
    const command = 'if (!game.user.isGM) return ui.notifications.warn("Only a GM or Assistant GM can generate roll requests.");\nconst api = game.modules.get("swade-better-effects")?.api;\nif (!api) return ui.notifications.warn("Enable SWADE Better Effects first.");\nawait api.openRollRequest();';
    const obsolete = await Macro.create({name: "Generate Request", type: "script", command});
    await pack.configure({locked: true}); return {id: doc.id, macro: obsolete.id};
  }, {id, prefix});
  await gm.reload(); await ready(gm);
  await gm.waitForFunction(({id, oldPack, legacy}) => !game.packs.has(oldPack) && !game.macros.has(legacy.macro) && game.settings.get(id, "rollRequests").some(entry => entry.id === legacy.id), {id, oldPack, legacy});
  const migrated = await gm.evaluate(({id, prefix}) => ({entries: game.settings.get(id, "rollRequests").filter(entry => entry.name === `${prefix} Legacy`), custom: game.macros.some(macro => macro.name === `${prefix} Custom`), imports: game.macros.filter(macro => macro.getFlag(id, "requestTemplate")).length, modulePack: game.packs.has(`${id}.macros`)}), {id, prefix});
  assert.equal(migrated.entries.length, 1); assert.equal(migrated.entries[0].request.targetNumber, 7); assert.deepEqual(migrated.entries[0].request.flags, ["grapple"]);
  assert.equal(migrated.custom, true); assert.equal(migrated.imports, 0); assert.equal(migrated.modulePack, false);
  console.log("PASS old compendium and imported request macros migrate once into settings; unrelated macros are preserved; obsolete macro/compendia are removed");
  const fixtures = await gm.evaluate(async ({id, prefix}) => {
    const [player, other, assistant] = await User.createDocuments([{name: `${prefix} Player`, role: 1}, {name: `${prefix} Other`, role: 1}, {name: `${prefix} Assistant`, role: 3}]);
    const {changeSignature} = await import("/modules/swade-better-effects/scripts/rules.mjs");
    const change = {key: "@Skill{Athletics}[system.die.modifier]", type: "add", value: "1", phase: "initial", priority: null};
    const actor = await Actor.create({name: prefix, type: "character", ownership: {[player.id]: 3}, items: [{name: "Athletics", type: "skill", system: {attribute: "agility", die: {sides: 8}}}], effects: [{name: "Grapple training", system: {changes: [change]}, flags: {[id]: {conditions: [{signature: changeSignature(change), predicate: {op: "flag", source: "roll", flag: "grapple"}}]}}}]});
    await player.update({character: actor.id}); return {player: player.name, other: other.name, assistant: assistant.name, playerId: player.id};
  }, {id, prefix});
  let form = await openForm(gm); assert.equal(await form.getByLabel("TN", {exact: true}).inputValue(), "4");
  await form.getByRole("button", {name: "Choose trait", exact: true}).click(); const picker = gm.locator(".sbs-picker"); await picker.waitFor();
  assert.ok((await picker.locator("h3").allTextContents()).includes("Attributes"));
  await picker.getByLabel("Search skills and traits", {exact: true}).fill("Athletics"); await picker.getByRole("button", {name: /^Athletics/}).click(); await picker.waitFor({state: "hidden"});
  await form.getByLabel("Name", {exact: true}).fill(`${prefix} Grapple Escape`); await form.getByLabel("TN", {exact: true}).fill("8"); await form.getByLabel("Flags", {exact: true}).fill("GRAPPLE, Fire"); await form.getByLabel(fixtures.player, {exact: true}).check();
  await form.getByRole("button", {name: "Save request", exact: true}).click();
  await gm.waitForFunction(({id, name}) => game.settings.get(id, "rollRequests").some(entry => entry.name === name), {id, name: `${prefix} Grapple Escape`});
  const privateId = await generate(gm, form), player = await join(fixtures.player), other = await join(fixtures.other);
  assert.equal(await card(gm, privateId).locator(".sbe-request-roll").count(), 1); assert.equal(await card(other, privateId).locator(".sbe-request-roll").count(), 0); await other.context().close();
  assert.equal(await player.locator('#scene-controls [data-tool="sbeRollRequest"]').count(), 0);
  await card(player, privateId).getByRole("button", {name: "Roll Athletics", exact: true}).click(); const dialog = player.locator(".roll-dialog"); await dialog.waitFor();
  assert.match(await dialog.locator(".sbe-opposed-tn").textContent(), /8/); assert.equal(await dialog.locator("#messageMode").isDisabled(), true); assert.equal(await dialog.locator(".modifier-entry").filter({hasText: "Grapple training"}).count(), 1);
  const response = await submit(player);
  const result = await player.evaluate(key => { const m = game.messages.get(key); return {tn: m.significantRoll.targetNumber, whisper: [...m.whisper].sort(), flags: game.modules.get("swade-better-effects").api.getRollContext(m).roll}; }, response);
  assert.equal(result.tn, 8); assert.ok(result.flags.includes("grapple")); assert.ok(result.flags.includes("fire"));
  assert.deepEqual(result.whisper, [fixtures.playerId, await gm.evaluate(() => game.user.id)].sort());
  console.log("PASS Token Controls dice button preserves Better Setting, TN, flags, conditional bonuses and private delivery; players cannot see the GM tool");
  form = await openForm(gm); await form.getByLabel("Saved request", {exact: true}).selectOption({label: `${prefix} Grapple Escape`}); await gm.waitForFunction(() => document.querySelector('.sbe-roll-request [name="trait"]')?.value === "Athletics");
  assert.equal(await form.getByLabel(fixtures.player, {exact: true}).isChecked(), true); await form.getByLabel(fixtures.player, {exact: true}).uncheck(); await form.getByLabel("Trait", {exact: true}).fill("Void Lore");
  const publicId = await generate(gm, form); await card(player, publicId).getByRole("button", {name: "Roll Void Lore", exact: true}).click(); await dialog.waitFor();
  assert.equal(await dialog.locator(".modifier-entry").filter({hasText: "Unskilled"}).count(), 1); const untrained = await submit(player);
  assert.equal(await player.evaluate(key => game.modules.get("swade-better-effects").api.getRollContext(game.messages.get(key)).roll.includes("untrained"), untrained), true); await player.context().close();
  console.log("PASS saved settings presets reload selected players and missing-skill attempts still use native untrained rolls");
  await gm.evaluate(id => { const menu = game.settings.menus.get(`${id}.rollRequests`); if (!menu.restricted) throw new Error("Library menu must be GM restricted"); new menu.type().render({force: true}); }, id);
  let library = gm.locator(".sbe-request-library"); await library.waitFor(); await library.getByLabel("Search roll requests", {exact: true}).fill(`${prefix} Legacy`);
  assert.equal(await library.locator("[data-request-search]:visible").count(), 1); await library.getByRole("button", {name: `Edit ${prefix} Legacy`, exact: true}).click(); form = gm.locator(".sbe-roll-request"); await form.waitFor();
  assert.equal(await form.getByLabel("TN", {exact: true}).inputValue(), "7"); await form.locator('[data-action="close"]').click();
  await library.getByRole("button", {name: "Create Roll Request", exact: true}).click(); await form.waitFor(); await form.getByLabel("Name", {exact: true}).fill(`${prefix} From settings`); await form.getByLabel("Trait", {exact: true}).fill("Spirit"); await form.getByRole("button", {name: "Save request", exact: true}).click(); await form.locator('[data-action="close"]').click();
  await library.getByLabel("Search roll requests", {exact: true}).fill(`${prefix} From settings`); await library.getByRole("button", {name: `Generate ${prefix} From settings`, exact: true}).click();
  await gm.waitForFunction(() => game.messages.contents.at(-1)?.getFlag("swade-better-effects", "rollRequest")?.trait === "spirit");
  if (shots) await library.screenshot({path: `${shots}/request-settings-library.png`, animations: "disabled"});
  await library.getByRole("button", {name: `Delete ${prefix} From settings`, exact: true}).click();
  await gm.waitForFunction(({id, name}) => !game.settings.get(id, "rollRequests").some(entry => entry.name === name), {id, name: `${prefix} From settings`});
  console.log("PASS module settings library supports search, editing, creation, direct generation and deletion");
  const assistant = await join(fixtures.assistant); const assistantForm = await openForm(assistant); assert.equal(await assistantForm.getByLabel("TN", {exact: true}).inputValue(), "4"); await assistantForm.locator('[data-action="close"]').click();
  await assistant.evaluate(id => game.modules.get(id).api.openRollRequestLibrary(), id); await assistant.locator(".sbe-request-library").waitFor(); await assistant.context().close();
  await gm.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true}); }, id); await gm.reload(); await ready(gm); form = await openForm(gm);
  assert.equal(await form.getByRole("button", {name: "Choose trait", exact: true}).count(), 0); await form.getByLabel("Trait", {exact: true}).fill("Untrained"); const explicit = await generate(gm, form);
  assert.equal(await gm.evaluate(key => game.messages.get(key).getFlag("swade-better-effects", "rollRequest").kind, explicit), "untrained");
  assert.equal(await gm.evaluate(oldPack => game.packs.has(oldPack), oldPack), false); assert.deepEqual(errors, []);
  console.log("PASS Assistant GMs have controls/settings access; no Better Setting dependency or recreated compendium; no browser errors");
} catch (error) {
  console.error("Browser errors:", errors); if (shots && gm) await gm.screenshot({path: `${shots}/request-controls-failure.png`}).catch(() => {}); throw error;
} finally { await browser.close(); }
