// Actual SWADE and generic Tools rolls, TNs, rerolls, and edited GM adjustments.
// Disposable effects-qa world only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}}); page.setDefaultTimeout(20000);
const id = "swade-better-effects", errors = [], shots = process.env.FOUNDRY_QA_SCREENSHOTS;
page.on("pageerror", error => errors.push(error.stack ?? error.message));
async function ready() { await page.waitForFunction(() => game?.ready, null, {timeout: 60000}); assert.equal(await page.evaluate(() => game.world.id), "effects-qa"); await page.addStyleTag({content: "#notifications {display:none!important}"}); await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); }); }
const card = key => page.locator(`#chat .chat-message[data-message-id="${key}"]`);
const outcomes = flags => flags.filter(flag => /^(?:success|fail|critical-failure|raise-\d+)$/.test(flag));
async function roll({total = 6, tn = 4, critical = false, tools = false, adjustment = 0, old} = {}) {
  return page.evaluate(async ({total, tn, critical, tools, adjustment, old, id}) => {
    const {makeContext, setRollContext} = await import("/modules/swade-better-effects/scripts/roll-context.mjs");
    const actor = game.actors.getName("Outcome QA");
    const Class = tools ? CONFIG.Dice.SwadeRoll : CONFIG.Dice.rolls.find(cls => cls.name === "TraitRoll");
    const formula = critical ? "{1d8min1max1,1d6min1max1[Wild Die]}kh+10" : `{1d8min${total}max${total}}kh`;
    const dice = new Class(formula, {}, {rollType: "trait", targetNumber: tn});
    let context = old ? structuredClone(game.messages.get(old).getFlag(id, "context")) : makeContext(actor, null, ["fire"], {kind: "trait", skill: actor.items.getName("Athletics"), attribute: "agility"});
    context.request = {targetNumber: tn}; setRollContext(dice, context); await dice.evaluate();
    const flags = tools ? {"swade-tools": {rolltype: "skill", useactor: actor.id, skill: "Athletics", userof: 1, gmmod: adjustment}} : {};
    const message = await dice.toMessage({speaker: ChatMessage.getSpeaker({actor}), flags}); return message.id;
  }, {total, tn, critical, tools, adjustment, old, id});
}
async function check(key, expected) {
  await card(key).locator(".sbe-chat-roll-flags").waitFor();
  await page.waitForFunction(({key, expected}) => {
    const flags = [...document.querySelectorAll(`#chat [data-message-id="${key}"] .sbe-chat-roll-flags .sbe-flag`)].map(el => el.textContent).filter(flag => /^(?:success|fail|critical-failure|raise-\d+)$/.test(flag)).sort();
    return JSON.stringify(flags) === JSON.stringify([...expected].sort());
  }, {key, expected});
  const context = await page.evaluate(({key, id}) => game.modules.get(id).api.getRollContext(game.messages.get(key)), {key, id});
  assert.deepEqual(outcomes(context.roll), [...expected].sort()); assert.ok(context.roll.includes("fire"));
  assert.deepEqual(outcomes(await card(key).locator(".sbe-chat-roll-flags .sbe-flag").allTextContents()), [...expected].sort());
}
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001"); await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"}); await page.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready();
  await page.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true}); }, id); await page.reload(); await ready();
  await page.evaluate(async () => { if (!game.actors.getName("Outcome QA")) await Actor.create({name: "Outcome QA", type: "npc", items: [{name: "Athletics", type: "skill", system: {attribute: "agility", die: {sides: 8}}}]}); });
  await check(await roll({total: 3}), ["fail"]); await check(await roll({total: 4}), ["success"]);
  await check(await roll({total: 8}), ["raise-1", "success"]); const raised = await roll({total: 12}); await check(raised, ["raise-2", "success"]);
  await check(await roll({total: 11, tn: 8}), ["success"]); await check(await roll({total: 12, tn: 8}), ["raise-1", "success"]);
  const critical = await roll({critical: true}); await check(critical, ["critical-failure", "fail"]);
  assert.equal(await page.evaluate(key => game.messages.get(key).getFlag("swade-better-effects", "context").roll.includes("critical-failure"), critical), true);
  console.log("PASS native trait cards and persisted contexts expose failure, success, exact raises, critical failure and the actual TN");
  await check(await roll({total: 3, old: raised}), ["fail"]); await check(raised, ["raise-2", "success"]);
  const previous = await page.evaluate(() => game.messages.contents.at(-1).id);
  await card(raised).locator("button.free-reroll").click(); await page.waitForFunction(key => game.messages.contents.at(-1).id !== key, previous);
  await check(await page.evaluate(() => game.messages.contents.at(-1).id), ["raise-2", "success"]);
  const damage = await page.evaluate(async id => { const roll = new (CONFIG.Dice.rolls.find(cls => cls.name === "DamageRoll"))("12"); game.modules.get(id).api.tagRoll(roll, ["fire"], {actor: game.actors.getName("Outcome QA")}); await roll.evaluate(); return (await roll.toMessage()).id; }, id);
  assert.deepEqual(outcomes(await page.evaluate(({id, key}) => game.modules.get(id).api.getRollContext(game.messages.get(key)).roll, {id, key: damage})), []);
  console.log("PASS rerolls replace stale outcomes without mutating the original; damage totals are not classified against TN 4");
  await page.evaluate(async id => { await game.settings.set("core", "moduleConfiguration", {[id]: true, "swade-tools": true}); }, id); await page.reload(); await ready();
  const tools = await roll({tools: true, total: 6, adjustment: 3}); await check(tools, ["raise-1", "success"]);
  await page.evaluate(key => game.messages.get(key).update({"flags.swade-tools.gmmod": -3}), tools); await check(tools, ["fail"]);
  await page.evaluate(key => game.messages.get(key).update({"flags.swade-tools.gmmod": 30}), tools); await check(tools, ["raise-8", "success"]);
  await page.waitForFunction(() => game.settings.get("swade-better-effects", "flagLibrary").includes("raise-8"));
  await check(await roll({tools: true, critical: true, adjustment: 10}), ["critical-failure", "fail"]);
  if (shots) await card(tools).screenshot({path: `${shots}/roll-outcome-flags.png`, animations: "disabled"});
  assert.deepEqual(errors, []); console.log("PASS generic Tools pools recognize critical failures; GM adjustments update flags and register new raise counts; no browser errors");
} catch (error) { console.error("Browser errors:", errors); if (shots) await page.screenshot({path: `${shots}/outcomes-failure.png`}).catch(() => {}); throw error; }
finally { await browser.close(); }
