// Rich-text notes and preview geometry. Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}}); page.setDefaultTimeout(12000);
const id = "swade-better-effects", prefix = `Notes ${Date.now()}`, errors = [], shots = process.env.FOUNDRY_QA_SCREENSHOTS;
page.on("pageerror", error => errors.push(error.stack ?? error.message));
page.on("console", msg => { if (msg.type() === "error" && msg.text().includes(id)) errors.push(msg.text()); });
const pass = text => console.log(`PASS ${text}`);
async function ready() {
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications {pointer-events:none!important}"});
  await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); });
}
async function openGroup(category) {
  const group = page.locator(`.sbe-aegis [data-category="${category}"]`);
  if (!await group.evaluate(el => el.open)) await group.locator(":scope > summary").click();
  return group;
}
async function writeNote(row, text, bold = false) {
  await row.locator("select.type").selectOption("note");
  await row.getByRole("button", {name: "Edit note", exact: true}).click();
  const editor = page.locator(".sbe-note-editor"); await editor.waitFor();
  const body = editor.locator(".ProseMirror"); await body.waitFor(); await body.fill(text);
  if (bold) { await body.press("Control+Home"); await body.press("Control+Shift+ArrowRight"); await body.press("Control+b"); }
  if (shots && bold) await editor.screenshot({path: `${shots}/note-rich-editor.png`, animations: "disabled"});
  await editor.getByRole("button", {name: "Save note", exact: true}).click(); await editor.waitFor({state: "hidden"});
  await row.locator(".sbe-note-preview").waitFor();
}
async function nativeRoll(damage = false) {
  const old = await page.evaluate(() => game.messages.contents.at(-1)?.id);
  await page.evaluate(damage => { n.pending = damage ? n.sword.rollDamage() : n.actor.rollSkill(n.actor.items.getName("Fighting").id, {item: n.sword}); }, damage);
  const dialog = page.locator(".roll-dialog"); await dialog.waitFor();
  await dialog.getByRole("button", {name: "Roll", exact: true}).click(); await dialog.waitFor({state: "hidden"});
  await page.waitForFunction(old => game.messages.contents.at(-1)?.id !== old, old);
  return page.evaluate(() => game.messages.contents.at(-1).id);
}
const card = messageId => page.locator(`#chat .chat-message[data-message-id="${messageId}"]`);
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready();
  await page.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true}); await game.settings.set("core", "noCanvas", false); }, id);
  await page.reload(); await ready();
  await page.evaluate(async ({id, prefix}) => {
    globalThis.n = {api: game.modules.get(id).api};
    n.actor = await Actor.create({name: prefix, type: "character", items: [
      {name: "Fighting", type: "skill", system: {swid: "fighting", attribute: "agility", die: {sides: 8}}},
      {name: "Athletics", type: "skill", system: {swid: "athletics", attribute: "agility", die: {sides: 8}}},
      {name: "Fire sword", type: "weapon", system: {rangeType: 0, damage: "2d6", actions: {skill: "Fighting"}}, flags: {[id]: {tags: ["fire"]}}}]});
    n.sword = n.actor.items.getName("Fire sword");
    n.defender = await Actor.create({name: `${prefix} Defender`, type: "npc"});
    const scene = await Scene.create({name: prefix, active: true, width: 1400, height: 900, padding: 0, tokens: [
      {name: "Attacker", actorId: n.actor.id, actorLink: true, x: 200, y: 200}, {name: "Defender", actorId: n.defender.id, actorLink: true, x: 600, y: 200}]}); await scene.view();
    n.api.openAegis(n.actor);
  }, {id, prefix});
  await page.waitForFunction(() => canvas.ready && canvas.tokens.placeables.some(token => token.name === "Defender"));
  await page.evaluate(() => canvas.tokens.placeables.find(token => token.name === "Defender").setTarget(true));
  const wizard = page.locator(".sbe-aegis"); await wizard.waitFor(); await wizard.locator('[name="name"]').fill("Wizard notes");
  await (await openGroup("attribute")).getByRole("button", {name: "Add", exact: true}).click();
  const attribute = wizard.locator('.sbe-change[data-index="0"]');
  await attribute.locator("input.value").fill("2"); await attribute.locator("input.value").press("Tab");
  const geometry = await attribute.evaluate(row => {
    const bottom = selector => row.querySelector(selector).getBoundingClientRect().bottom;
    return [bottom(".sbe-change-selector"), bottom("select.type"), bottom("input.value"), bottom(".change-controls")];
  });
  assert.ok(Math.max(...geometry) - Math.min(...geometry) < 2, JSON.stringify(geometry));
  if (shots) await wizard.screenshot({path: `${shots}/aegis-aligned-components.png`, animations: "disabled"});
  await attribute.getByRole("button", {name: "Remove change", exact: true}).click();
  pass("attribute component, operation, value and trash control align on the same baseline");
  await (await openGroup("globalMod")).getByRole("button", {name: "Add Attack", exact: true}).click();
  const attack = wizard.locator('.sbe-change[data-index="0"]');
  await writeNote(attack, "Attack reminder: burning targets. [[/r 1d6]]", true);
  assert.equal(await attack.locator(".sbe-note-preview :is(strong, b)").count(), 1);
  await attack.locator(".sbe-condition-details > summary").click();
  await attack.locator('[data-condition-action="add-condition"]').click();
  await attack.getByLabel("Flag", {exact: true}).fill("fire"); await attack.getByLabel("Flag", {exact: true}).press("Tab");
  await (await openGroup("globalMod")).getByRole("button", {name: "Add Traits", exact: true}).click();
  await writeNote(wizard.locator('.sbe-change[data-index="1"]'), "Trait reminder: consider your options.");
  await (await openGroup("globalMod")).getByRole("button", {name: "Add Damage", exact: true}).click();
  await wizard.locator('.sbe-change[data-index="2"]').getByLabel("Change", {exact: true}).selectOption("system.stats.globalMods.damage");
  await writeNote(wizard.locator('.sbe-change[data-index="2"]'), `Damage reminder. ${"This longer rule stays in a scrolling note area. ".repeat(70)}`);
  if (shots) await wizard.screenshot({path: `${shots}/aegis-roll-notes.png`, animations: "disabled"});
  await wizard.locator('button[type="submit"]').click(); await wizard.waitFor({state: "hidden"});
  await page.evaluate(() => { n.effect = n.actor.effects.getName("Wizard notes"); });
  assert.equal(await page.evaluate(() => n.effect._source.system.changes.every(change => change.key.startsWith("sbe.rollNote.") && change.type === "add")), true);
  assert.equal(await page.evaluate(() => n.actor.system.stats.globalMods.attack.length), 0);
  assert.equal(await page.evaluate(() => n.api.collectRules(n.actor).length), 0);
  await page.evaluate(() => n.api.openAegis(n.actor, n.effect)); await wizard.waitFor();
  assert.deepEqual(await wizard.locator(".sbe-change select.type").evaluateAll(selects => selects.map(select => select.value)), ["note", "note", "note"]);
  assert.equal(await wizard.locator(".sbe-change").first().locator(".sbe-note-preview :is(strong, b)").count(), 1);
  await wizard.locator('[data-action="close"]').click(); await wizard.waitFor({state: "hidden"});
  pass("AEGIS authors formatted, conditional Attack/Trait/Damage notes and reopens them without modifying stats");
  const attackId = await nativeRoll(); await card(attackId).locator(".sbe-roll-notes").waitFor();
  assert.equal(await card(attackId).locator(".sbe-roll-note").count(), 2);
  assert.equal(await card(attackId).locator(".sbe-roll-note-body :is(strong, b)").count(), 1);
  assert.equal(await card(attackId).locator(".sbe-roll-note-body .inline-roll").count(), 1);
  assert.equal(await card(attackId).locator(".sbe-roll-notes").evaluate(el => el === el.parentElement.lastElementChild), true);
  assert.equal(await card(attackId).locator(".sbe-roll-notes").evaluate(el => [...el.parentElement.children].every(child => child === el || child.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + 1)), true);
  if (shots) await card(attackId).screenshot({path: `${shots}/attack-notes-card.png`, animations: "disabled"});
  const damageId = await nativeRoll(true); const damage = card(damageId); await damage.locator(".sbe-roll-notes").waitFor();
  assert.equal(await damage.locator(".sbe-roll-note").count(), 1);
  const scroll = await damage.locator(".sbe-roll-notes").evaluate(el => ({height: el.getBoundingClientRect().height, content: el.scrollHeight, viewport: el.clientHeight}));
  assert.ok(scroll.height <= 171 && scroll.content > scroll.viewport);
  assert.equal(await damage.locator(".sbe-roll-notes").evaluate(el => el === el.parentElement.lastElementChild), true);
  if (shots) await damage.screenshot({path: `${shots}/damage-notes-card.png`, animations: "disabled"});
  pass("matching notes render enriched markup at the bottom; long damage notes stay within a scrolling 170px panel");
  await page.evaluate(() => n.effect.update({disabled: true}));
  await card(attackId).locator("button.free-reroll").click();
  await page.waitForFunction(previous => game.messages.contents.at(-1).id !== previous, damageId);
  const rerollId = await page.evaluate(() => game.messages.contents.at(-1).id); await card(rerollId).locator(".sbe-roll-notes").waitFor();
  assert.equal(await card(rerollId).locator(".sbe-roll-note").count(), 2);
  const inactive = await nativeRoll(); await card(inactive).locator(".sbe-chat-roll-flags").waitFor();
  assert.equal(await card(inactive).locator(".sbe-roll-notes").count(), 0);
  await page.evaluate(async () => { await n.effect.update({disabled: false}); await n.sword.update({"flags.swade-better-effects.tags": []}); });
  const nonfire = await nativeRoll(); await card(nonfire).locator(".sbe-roll-notes").waitFor();
  assert.equal(await card(nonfire).locator(".sbe-roll-note").count(), 1);
  pass("notes honor conditions and active effects; native rerolls retain the original notes");
  await page.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-tools": true}); }, id);
  await page.reload(); await ready();
  await page.evaluate(({id, prefix}) => { globalThis.n = {actor: game.actors.getName(prefix), api: game.modules.get(id).api}; n.sword = n.actor.items.getName("Fire sword"); }, {id, prefix});
  await page.evaluate(async () => { const {default: ItemRoll} = await import("/modules/swade-tools/scripts/class/ItemRoll.js"); const roll = new ItemRoll(n.actor, n.sword); await roll.rollBaseDamage(); roll.display(); });
  await page.waitForFunction(() => game.messages.contents.at(-1)?.flags["swade-tools"]?.rolltype === "damage");
  const toolsId = await page.evaluate(() => game.messages.contents.at(-1).id); await card(toolsId).locator(".sbe-roll-notes").waitFor();
  assert.equal(await card(toolsId).locator(".sbe-roll-note").count(), 1);
  assert.equal(await card(toolsId).locator(".sbe-roll-notes").evaluate(el => el === el.parentElement.lastElementChild), true);
  await card(toolsId).locator(".swadetools-freereroll").click(); await page.waitForFunction(old => game.messages.contents.at(-1).id !== old, toolsId);
  await card(await page.evaluate(() => game.messages.contents.at(-1).id)).locator(".sbe-roll-notes").waitFor();
  pass("SWADE Tools damage cards and rerolls retain notes at the bottom");
  assert.deepEqual(errors, []); pass("no browser JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors); console.error((await page.locator("body").innerText()).slice(-2600));
  if (shots) await page.screenshot({path: `${shots}/notes-failure.png`}).catch(() => {});
  throw error;
} finally { await browser.close(); }
