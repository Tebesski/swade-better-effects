import assert from "node:assert/strict";
import {createRequire} from "node:module";

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
  args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
const errors = [];
page.on("pageerror", error => errors.push(error.stack ?? error.message));

try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30002");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready && canvas?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "better-setting-qa");
  if (process.env.FOUNDRY_QA_TOOLS === "1" && !await page.evaluate(() => game.modules.get("swade-tools")?.active)) {
    await page.evaluate(() => game.settings.set("core", "moduleConfiguration",
      {...game.settings.get("core", "moduleConfiguration"), "swade-tools": true}));
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready && canvas?.ready);
  }
  await page.addStyleTag({content: "#notifications {pointer-events:none!important}"});
  await page.evaluate(async () => {
    const scope = "swade-better-effects";
    const api = game.modules.get(scope).api;
    const [source, vulnerable, normal] = await Actor.createDocuments([
      {name: "Damage Formula QA Attacker", type: "character", items: [{name: "QA Spear", type: "weapon", system: {damage: "4"}}],
        effects: [{name: "Exploit", flags: {[scope]: {rules: [{selector: "outgoing-damage", type: "add", value: "1d6x+2",
          predicate: {op: "flag", source: "target", flag: "exposed"}}]}}}]},
      {name: "Exposed QA Target", type: "npc", flags: {[scope]: {tags: ["exposed"]}}},
      {name: "Normal QA Target", type: "npc"}
    ]);
    const scene = await Scene.create({name: `Damage Formula QA ${Date.now()}`, width: 800, height: 800,
      tokens: [vulnerable, normal].map((actor, index) => ({name: actor.name, actorId: actor.id, actorLink: true, x: 100 + index * 200, y: 100}))});
    await scene.view();
    globalThis.damageQA = {scope, api, weapon: source.items.getName("QA Spear"), scene, exposed: vulnerable.id, normal: normal.id};
  });
  await page.waitForFunction(() => canvas.ready && canvas.scene?.id === damageQA.scene.id);
  await page.evaluate(() => {
    const {exposed, normal} = damageQA;
    damageQA.tokens = [exposed, normal].map(id => canvas.tokens.placeables.find(token => token.actor.id === id));
    damageQA.tokens[0].setTarget(true, {releaseOthers: true});
    ui.sidebar.changeTab("chat", "primary");
    damageQA.rolling = damageQA.weapon.rollDamage();
  });
  const dialog = page.locator(".roll-dialog");
  const formula = dialog.locator(".formula textarea");
  await formula.waitFor();
  assert.match(await formula.inputValue(), /1d6x\[Exploit\]/);
  await dialog.getByLabel("No Acing").check();
  assert.match(await formula.inputValue(), /1d6\[Exploit\]/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  const outcome = await page.evaluate(async () => {
    const roll = await damageQA.rolling;
    const message = game.messages.get(roll.messageId);
    const token = damageQA.tokens[0];
    return {id: message.id, total: roll.total, dice: roll.dice.map(die => [die.flavor, die.total]),
      resolved: damageQA.api.prepareDamage(token.actor, token.document, message).damage};
  });
  assert.equal(outcome.dice[0][0], "Exploit");
  assert.equal(outcome.total, 4 + 2 + outcome.dice[0][1]);
  assert.equal(outcome.total, outcome.resolved);
  const card = page.locator(`#chat .chat-message[data-message-id="${outcome.id}"]`);
  await card.locator(".dice-tooltip .part-flavor").filter({hasText: "Exploit"}).waitFor({state: "attached"});
  assert.equal(await card.locator(".sbe-chat-damage, .sbe-damage-breakdown").count(), 0);
  console.log("PASS the native formula, dice tooltip, and damage total include the flagged bonus exactly once");

  await page.evaluate(() => {
    damageQA.tokens[1].setTarget(true, {releaseOthers: false});
    damageQA.rolling = damageQA.weapon.rollDamage();
  });
  await formula.waitFor();
  assert.doesNotMatch(await formula.inputValue(), /Exploit/);
  await dialog.getByRole("button", {name: "Roll", exact: true}).click();
  const mixed = await page.evaluate(async () => {
    const roll = await damageQA.rolling;
    const message = game.messages.get(roll.messageId);
    return {total: roll.total, damage: damageQA.tokens.map(token => damageQA.api.prepareDamage(token.actor, token.document, message).damage)};
  });
  assert.equal(mixed.total, 4);
  assert.equal(mixed.damage[1], 4);
  assert.ok(mixed.damage[0] >= 7);
  console.log("PASS a target-specific bonus is resolved only for the affected target in a mixed roll");
  if (await page.evaluate(() => game.modules.get("swade-tools")?.active)) {
    await page.waitForFunction(async () => {
      const {default: BasicRoll} = await import("/modules/swade-tools/scripts/class/BasicRoll.js");
      return BasicRoll.prototype.buildDamageRoll.sbeWrapped;
    });
    const tools = await page.evaluate(async () => {
      const {default: BasicRoll} = await import("/modules/swade-tools/scripts/class/BasicRoll.js");
      const roller = new BasicRoll();
      const target = damageQA.tokens[0];
      roller.actor = damageQA.weapon.actor;
      roller.item = damageQA.weapon;
      roller.usetarget = target.id;
      const roll = await roller.buildDamageRoll("4", 1, false);
      return {total: roll.total, formula: roll.formula, dice: roll.dice.map(die => die.total)};
    });
    assert.match(tools.formula, /1d6x\[Exploit\]/);
    assert.equal(tools.total, 4 + 1 + 2 + tools.dice[0]);
    console.log("PASS SWADE Tools uses the same flagged damage in its standard roll");
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(errors);
  console.error(await page.evaluate(() => ({formula: document.querySelector(".roll-dialog .formula textarea")?.value,
    notifications: document.querySelector("#notifications")?.textContent,
    context: globalThis.damageQA?.tokens && damageQA.api.makeRollContext(damageQA.weapon.actor, damageQA.weapon)})).catch(() => null));
  throw error;
} finally {
  await browser.close();
}
