// Optional live smoke test. Use ONLY a disposable world whose id is effects-qa.
// FOUNDRY_QA_URL=http://localhost:30001
// PLAYWRIGHT_MODULE=C:/path/to/node_modules/playwright
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.env.FOUNDRY_QA_URL ?? "http://localhost:30001";
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const errors = [];
const prefix = `Smoke ${Date.now()}`;
const moduleId = "swade-better-effects";
const type = `${moduleId}.effect`;

async function join(name) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", msg => { if (msg.type() === "error" && msg.text().includes(moduleId)) errors.push(msg.text()); });
  await page.goto(url);
  await page.locator('select[name="userId"]').selectOption({label: name});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready(page);
  return page;
}
async function ready(page) {
  try { await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 30000}); }
  catch (error) { console.error("Client load failure:", page.url(), (await page.locator("body").innerText()).slice(-2000), errors); throw error; }
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa", "Refusing to change a non-test world");
  await page.addStyleTag({content: "#notifications { pointer-events: none !important; }"});
}
async function bind(page) {
  await page.evaluate(({prefix, moduleId}) => {
    globalThis.smoke = {actor: game.actors.getName(`${prefix} Actor`), template: game.items.getName(`${prefix} Fire Ward`),
      api: game.modules.get(moduleId).api, scene: game.scenes.getName(`${prefix} Scene`)};
  }, {prefix, moduleId});
}
async function roll(page, total, flags = ["fire"], whisper = false) {
  return page.evaluate(async ({total, flags, whisper}) => {
    const cls = CONFIG.Dice.rolls.find(c => c.name === "DamageRoll");
    const roll = new cls(String(total)); smoke.api.tagRoll(roll, flags, {actor: smoke.actor}); await roll.evaluate();
    const data = {speaker: ChatMessage.getSpeaker({actor: smoke.actor})};
    if (whisper) data.whisper = [game.user.id];
    const message = await roll.toMessage(data, {messageMode: whisper ? "gm" : "public"}); smoke.message = message;
    return message.uuid;
  }, {total, flags, whisper});
}
const pass = text => console.log(`PASS ${text}`);

try {
  const gm = await join("Gamemaster");
  assert.equal(await gm.evaluate(id => game.modules.get(id)?.active, moduleId), true);
  if (await gm.evaluate(() => !game.modules.get("swade-targeted-damage")?.active || game.modules.get("swade-tools")?.active)) {
    await gm.evaluate(() => game.settings.set("core", "moduleConfiguration", {...game.settings.get("core", "moduleConfiguration"), "swade-targeted-damage": true, "swade-tools": false}));
    await gm.reload(); await ready(gm);
  }
  assert.equal(await gm.evaluate(() => game.modules.get("swade-targeted-damage")?.active), true);
  await gm.evaluate(async ({prefix, type}) => {
    globalThis.smoke = {};
    smoke.actor = await Actor.create({name: `${prefix} Actor`, type: "character", flags: {"swade-better-effects": {tags: ["werewolf"]}}});
    smoke.creation = Item.createDialog({type});
  }, {prefix, type});
  const dialog = gm.locator("dialog.application");
  assert.equal(await dialog.locator(`option[value="${type}"]`).textContent(), "Effect");
  await dialog.locator('[name="name"]').fill(`${prefix} Fire Ward`);
  await dialog.locator('button[type="submit"]').click();
  await gm.locator(".sbe-aegis").waitFor();
  await gm.locator(".sbe-aegis").getByRole("button", {name: "Save Effect", exact: true}).waitFor();
  await bind(gm);
  const createdEffectId = await gm.evaluate(() => smoke.template.effects.contents[0].id);
  await gm.locator('.sbe-aegis button[data-action="close"]').click();
  await gm.evaluate(() => smoke.template.sheet.render({force: true}));
  const chooser = gm.locator(".sbe-effect-chooser");
  await chooser.getByRole("button", {name: "Manual edit", exact: true}).waitFor();
  await chooser.getByRole("button", {name: "Effect builder", exact: true}).click();
  await gm.locator(".sbe-aegis").getByRole("button", {name: "Save Effect", exact: true}).waitFor();
  if (!await gm.locator(".sbe-aegis details[data-category=derived]").evaluate(el => el.open)) await gm.locator(".sbe-aegis details[data-category=derived] summary").click();
  await gm.locator('.sbe-aegis [data-key="system.stats.toughness.value"]').click();
  await gm.locator('.sbe-change [data-field="value"]').fill("4");
  await gm.locator(".sbe-change .sbe-condition-details summary").click();
  await gm.locator(".sbe-change .sbe-condition button").filter({hasText: "Add condition"}).click();
  await gm.locator(".sbe-change .sbe-condition input").fill("FIRE");
  await gm.locator(".sbe-change .sbe-condition input").press("Tab");
  await gm.locator('.sbe-aegis button[type="submit"]').click();
  await gm.locator(".sbe-aegis").waitFor({state: "hidden"});
  await gm.waitForFunction(prefix => game.items.getName(`${prefix} Fire Ward`)?.effects.size === 1, prefix);
  await bind(gm);
  pass("native Create Item dialog, automatic A.E.G.I.S., and condition UI");

  const originalId = await gm.evaluate(() => smoke.template.effects.contents[0].id);
  assert.equal(originalId, createdEffectId);
  await gm.evaluate(async () => {
    await smoke.template.effects.contents[0].update({description: "<p>Preserve me</p>", tint: "#112233"});
    smoke.api.openAegis(smoke.template, smoke.template.effects.contents[0]);
  });
  await gm.locator('.sbe-aegis [data-field="value"]').fill("6");
  await gm.locator('.sbe-aegis button[type="submit"]').click();
  await gm.locator(".sbe-aegis").waitFor({state: "hidden"});
  await gm.waitForFunction(() => Number(smoke.template.effects.contents[0].system.changes[0].value) === 6);
  assert.deepEqual(await gm.evaluate(() => ({size: smoke.template.effects.size, id: smoke.template.effects.contents[0].id,
    description: smoke.template.effects.contents[0].description, tint: smoke.template.effects.contents[0].tint})),
  {size: 1, id: originalId, description: "<p>Preserve me</p>", tint: "#112233"});
  await gm.evaluate(() => smoke.api.openAegis(smoke.template, smoke.template.effects.contents[0]));
  await gm.locator('.sbe-aegis [data-field="value"]').fill("4");
  await gm.locator('.sbe-aegis button[type="submit"]').click();
  await gm.locator(".sbe-aegis").waitFor({state: "hidden"});
  await gm.waitForFunction(() => Number(smoke.template.effects.contents[0].system.changes[0].value) === 4);
  pass("editing preserves the effect id, descriptions, tint, and conditions");

  assert.deepEqual(await gm.evaluate(async () => {
    await smoke.actor.sheet._onDropItem(new DragEvent("drop"), {type: "Item", uuid: smoke.template.uuid});
    return {effects: smoke.actor.effects.size, templates: smoke.actor.items.filter(i => i.type === "swade-better-effects.effect").length,
      toughness: smoke.actor.system.stats.toughness.value};
  }), {effects: 1, templates: 0, toughness: 4});
  await gm.evaluate(async prefix => {
    smoke.scene = await Scene.create({name: `${prefix} Scene`, active: true, width: 1200, height: 900, padding: 0, grid: {type: 1, size: 100}, tokens: [
      {name: "Linked", actorId: smoke.actor.id, actorLink: true, x: 200, y: 200},
      {name: "Unlinked", actorId: smoke.actor.id, actorLink: false, x: 500, y: 200}
    ]}); await smoke.scene.view();
  }, prefix);
  await gm.waitForFunction(() => canvas.ready && canvas.tokens.placeables.some(t => t.name === "Unlinked"));
  await gm.evaluate(() => Hooks.call("dropCanvasData", canvas, {type: "Item", uuid: smoke.template.uuid, sbeEffect: true, x: 550, y: 250}));
  await gm.waitForFunction(() => smoke.scene.tokens.getName("Unlinked").actor.effects.size === 2);
  assert.equal(await gm.evaluate(() => smoke.actor.effects.size), 1);
  pass("actor-sheet and canvas drops apply effects, including isolated unlinked-token effects");

  await gm.evaluate(async prefix => {
    smoke.weapon = await Item.create({name: `${prefix} Spear`, type: "weapon", system: {damage: "2d6"}});
    await smoke.weapon.sheet.render({force: true});
  }, prefix);
  await gm.locator('[data-action="tab"][data-tab="properties"]').click();
  assert.equal(await gm.evaluate(() => !!smoke.weapon.sheet.element.querySelector(".sbe-tags-field").nextElementSibling.querySelector('[name="system.trademark"]')), true);
  await gm.locator(".sbe-tags-field input").fill("Fire, Cold Iron, FIRE");
  await gm.locator(".sbe-tags-field input").press("Tab");
  await gm.waitForFunction(() => smoke.weapon.getFlag("swade-better-effects", "tags")?.length === 2);
  await gm.evaluate(async () => {
    await smoke.weapon.sheet.close(); const data = smoke.weapon.toObject(); delete data._id;
    [smoke.ownedWeapon] = await smoke.actor.createEmbeddedDocuments("Item", [data]);
    smoke.rolling = smoke.ownedWeapon.rollDamage();
  });
  await gm.getByRole("button", {name: "Roll", exact: true}).click();
  await gm.evaluate(async () => { await smoke.rolling; smoke.weaponMessage = game.messages.contents.at(-1); });
  const weaponFlags = await gm.evaluate(() => smoke.weaponMessage.getFlag("swade-better-effects", "context").roll);
  assert.ok(["cold-iron", "fire", "werewolf", "weapon", "damage"].every(flag => weaponFlags.includes(flag)));
  pass("weapon Properties flags normalize and survive SWADE's normal roll dialog");

  const fireUuid = await roll(gm, 12);
  assert.deepEqual(await gm.evaluate(() => {
    const v = smoke.api.prepareDamage(smoke.actor, smoke.scene.tokens.getName("Linked"), smoke.message);
    return {toughness: v.toughness, damage: v.damage, base: smoke.actor.system.stats.toughness.value};
  }), {toughness: 8, damage: 12, base: 4});
  await gm.reload(); await ready(gm); await bind(gm);
  assert.equal(await gm.evaluate(() => smoke.actor.system.stats.toughness.value), 4);
  assert.equal(await gm.evaluate(uuid => smoke.api.prepareDamage(smoke.actor, smoke.scene.tokens.getName("Linked"), fromUuidSync(uuid)).toughness, fireUuid), 8);
  pass("conditional defenses and persisted roll context remain correct after reload");

  const targetResults = await gm.evaluate(async prefix => {
    const actors = await Actor.createDocuments(["insect", "elf"].map(tag => ({name: `${prefix} ${tag}`, type: "npc", flags: {"swade-better-effects": {tags: [tag]}}})));
    await smoke.actor.createEmbeddedDocuments("ActiveEffect", [{name: "Insect Slayer", flags: {"swade-better-effects": {rules: [
      {selector: "outgoing-damage", type: "add", value: 4, predicate: {op: "flag", source: "target", flag: "insect"}}
    ]}}}]);
    const cls = CONFIG.Dice.rolls.find(c => c.name === "DamageRoll"); const roll = new cls("12"); smoke.api.tagRoll(roll, ["fire"], {actor: smoke.actor}); await roll.evaluate();
    const message = await roll.toMessage();
    const damage = actors.map(actor => smoke.api.prepareDamage(actor, null, message).damage);
    await smoke.actor.createEmbeddedDocuments("ActiveEffect", [{name: "Werewolf resistance", flags: {"swade-better-effects": {rules: [
      {selector: "incoming-damage", type: "multiply", value: .5, predicate: {op: "not", child: {op: "flag", source: "roll", flag: "silver"}}}
    ]}}}]);
    const regular = smoke.api.prepareDamage(smoke.actor, null, message).damage;
    const context = structuredClone(message.getFlag("swade-better-effects", "context")); context.roll.push("silver"); await message.setFlag("swade-better-effects", "context", context);
    return {damage, regular, silver: smoke.api.prepareDamage(smoke.actor, null, message).damage};
  }, prefix);
  assert.deepEqual(targetResults, {damage: [16, 12], regular: 6, silver: 12});
  pass("per-target insect bonuses and non-silver resistance on real SWADE documents");

  const playerName = `${prefix} Player`;
  await gm.evaluate(async name => {
    const player = await User.create({name, role: 1, character: smoke.actor.id});
    await smoke.actor.update({[`ownership.${player.id}`]: 3});
  }, playerName);
  const player = await join(playerName); await bind(player);
  await gm.waitForFunction(name => game.users.getName(name)?.active, playerName);
  await roll(gm, 24);
  await gm.evaluate(async () => { canvas.tokens.get(smoke.scene.tokens.getName("Linked").id).setTarget(true, {releaseOthers: true}); await smoke.api.resolveMessageDamage(smoke.message); });
  await player.locator(".sbe-targeted-adapter").waitFor();
  assert.deepEqual(await player.evaluate(() => {
    const app = [...foundry.applications.instances.values()].find(a => a.sbeKey);
    return {damage: app.sbeValues.damage, toughness: app.sbeValues.toughness, wounds: app.object.wounds};
  }), {damage: 12, toughness: 8, wounds: 1});
  await player.locator('[name="damage"]').fill("32");
  await player.locator(".submit-input-change").click();
  await player.waitForFunction(() => [...foundry.applications.instances.values()].find(a => a.sbeKey)?.sbeValues.damage === 16);
  await player.locator(".sbe-damage-summary").filter({hasText: "Damage 16"}).waitFor();
  await player.locator('[name="damage"]').fill("24");
  await player.locator(".submit-input-change").click();
  await player.waitForFunction(() => [...foundry.applications.instances.values()].find(a => a.sbeKey)?.object.wounds === 1);
  await player.locator('[data-action="takeWounds"]').click();
  await player.locator(".sbe-targeted-adapter").waitFor({state: "hidden"});
  await gm.waitForFunction(() => smoke.actor.system.wounds.value === 1);
  assert.equal(await gm.evaluate(() => smoke.actor.system.stats.toughness.value), 4);
  pass("Targeted Damage hands off context to a player and applies the correct wound");

  const whisperUuid = await roll(gm, 32, ["fire"], true);
  await gm.evaluate(() => smoke.api.resolveMessageDamage(smoke.message));
  await player.locator(".sbe-targeted-adapter").waitFor();
  assert.deepEqual(await player.evaluate(uuid => {
    const app = [...foundry.applications.instances.values()].find(a => a.sbeKey);
    return {visible: !!game.messages.get(uuid.split(".").at(-1))?.isContentVisible, damage: app.sbeValues.damage, toughness: app.sbeValues.toughness};
  }, whisperUuid), {visible: false, damage: 16, toughness: 8});
  pass("whispered damage handoff works without exposing the original message");

  await gm.evaluate(async () => {
    const config = {...game.settings.get("core", "moduleConfiguration"), "swade-targeted-damage": false};
    await game.settings.set("core", "moduleConfiguration", config);
  });
  await player.close(); await gm.reload(); await ready(gm); await bind(gm);
  await roll(gm, 24);
  await gm.evaluate(async () => {
    canvas.tokens.get(smoke.scene.tokens.getName("Linked").id).control({releaseOthers: true});
    await smoke.api.resolveMessageDamage(smoke.message);
  });
  await gm.locator('[data-action="freeSoak"]').waitFor();
  assert.deepEqual(await gm.evaluate(() => {
    const app = [...foundry.applications.instances.values()].find(a => a.sbeKey);
    return {name: app.constructor.name, damage: app.values.damage, toughness: app.values.toughness, wounds: app.remaining};
  }), {name: "ConditionalDamageApplicator", damage: 12, toughness: 8, wounds: 1});
  await gm.locator('[data-action="freeSoak"]').click();
  await gm.getByRole("button", {name: "Roll", exact: true}).click();
  await gm.waitForFunction(() => [...foundry.applications.instances.values()].find(a => a.sbeKey)?.attemptedSoak);
  await gm.getByText(/Best soak:.*wound/).waitFor();
  const expected = await gm.evaluate(() => {
    const app = [...foundry.applications.instances.values()].find(a => a.sbeKey);
    return Math.min(smoke.actor.system.wounds.max, smoke.actor.system.wounds.value + app.remaining);
  });
  await gm.locator('[data-action="take"]').click();
  await gm.locator('[data-action="take"]').waitFor({state: "hidden"});
  await gm.waitForFunction(expected => smoke.actor.system.wounds.value === expected, expected);
  assert.equal(await gm.evaluate(() => smoke.actor.system.stats.toughness.value), 4);
  pass("standalone resolver, native Vigor soak roll, and damage application");
  assert.deepEqual(errors, []);
  pass("no browser JavaScript errors");
  await gm.evaluate(() => game.settings.set("core", "moduleConfiguration", {...game.settings.get("core", "moduleConfiguration"), "swade-targeted-damage": true}));
} finally {
  await browser.close();
}
