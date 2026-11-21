import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_EXECUTABLE});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.on("pageerror", error => console.log("PAGE ERROR", error.message));
page.on("console", m => { if (m.type() === "error") console.log(m.text()); });
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  await page.addStyleTag({content: ".tour-overlay,#notifications {pointer-events:none!important}"});
  await page.evaluate(async () => {
    if (game.world.id !== "better-setting-qa") throw Error("Disposable QA world required");
    const id = "swade-better-effects";
    const actor = await Actor.create({name: "Lingering QA", type: "character", system: {attributes: {vigor: {die: {sides: 12, modifier: -6}}}}});
    globalThis.lingerQA = {actor, id};
    const source = await Item.create({name: "Failure outcome QA", type: "swade-better-effects.effect", effects: [{name: "Failure consequence", type: "base"}]});
    lingerQA.source = source;
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{name: "Lingering QA", type: "base", flags: {[id]: {
      lingering: {enabled: true, timing: "start", trait: "vigor", tn: 4, required: 2, followingTurns: false,
        outcomes: {success: {progress: 1, message: "Success note preserved"}, fail: {progress: 0, message: "Failure note preserved", effects: [{uuid: source.uuid, removeWithParent: false}]}}}
    }}}]);
    const combat = await Combat.create({round: 1, turn: 0, combatants: [{actorId: actor.id, name: actor.name, initiative: 10}]});
    Object.assign(lingerQA, {effect, combat});
    CONFIG.Dice.randomUniform = () => .45;
    await combat._onStartTurn(combat.combatants.contents[0], {round: 1, turn: 0});
  });
  await page.waitForFunction(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState")?.requestId);
  async function roll() {
    await page.evaluate(async () => {
      const {rollRequestedTrait} = await import("/modules/swade-better-effects/scripts/requests.mjs");
      const request = game.messages.get(lingerQA.effect.getFlag(lingerQA.id, "lingeringState").requestId);
      void rollRequestedTrait(request);
    });
    await page.locator(".swade.roll-dialog").getByRole("button", {name: "Roll", exact: true}).click();
  }
  await roll();
  await page.waitForFunction(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState")?.resolved);
  assert.equal(await page.evaluate(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState").progress), 0);
  await page.waitForFunction(() => lingerQA.actor.effects.some(e => e.name === "Failure consequence"));
  await page.evaluate(() => lingerQA.actor.update({"system.attributes.vigor.die.modifier": 0}));
  assert.equal(await page.getByRole("button", {name: "Apply Outcome", exact: true}).count(), 0);
  const first = await page.evaluate(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState").resultUuid);
  await page.locator(".sbe-lingering-controls button").last().dispatchEvent("click");
  const chooser = page.locator(".dialog").filter({hasText: "Reroll Lingering Roll"});
  await chooser.getByRole("button", {name: "Benny", exact: true}).waitFor();
  await chooser.getByRole("button", {name: "Free", exact: true}).click();
  await page.locator(".swade.roll-dialog").getByRole("button", {name: "Roll", exact: true}).click();
  await page.waitForFunction(first => {
    const state = lingerQA.effect.getFlag(lingerQA.id, "lingeringState");
    return state.resolved && state.resultUuid !== first;
  }, first);
  assert.equal(await page.evaluate(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState").progress), 1);
  assert.equal(await page.evaluate(() => lingerQA.actor.effects.some(e => e.name === "Failure consequence")), false);
  await page.evaluate(() => lingerQA.combat._onStartTurn(lingerQA.combat.combatants.contents[0], {round: 2, turn: 0}));
  await page.waitForFunction(() => !lingerQA.effect.getFlag(lingerQA.id, "lingeringState").resolved);
  assert.equal(await page.evaluate(() => lingerQA.effect.getFlag(lingerQA.id, "lingeringState").resultUuid), null);
  await roll();
  await page.waitForFunction(() => !lingerQA.actor.effects.has(lingerQA.effect.id));
  assert.ok(await page.evaluate(() => game.messages.some(m => m.getFlag(lingerQA.id, "lingeringResult")?.text === "Success note preserved")));
  console.log("PASS automatic outcomes, preserved notes, reroll replacement, and next-turn completion at 2/2");
} finally {
  await page.evaluate(async () => { if (globalThis.lingerQA) { await lingerQA.combat?.delete(); await lingerQA.actor.delete(); await lingerQA.source?.delete(); } }).catch(() => {});
  await browser.close();
}
