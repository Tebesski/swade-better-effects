// Real SWADE Tools + Targeted Damage regression. Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", msg => { if (msg.type() === "error" && msg.text().includes("swade-better-effects")) errors.push(msg.text()); });
const pass = text => console.log(`PASS ${text}`);
const id = "swade-better-effects";

async function ready() {
  await page.waitForFunction(() => game?.ready && canvas?.ready, null, {timeout: 60000});
  assert.equal(await page.evaluate(() => game.world.id), "effects-qa", "Refusing to change a non-test world");
  await page.addStyleTag({content: "#notifications {pointer-events:none!important}"});
}
async function bind() {
  await page.evaluate(() => { globalThis.qa = {api: game.modules.get("swade-better-effects").api,
    actor: game.actors.getName("Damage QA Defender"), attacker: game.actors.getName("Damage QA Attacker")};
    qa.weapon = qa.attacker.items.getName("Fire Longsword"); qa.token = canvas.tokens.placeables.find(t => t.actor?.id === qa.actor.id);
    qa.token.setTarget(true, {releaseOthers: true}); });
}
function card(messageId) { return page.locator(`#chat .chat-message[data-message-id="${messageId}"]`); }
async function createNative() {
  await page.evaluate(() => { qa.pending = qa.weapon.rollDamage(); });
  await page.getByRole("button", {name: "Roll", exact: true}).click();
  return page.evaluate(async () => {
    await qa.pending;
    qa.message = game.messages.contents.at(-1);
    await qa.message.update({"flags.swade-tools": {rolltype: "damage", itemroll: qa.weapon.id, useactor: qa.attacker.id, usetarget: qa.token.id, userof: 1}});
    return qa.message.id;
  });
}
async function closeResolver() { await page.evaluate(async () => { for (const app of foundry.applications.instances.values()) if (app.sbeKey) await app.close(); }); }

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await ready();
  await page.evaluate(async id => {
    await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-tools": true, "swade-targeted-damage": true});
    await game.settings.set("core", "noCanvas", false);
  }, id);
  await page.reload(); await ready();
  await page.locator('#sidebar-tabs [data-tab="chat"]').click();
  await page.evaluate(async id => {
    const {changeSignature} = await import("/modules/swade-better-effects/scripts/rules.mjs");
    const change = {key: "system.stats.toughness.value", type: "add", value: "4", phase: "initial", priority: null};
    for (const actor of game.actors.filter(a => ["Damage QA Defender", "Damage QA Attacker"].includes(a.name))) await actor.delete();
    const actor = await Actor.create({name: "Damage QA Defender", type: "character", system: {attributes: {vigor: {die: {sides: 8}}}},
      effects: [{name: "Fire Ward", system: {changes: [change]}, flags: {[id]: {conditions: [{signature: changeSignature(change),
        predicate: {op: "flag", source: "roll", flag: "fire"}}]}}}]});
    const attacker = await Actor.create({name: "Damage QA Attacker", type: "npc", items: [
      {name: "Fire Longsword", type: "weapon", system: {damage: "6+5", ap: 0}, flags: {[id]: {tags: ["fire"]}}}
    ]});
    const scene = await Scene.create({name: `Damage QA ${Date.now()}`, active: true, width: 1200, height: 900, padding: 0,
      grid: {type: 1, size: 100}, tokens: [{name: "Player Character", actorId: actor.id, actorLink: true, x: 200, y: 200},
        {name: "NPC", actorId: attacker.id, actorLink: true, x: 500, y: 200}]});
    await scene.view();
  }, id);
  await page.waitForFunction(() => canvas.tokens?.placeables.some(t => t.name === "Player Character"));
  await bind();
  assert.equal(await page.evaluate(() => qa.actor.system.stats.toughness.value), 6);
  const nativeId = await createNative();
  const native = card(nativeId);
  await native.locator(".swadetools-targetname").waitFor();
  assert.equal(await native.locator(".swadetools-targetname").textContent(), "Player Character: Shaken");
  assert.match(await native.locator(".swadetools-targetname").getAttribute("data-tooltip"), /Damage 11 vs Toughness 10/);
  assert.ok((await native.locator(".sbe-flag").allTextContents()).includes("fire"));
  assert.equal(await native.locator(".swadetools-applydamage").getAttribute("data-swadetools-raise"), "0");
  assert.equal(await native.locator(".swadetools-soakdamage").count(), 0);
  pass("native weapon roll: fire flag gives Toughness 10; 11 damage displays Shaken, zero wounds");
  const geometry = await native.evaluate(el => {
    const box = selector => {const r = el.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
    return {total: box(".dice-total"), flags: box(".sbe-chat-roll-flags"), controls: [...el.querySelectorAll(".swadetools-rollbutton")].map(b => {const r=b.getBoundingClientRect();return {y:r.y,bottom:r.bottom};})};
  });
  assert.ok(geometry.controls.every(r => r.y >= geometry.total.y && r.bottom <= geometry.total.bottom));
  assert.ok(geometry.flags.y >= geometry.total.bottom);
  assert.equal(await native.locator(".sbe-chat-target-flags").evaluate(el => el.parentElement.matches(".chat-message") && [...el.parentElement.children].every(child => child === el || child.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + 1)), true);
  pass("chat controls stay inside the total and do not overlap the flags");
  if (process.env.FOUNDRY_QA_SCREENSHOTS) await native.screenshot({path:`${process.env.FOUNDRY_QA_SCREENSHOTS}/fire-card-fixed.png`,animations:"disabled"});
  await native.locator("button.calculate-wounds").click();
  await page.locator(".sbe-targeted-adapter").waitFor();
  assert.deepEqual(await page.evaluate(() => { const app=[...foundry.applications.instances.values()].find(a=>a.sbeKey);
    return {toughness: app.sbeValues.toughness, damage: app.sbeValues.damage, wounds: app.object.wounds, status: app.object.statusToApply}; }),
  {toughness: 10, damage: 11, wounds: 0, status: "shaken"});
  await page.locator('.sbe-targeted-adapter [data-action="applyShaken"]').click();
  await page.waitForFunction(() => qa.actor.system.status.isShaken);
  assert.equal(await page.evaluate(() => qa.actor.system.wounds.value), 0);
  await page.evaluate(() => qa.actor.toggleActiveEffect("shaken", {active: false}));
  pass("Targeted Damage resolves and applies Shaken with no wound");
  await native.locator(".swadetools-freereroll").click();
  await page.waitForFunction(oldId => game.messages.contents.at(-1).id !== oldId && game.messages.contents.at(-1).flags["swade-tools"]?.rolltype === "damage", nativeId);
  const rerollId = await page.evaluate(() => {qa.reroll=game.messages.contents.at(-1);return qa.reroll.id;});
  const reroll = card(rerollId);
  await reroll.locator(".swadetools-targetname").waitFor();
  assert.ok((await reroll.locator(".sbe-flag").allTextContents()).includes("fire"));
  assert.equal(await reroll.locator(".swadetools-targetname").textContent(), "Player Character: Shaken");
  pass("SWADE Tools reroll retains the fire flag and conditional defense");
  await reroll.locator(".swadetools-applydamage").click();
  await page.waitForFunction(() => qa.actor.system.status.isShaken);
  assert.equal(await page.evaluate(() => qa.actor.system.wounds.value), 0);
  await page.evaluate(() => qa.actor.toggleActiveEffect("shaken", {active: false}));
  pass("SWADE Tools' own Apply Damage button also applies zero wounds");
  await page.evaluate(async () => {const ctx=structuredClone(qa.reroll.getFlag("swade-better-effects","context"));ctx.roll=["cold"];await qa.reroll.setFlag("swade-better-effects","context",ctx);});
  await page.waitForFunction(id => document.querySelector(`[data-message-id="${id}"] .swadetools-applydamage`)?.dataset.swadetoolsRaise === "1", rerollId);
  await reroll.locator(".swadetools-freereroll").click();
  await page.waitForFunction(oldId => game.messages.contents.at(-1).id !== oldId && game.messages.contents.at(-1).flags["swade-tools"]?.rolltype === "damage", rerollId);
  const coldId = await page.evaluate(() => game.messages.contents.at(-1).id);
  await card(coldId).locator(".swadetools-targetname").waitFor();
  assert.equal(await card(coldId).locator(".sbe-chat-roll-flags .sbe-flag").textContent(), "cold");
  assert.match(await card(coldId).locator(".swadetools-targetname").textContent(), /1 Wound/);
  pass("non-fire damage keeps base Toughness; manually edited flags survive rerolls");
  await page.evaluate(async () => {
    const {default: ItemRoll} = await import("/modules/swade-tools/scripts/class/ItemRoll.js");
    const roll=new ItemRoll(qa.attacker,qa.weapon);roll.useTarget(qa.token.id);await roll.rollBaseDamage();roll.display();
  });
  await page.waitForFunction(id => game.messages.contents.at(-1).id !== id && game.messages.contents.at(-1).flags["swade-tools"]?.rolltype === "damage", coldId);
  const toolsId = await page.evaluate(() => game.messages.contents.at(-1).id);
  await card(toolsId).locator(".swadetools-targetname").waitFor();
  assert.ok((await card(toolsId).locator(".sbe-flag").allTextContents()).includes("fire"));
  assert.equal(await card(toolsId).locator(".swadetools-targetname").textContent(), "Player Character: Shaken");
  pass("SWADE Tools' custom damage roll also snapshots weapon flags");
  const variants = await page.evaluate(async () => {
    const {default: RollControl} = await import("/modules/swade-tools/scripts/class/RollControl.js");
    const actor = await Actor.create({name: "Armor location QA", type: "character", system: {attributes: {vigor: {die: {sides: 8}}}},
      items: [{name: "Body armor", type: "armor", system: {armor: 2, equipStatus: 3, locations: {torso: true, head: false, arms: false, legs: false}}}],
      effects: [qa.actor.effects.contents[0].toObject()]});
    const [token] = await canvas.scene.createEmbeddedDocuments("Token", [{name: "Armored defender", actorId: actor.id, actorLink: true, x: 200, y: 500}]);
    await qa.weapon.update({"system.ap": 2});
    const {DamageRoll} = {DamageRoll: CONFIG.Dice.rolls.find(c=>c.name==="DamageRoll")};
    const roll = new DamageRoll("11", {}, {ap: 2});qa.api.tagRoll(roll, [], {actor:qa.attacker,item:qa.weapon});await roll.evaluate();
    const message = await roll.toMessage({speaker:ChatMessage.getSpeaker({actor:qa.attacker}),flags:{"swade-tools":{rolltype:"damage",useactor:qa.attacker.id,itemroll:qa.weapon.id,usetarget:token.id}}});
    const result=[];
    for (const area of ["torso","head"]) {
      await message.update({"flags.swade-tools.usecalled":area});
      const control = new RollControl(message,$("<li>"),game.user);control.damageTarget(token.object);
      const el=document.createElement("div");el.innerHTML=control.targetShow;
      result.push({area,raise:el.querySelector(".swadetools-applydamage")?.dataset.swadetoolsRaise,tooltip:el.querySelector(".swadetools-targetname")?.dataset.tooltip});
    }
    return {result,base:actor.system.stats.toughness.value,armor:actor.system.stats.toughness.armor};
  });
  assert.equal(variants.armor, 2);
  assert.equal(variants.base, 8);
  assert.ok(variants.result.every(v => v.raise === "0" && v.tooltip.includes("Toughness 10")));
  pass("conditional defense respects torso/head armor and AP without changing actor data");
  await page.evaluate(() => qa.weapon.update({"system.damage":"1d8+1d8", "system.ap":0}));
  const diceId = await createNative();
  await card(diceId).locator(".swadetools-freereroll").click();
  await page.waitForFunction(oldId => game.messages.contents.at(-1).id !== oldId && game.messages.contents.at(-1).flags["swade-tools"]?.rolltype === "damage", diceId);
  const diceReroll = card(await page.evaluate(() => game.messages.contents.at(-1).id));
  await diceReroll.locator(".swadetools-targetname").waitFor();
  assert.ok((await diceReroll.locator(".sbe-flag").allTextContents()).includes("fire"));
  assert.match(await diceReroll.locator(".swadetools-targetname").getAttribute("data-tooltip"), /Toughness 10/);
  pass("actual d8 damage dice retain conditional flags through SWADE Tools rerolls");
  assert.equal(await page.evaluate(() => qa.actor.system.stats.toughness.value), 6);
  if (process.env.FOUNDRY_QA_SCREENSHOTS) await page.screenshot({path:`${process.env.FOUNDRY_QA_SCREENSHOTS}/damage-fixed.png`,animations:"disabled"});
  assert.deepEqual(errors, []);
  pass("no browser errors and the actor's base Toughness remains 6");
} catch(error) {
  console.error("Browser errors:", errors);
  console.error((await page.locator("body").innerText()).slice(-3500));
  if (process.env.FOUNDRY_QA_SCREENSHOTS) await page.screenshot({path:`${process.env.FOUNDRY_QA_SCREENSHOTS}/damage-failure.png`}).catch(()=>{});
  throw error;
} finally { await closeResolver().catch(()=>{}); await browser.close(); }
