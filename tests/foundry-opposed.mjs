// Actual AEGIS Skills row, opposed chooser, native rolls, rerolls and permissions.
// Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const id = "swade-better-effects", prefix = `Opposed ${Date.now()}`, errors = [], shots = process.env.FOUNDRY_QA_SCREENSHOTS;
const pass = text => console.log(`PASS ${text}`);
async function ready(page) {
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications{pointer-events:none!important}"});
  await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); });
}
async function join(name) {
  const page = await (await browser.newContext({viewport: {width: 1440, height: 1100}})).newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  page.on("console", msg => { if (msg.type() === "error" && msg.text().includes(id)) errors.push(msg.text()); });
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: name}); await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready(page); return page;
}
const card = (page, messageId) => page.locator(`#chat .chat-message[data-message-id="${messageId}"]`);
async function source(page, {total = 9, targets = true, tools = false, whisper = false} = {}) {
  return page.evaluate(async ({total, targets, tools, whisper}) => {
    const {makeContext, setRollContext} = await import("/modules/swade-better-effects/scripts/roll-context.mjs");
    for (const token of [...game.user.targets]) token.setTarget(false);
    if (targets) for (const name of ["Wrestler", "Scout"]) canvas.tokens.placeables.find(token => token.name === name).setTarget(true, {releaseOthers: false});
    const roll = new (CONFIG.Dice.rolls.find(cls => cls.name === "TraitRoll"))(`{1d8min${total}max${total}}kh`);
    setRollContext(roll, makeContext(op.attacker, op.grapple, [], {kind: "trait", skill: op.attacker.items.getName("Fighting")})); await roll.evaluate();
    const flags = tools ? {"swade-tools": {rolltype: "skill", useactor: op.attacker.id, itemroll: op.grapple.id, skill: "Fighting", userof: 1, usetarget: op.target.id, gmmod: 3}} : {};
    const message = await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: op.attacker}), flags, ...(whisper ? {whisper: [game.user.id]} : {})}, {messageMode: whisper ? "gm" : "public"});
    op.source = message; return message.id;
  }, {total, targets, tools, whisper});
}
async function chooseAthletics(page, messageId, expectedBonus = true) {
  await card(page, messageId).locator(".sbe-oppose-roll").click(); const chooser = page.locator(".sbe-opposed-chooser"); await chooser.waitFor();
  await chooser.getByLabel("Search traits", {exact: true}).fill("ath");
  await chooser.getByRole("button", {name: /^Athletics/}).click(); await chooser.waitFor({state: "hidden"});
  const dialog = page.locator(".roll-dialog"); await dialog.waitFor();
  const rows = dialog.locator(".modifiers .modifier-entry").filter({hasText: "Grapple training"}); assert.equal(await rows.count(), expectedBonus ? 1 : 0);
  if (expectedBonus) { assert.match(await rows.textContent(), /1/); assert.equal(await rows.locator('input[type="checkbox"]').isChecked(), true); }
  assert.equal(await dialog.locator(".modifiers .modifier-entry").filter({hasText: "Attack only"}).count(), 0);
  return dialog;
}
async function closeRoll(page) { await page.evaluate(async () => { await [...foundry.applications.instances.values()].find(app => app.element?.classList.contains("roll-dialog")).close(); }); }
async function submit(page, dialog) {
  const previous = await page.evaluate(() => game.messages.contents.at(-1)?.id);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click(); await dialog.waitFor({state: "hidden"});
  await page.waitForFunction(previous => game.messages.contents.at(-1)?.id !== previous, previous);
  return page.evaluate(() => game.messages.contents.at(-1).id);
}
async function checkResponse(page, messageId, sourceId, tn) {
  const data = await page.evaluate(({messageId, id}) => {
    const message = game.messages.get(messageId), roll = message.significantRoll, context = message.getFlag(id, "context");
    return {tn: roll.options.targetNumber, source: context.opposition.messageUuid, flags: context.roll,
      applied: context.traitApplied, target: context.targetUuids, speaker: message.speaker.token,
      bonus: roll.modifiers?.filter(mod => mod.label === "Grapple training").map(mod => Number(mod.value)),
      total: roll.total, crit: !!roll.isCritfail, contextTN: context.opposition.targetNumber};
  }, {messageId, id});
  assert.equal(data.tn, tn); assert.equal(data.contextTN, tn); assert.equal(data.source, `ChatMessage.${sourceId}`);
  assert.ok(data.flags.includes("grapple") && data.flags.includes("opposed") && data.flags.includes("athletics"));
  assert.equal(data.applied, 1);
  assert.deepEqual(data.bonus, [1]);
  const summary = await card(page, messageId).locator(".sbe-opposed-result").textContent(); assert.match(summary, new RegExp(`TN ${tn}`));
  assert.ok(summary.includes(data.crit ? "Critical failure" : data.total < tn ? "Failure" : "Success"));
  return data;
}
let gm;
try {
  gm = await join("Gamemaster");
  const invalidFixtures = await gm.evaluate(async () => {
    const invalid = game.messages.filter(message => game.actors.get(message.speaker.actor)?.name.startsWith("Opposed ")
      && message.significantRoll?.constructor.name === "TraitRoll" && !message.significantRoll.dice.length);
    for (const message of invalid) await message.delete(); return invalid.length;
  });
  if (invalidFixtures) errors.splice(0);
  await gm.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true}); await game.settings.set("core", "noCanvas", false); }, id);
  await gm.reload(); await ready(gm);
  await gm.evaluate(async ({id, prefix}) => {
    const {changeSignature} = await import("/modules/swade-better-effects/scripts/rules.mjs");
    globalThis.op = {api: game.modules.get(id).api};
    op.attacker = await Actor.create({name: `${prefix} Attacker`, type: "npc", items: [{name: "Fighting", type: "skill", system: {swid: "fighting", attribute: "agility", die: {sides: 8}}}, {name: "Grapple", type: "weapon", system: {rangeType: 0}}]});
    op.grapple = op.attacker.items.getName("Grapple");
    const change = {key: "system.stats.globalMods.attack", type: "add", value: "8", phase: "initial", priority: null};
    op.actor = await Actor.create({name: `${prefix} Wrestler`, type: "character", items: [{name: "Athletics", type: "skill", system: {swid: "athletics", attribute: "agility", die: {sides: 8}}}, {name: "Fighting", type: "skill", system: {swid: "fighting", attribute: "agility"}}],
      effects: [{name: "Attack only", system: {changes: [change]}, flags: {[id]: {conditions: [{signature: changeSignature(change), predicate: {op: "flag", source: "roll", flag: "grapple"}}]}}}]});
    op.scout = await Actor.create({name: `${prefix} Scout`, type: "character", items: [{name: "Stealth", type: "skill", system: {swid: "stealth", attribute: "agility"}}]});
    const scene = await Scene.create({name: prefix, active: true, width: 1400, height: 900, padding: 0, tokens: [
      {name: "Attacker", actorId: op.attacker.id, actorLink: true, x: 600, y: 200}, {name: "Wrestler", actorId: op.actor.id, actorLink: true, x: 200, y: 200}, {name: "Scout", actorId: op.scout.id, actorLink: true, x: 900, y: 200}]}); await scene.view();
    op.api.openAegis(op.actor);
  }, {id, prefix});
  await gm.waitForFunction(() => canvas.tokens?.placeables.some(t => t.name === "Wrestler"));
  await gm.evaluate(() => { op.target = canvas.tokens.placeables.find(t => t.name === "Wrestler"); });
  const aegis = gm.locator(".sbe-aegis"); await aegis.waitFor(); await aegis.locator('[name="name"]').fill("Grapple training");
  await aegis.locator('[data-category="skill"] > summary').click(); await aegis.locator('[name="currSkill"]').fill("Athletics");
  await aegis.locator('[data-category="skill"] button').first().click(); await aegis.getByLabel("Change", {exact: true}).selectOption("@Skill{Athletics}[system.die.modifier]");
  await aegis.locator("input.value").fill("1"); await aegis.locator(".sbe-condition-details > summary").click(); await aegis.locator('[data-condition-action="add-condition"]').click();
  await aegis.getByLabel("Flag", {exact: true}).fill("grapple"); await aegis.getByLabel("Flag", {exact: true}).press("Tab");
  await aegis.locator('button[type="submit"]').click(); await aegis.waitFor({state: "hidden"});
  pass("the bonus is authored through the existing AEGIS Skills → Athletics → Modifier entry with IF Roll has flag grapple");
  const noTargetId = await source(gm, {targets: false}); await card(gm, noTargetId).locator(".sbe-chat-roll-flags > summary").waitFor(); assert.equal(await card(gm, noTargetId).locator(".sbe-oppose-roll").count(), 0);
  const sourceId = await source(gm); const sourceCard = card(gm, sourceId); await sourceCard.locator(".sbe-oppose-roll").waitFor();
  assert.equal(await sourceCard.locator(".sbe-oppose-roll").evaluate(button => button.nextElementSibling.classList.contains("sbe-chat-roll-flags") && button.getBoundingClientRect().top >= button.closest(".chat-message").querySelector(".dice-total").getBoundingClientRect().bottom), true);
  await gm.evaluate(() => { for (const target of [...game.user.targets]) target.setTarget(false); canvas.tokens.placeables.find(t => t.name === "Scout").setTarget(true); });
  await sourceCard.locator(".sbe-oppose-roll").click(); let chooser = gm.locator(".sbe-opposed-chooser"); await chooser.waitFor();
  assert.equal(await chooser.locator('[data-trait-group="attributes"] .sbe-trait-choice').count(), 5);
  assert.equal(await chooser.locator('[data-trait-group="skills"] .sbe-trait-choice').count(), 2);
  await chooser.getByLabel("Search traits", {exact: true}).fill("agi"); assert.equal(await chooser.locator('[data-trait-group="skills"]').isVisible(), false);
  await chooser.getByLabel("Search traits", {exact: true}).fill("ath"); assert.equal(await chooser.locator('[data-trait-group="attributes"]').isVisible(), false);
  const scoutUuid = await gm.evaluate(() => canvas.tokens.placeables.find(t => t.name === "Scout").document.uuid), targetUuid = await gm.evaluate(() => op.target.document.uuid);
  await chooser.getByLabel("Target", {exact: true}).selectOption(scoutUuid); await chooser.locator(".sbe-no-traits").waitFor();
  await chooser.getByLabel("Target", {exact: true}).selectOption(targetUuid); await chooser.getByRole("button", {name: /^Athletics/}).waitFor();
  await chooser.getByLabel("Search traits", {exact: true}).fill("");
  if (shots) await chooser.screenshot({path: `${shots}/opposed-trait-chooser.png`, animations: "disabled"});
  await chooser.getByRole("button", {name: /^Athletics/}).click(); await chooser.waitFor({state: "hidden"});
  let dialog = gm.locator(".roll-dialog"); await dialog.waitFor(); assert.match(await dialog.locator(".sbe-opposed-tn").textContent(), /9/);
  assert.equal(await dialog.locator(".modifiers .modifier-entry").filter({hasText: "Grapple training"}).count(), 1);
  assert.equal(await dialog.locator(".modifiers .modifier-entry").filter({hasText: "Attack only"}).count(), 0);
  if (shots) await dialog.screenshot({path: `${shots}/opposed-roll-bonus.png`, animations: "disabled"});
  const responseId = await submit(gm, dialog), data = await checkResponse(gm, responseId, sourceId, 9);
  assert.equal(data.speaker, await gm.evaluate(() => op.target.id)); assert.deepEqual(data.target, [await gm.evaluate(() => canvas.tokens.placeables.find(t => t.name === "Attacker").document.uuid)]);
  pass("the targeted card places Oppose roll above Flags; searchable separate groups choose the correct actor, applying +1 Athletics against TN 9 without an attack-only bonus");
  await card(gm, responseId).locator("button.free-reroll").click(); await gm.waitForFunction(previous => game.messages.contents.at(-1).id !== previous, responseId);
  await checkResponse(gm, await gm.evaluate(() => game.messages.contents.at(-1).id), sourceId, 9); pass("native rerolls keep the opposed TN, source flags and response context");
  await gm.evaluate(() => op.actor.effects.getName("Grapple training").update({disabled: true})); dialog = await chooseAthletics(gm, sourceId, false); await closeRoll(gm);
  await gm.evaluate(async () => { await op.actor.effects.getName("Grapple training").update({disabled: false}); await op.grapple.update({name: "Shove"}); });
  dialog = await chooseAthletics(gm, sourceId); await closeRoll(gm);
  const shoveId = await source(gm, {total: 5}); dialog = await chooseAthletics(gm, shoveId, false); await closeRoll(gm);
  pass("inactive bonuses and non-grapple rolls do not match; old grapple cards retain their flags after the item is renamed");
  await gm.evaluate(async ({prefix}) => { const player = await User.create({name: `${prefix} Player`, role: 1}); await op.actor.update({[`ownership.${player.id}`]: 3}); }, {prefix});
  const player = await join(`${prefix} Player`); await card(player, sourceId).locator(".sbe-oppose-roll").waitFor(); assert.equal(await card(player, sourceId).locator(".sbe-oppose-roll").isEnabled(), true);
  await card(player, sourceId).locator(".sbe-oppose-roll").click(); chooser = player.locator(".sbe-opposed-chooser"); await chooser.waitFor(); assert.equal(await chooser.locator('select[name="target"]').count(), 0);
  await chooser.getByLabel("Search traits", {exact: true}).fill("strength"); await chooser.getByRole("button", {name: /^Strength/}).click();
  const playerResponseId = await submit(player, player.locator(".roll-dialog"));
  assert.equal(await player.evaluate(messageId => game.messages.get(messageId).significantRoll.targetNumber, playerResponseId), 9);
  assert.equal(await player.evaluate(messageId => game.messages.get(messageId).speaker.actor, playerResponseId), await gm.evaluate(() => op.actor.id));
  const privateId = await source(gm, {whisper: true}); dialog = await chooseAthletics(gm, privateId, false); assert.equal(await dialog.locator("#messageMode").isDisabled(), true);
  const privateResponse = await submit(gm, dialog); assert.deepEqual(await gm.evaluate(messageId => game.messages.get(messageId).whisper, privateResponse), [await gm.evaluate(() => game.user.id)]);
  assert.equal(await player.evaluate(messageId => game.messages.get(messageId).isContentVisible, privateId), false);
  assert.equal(await player.evaluate(messageId => game.messages.get(messageId).isContentVisible, privateResponse), false);
  assert.equal(await card(player, privateId).locator(".sbe-oppose-roll,.sbe-opposed-result,.sbe-chat-flags").count(), 0);
  assert.equal(await card(player, privateResponse).locator(".sbe-oppose-roll,.sbe-opposed-result,.sbe-chat-flags").count(), 0);
  pass("target owners can choose their own attributes or skills; private rolls and their opposed responses retain their recipients");
  await player.context().close();
  await gm.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-tools": true}); }, id); await gm.reload(); await ready(gm);
  await gm.evaluate(({id, prefix}) => { globalThis.op = {api: game.modules.get(id).api, attacker: game.actors.getName(`${prefix} Attacker`), actor: game.actors.getName(`${prefix} Wrestler`)}; op.grapple = op.attacker.items.contents.find(item => item.type === "weapon"); op.target = canvas.tokens.placeables.find(t => t.name === "Wrestler"); }, {id, prefix});
  await gm.evaluate(() => op.grapple.update({name: "Grapple"}));
  const toolsId = await source(gm, {total: 6, tools: true}); dialog = await chooseAthletics(gm, toolsId); assert.match(await dialog.locator(".sbe-opposed-tn").textContent(), /9/);
  await checkResponse(gm, await submit(gm, dialog), toolsId, 9);
  pass("SWADE Tools source cards include their GM adjustment in the TN and preserve grapple conditions");
  if (shots) await card(gm, toolsId).screenshot({path: `${shots}/opposed-source-card.png`, animations: "disabled"});
  assert.deepEqual(errors, []); pass("no browser JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors);
  if (shots && gm) await gm.screenshot({path: `${shots}/opposed-failure.png`}).catch(() => {});
  throw error;
} finally { await browser.close(); }
