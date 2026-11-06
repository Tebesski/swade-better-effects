// Native + SWADE Tools chat accordions, with real GM/Assistant/player clients.
// Run only against the disposable effects-qa world.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const id = "swade-better-effects", prefix = `Chat flags ${Date.now()}`, errors = [];
const pass = text => console.log(`PASS ${text}`);
async function ready(page) {
  try { await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, {timeout: 60000}); }
  catch (error) { console.error("Client load failure", page.url(), (await page.locator("body").innerText()).slice(-1500), errors); throw error; }
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa");
  await page.addStyleTag({content: "#notifications{pointer-events:none!important}"});
}
async function join(name) {
  const page = await (await browser.newContext({viewport: {width: 1440, height: 1100}})).newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && m.text().includes(id)) errors.push(m.text()); });
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: name});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready(page);
  await page.locator('#sidebar-tabs [data-tab="chat"]').click();
  return page;
}
const card = (page, messageId) => page.locator(`#chat .chat-message[data-message-id="${messageId}"]`);
async function check(page, messageId, gm) {
  await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); });
  const message = card(page, messageId), roll = message.locator(".sbe-chat-roll-flags");
  await roll.locator("summary").waitFor();
  assert.equal(await roll.evaluate(el => el.open), false);
  assert.equal(await roll.locator(".sbe-flag").first().isVisible(), false);
  assert.equal(await roll.locator("button").count(), 0);
  await roll.locator("summary").click();
  assert.ok((await roll.locator(".sbe-flag").allTextContents()).includes("fire"));
  await roll.locator("summary").click();
  const target = message.locator(".sbe-chat-target-flags");
  assert.equal(await target.count(), gm ? 1 : 0);
  if (gm) {
    assert.equal(await target.evaluate(el => el.open), false);
    assert.equal(await target.locator(".sbe-flag").first().isVisible(), false);
    await target.locator("summary").click();
    assert.deepEqual(await target.locator("strong").allTextContents(), ["Elf target", "Insect target"]);
    assert.deepEqual(await target.locator(".sbe-flag").allTextContents(), ["elf", "secret-ward", "token-ward", "insect"]);
    assert.equal(await target.evaluate(el => el.parentElement.matches(".chat-message")), true);
    assert.equal(await target.evaluate(el => [...el.parentElement.children].every(child => child === el || child.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + 1)), true);
    await target.locator("summary").click();
  } else assert.ok(!(await message.textContent()).includes("secret-ward"));
}
try {
  const gm = await join("Gamemaster");
  await gm.evaluate(async id => {
    await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-tools": true, "swade-targeted-damage": true});
    await game.settings.set("core", "noCanvas", false);
  }, id);
  await gm.reload(); await ready(gm);
  await gm.evaluate(async ({id, prefix}) => {
    globalThis.cf = {api: game.modules.get(id).api};
    cf.actor = await Actor.create({name: prefix, type: "npc", items: [
      {name: "Fighting", type: "skill", system: {swid: "fighting", attribute: "agility", die: {sides: 8}}},
      {name: "Fire Sword", type: "weapon", system: {damage: "6+5", equipStatus: 4}, flags: {[id]: {tags: ["fire"]}}}
    ]});
    cf.weapon = cf.actor.items.getName("Fire Sword");
    const elf = await Actor.create({name: `${prefix} elf`, type: "npc", flags: {[id]: {tags: ["elf", "secret-ward"]}}});
    const insect = await Actor.create({name: `${prefix} insect`, type: "npc", flags: {[id]: {tags: ["insect"]}}});
    cf.scene = await Scene.create({name: prefix, active: true, width: 1200, height: 900, padding: 0,
      tokens: [{name: "Elf target", actorId: elf.id, actorLink: true, x: 200, y: 200, flags: {[id]: {tags: ["token-ward"]}}},
        {name: "Insect target", actorId: insect.id, actorLink: true, x: 400, y: 200}]});
    await cf.scene.view();
    await User.create({name: `${prefix} Assistant`, role: CONST.USER_ROLES.ASSISTANT});
    await User.create({name: `${prefix} Player`, role: CONST.USER_ROLES.PLAYER});
  }, {id, prefix});
  await gm.waitForFunction(() => canvas.tokens?.placeables.some(t => t.name === "Elf target"));
  const assistant = await join(`${prefix} Assistant`), player = await join(`${prefix} Player`);
  await gm.evaluate(() => {
    for (const token of canvas.tokens.placeables) token.setTarget(true, {releaseOthers: false});
  });
  const damageId = await gm.evaluate(async () => {
    const roll = new (CONFIG.Dice.rolls.find(c => c.name === "DamageRoll"))("6+5");
    cf.api.tagRoll(roll, ["fire"], {actor: cf.actor, item: cf.weapon}); await roll.evaluate();
    cf.damage = await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: cf.actor})}); return cf.damage.id;
  });
  for (const [page, isGM] of [[gm, true], [assistant, true], [player, false]]) await check(page, damageId, isGM);
  assert.equal(await gm.evaluate(id => JSON.stringify(game.messages.get(id).toObject()).includes("secret-ward"), damageId), false);
  pass("native damage flags start collapsed; both targets appear at the bottom for GM and Assistant, with no target flags in player DOM or saved message data");
  const traitId = await gm.evaluate(async () => {
    const roll = await cf.actor.rollSkill(cf.actor.items.getName("Fighting").id, {item: cf.weapon, suppressChat: true});
    cf.trait = await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: cf.actor})}); return cf.trait.id;
  });
  await check(gm, traitId, true); await check(player, traitId, false);
  pass("trait/attack chat uses the same collapsed accordions and permissions");
  const toolsId = await gm.evaluate(async () => {
    const {default: ItemRoll} = await import("/modules/swade-tools/scripts/class/ItemRoll.js");
    const roll = new ItemRoll(cf.actor, cf.weapon); roll.useTarget(canvas.tokens.placeables.find(token => token.name === "Elf target").id);
    await roll.rollBaseDamage(); const created = new Promise(resolve => Hooks.once("createChatMessage", resolve));
    roll.display(); await created;
    cf.tools = game.messages.contents.at(-1); return cf.tools.id;
  });
  // SWADE Tools may select a subset in its own target field. Native roll metadata
  // is used when that field is absent; inspect both roles against the saved card.
  await card(gm, toolsId).locator(".sbe-chat-roll-flags > summary").waitFor();
  assert.equal(await card(gm, toolsId).locator(".sbe-chat-roll-flags").evaluate(el => el.open), false);
  assert.equal(await card(player, toolsId).locator(".sbe-chat-target-flags").count(), 0);
  assert.ok((await card(gm, toolsId).locator(".sbe-chat-target-flags .sbe-flag").allTextContents()).includes("secret-ward"));
  await card(gm, toolsId).locator(".swadetools-targetname").first().waitFor();
  assert.equal(await card(gm, toolsId).locator(".sbe-chat-target-flags").evaluate(el => [...el.parentElement.children].every(child => child === el || child.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + 1)), true);
  pass("SWADE Tools cards also retain collapsed flag accordions and GM-only target flags");
  if (process.env.FOUNDRY_QA_SCREENSHOTS) {
    await card(gm, damageId).screenshot({path: `${process.env.FOUNDRY_QA_SCREENSHOTS}/chat-flags-collapsed.png`});
    await card(gm, damageId).locator(".sbe-chat-target-flags > summary").click();
    await card(gm, damageId).screenshot({path: `${process.env.FOUNDRY_QA_SCREENSHOTS}/chat-target-flags.png`});
  }
  await gm.reload(); await ready(gm); await check(gm, damageId, true);
  pass("saved chat cards reopen collapsed after reload");
  assert.deepEqual(errors, []); pass("no browser JavaScript errors across three clients");
} finally { await browser.close(); }
