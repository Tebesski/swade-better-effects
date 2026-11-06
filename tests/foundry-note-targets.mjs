// Follow foundry-notes.mjs in the disposable effects-qa world.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1050}}); page.setDefaultTimeout(12000);
const errors = [], id = "swade-better-effects", shots = process.env.FOUNDRY_QA_SCREENSHOTS;
page.on("pageerror", error => errors.push(error.stack ?? error.message));
async function ready(p) { await p.waitForFunction(() => game?.ready && canvas?.ready, null, {timeout: 60000}); assert.equal(await p.evaluate(() => game.world.id), "effects-qa"); }
async function join(p, name) { await p.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001"); await p.locator('select[name="userId"]').selectOption({label: name}); await p.getByRole("button", {name: "Join Game Session", exact: true}).click(); await ready(p); }
const card = (p, key) => p.locator(`#chat .chat-message[data-message-id="${key}"]`);
try {
  await join(page, "Gamemaster");
  await page.addStyleTag({content: "#notifications {display:none!important}"});
  await page.evaluate(() => { ui.sidebar.changeTab("chat", "primary"); ui.sidebar.expand(); });
  const ids = await page.evaluate(async id => {
    const {changeSignature} = await import("/modules/swade-better-effects/scripts/rules.mjs");
    const {noteChangeKey} = await import("/modules/swade-better-effects/scripts/note-rules.mjs");
    const {makeContext, setRollContext} = await import("/modules/swade-better-effects/scripts/roll-context.mjs");
    const actor = game.actors.contents.filter(a => a.effects.getName("Wizard notes")).at(-1);
    const old = game.messages.contents.find(m => m.speaker.actor === actor.id && m.getFlag(id, "context")?.notes?.length === 2);
    const target = foundry.utils.fromUuidSync(old.getFlag("swade", "targets")[0].uuid), defender = target.actor;
    const stale = defender.effects.filter(effect => ["Resistance reminder", "Target reminder"].includes(effect.name));
    if (stale.length) await defender.deleteEmbeddedDocuments("ActiveEffect", stale.map(effect => effect.id));
    const athletics = defender.items.getName("Athletics") ?? (await defender.createEmbeddedDocuments("Item", [{name: "Athletics", type: "skill", system: {swid: "athletics", attribute: "agility", die: {sides: 8}}}]))[0];
    const opposition = {key: noteChangeKey("@Skill{Athletics}[system.die.modifier]"), type: "add", value: "<p>Grapple resistance note.</p>", phase: "initial", priority: null};
    await defender.createEmbeddedDocuments("ActiveEffect", [{name: "Resistance reminder", system: {changes: [opposition]}, flags: {[id]: {conditions: [{signature: changeSignature(opposition), predicate: {op: "flag", source: "roll", flag: "fire"}}]}}},
      {name: "Target reminder", system: {changes: [{key: "sbe.rollNote.system.stats.globalMods.targetAttackMelee", type: "add", value: '<p>Incoming melee reminder.</p><section class="secret"><p>Private-secret-text</p></section><img src="icons/svg/book.svg" onerror="globalThis.notesExecuted=true"><script>globalThis.notesExecuted=true</script>'}]}}]);
    target.object.setTarget(true, {releaseOthers: true});
    const roll = new (CONFIG.Dice.rolls.find(cls => cls.name === "TraitRoll"))("{1d8min9max9}kh");
    setRollContext(roll, makeContext(actor, actor.items.getName("Fire sword"), [], {kind: "trait", skill: actor.items.getName("Fighting")})); await roll.evaluate();
    const message = await roll.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor: "Incoming notes QA"});
    const privateRoll = await roll.reroll();
    const privateMessage = await privateRoll.toMessage({speaker: message.speaker, flags: message.flags, whisper: [game.user.id]}, {messageMode: "gm"});
    const player = await User.create({name: `Note player ${Date.now()}`, role: 1});
    return {old: old.id, fresh: message.id, private: privateMessage.id, player: player.name, skill: athletics.id};
  }, id);
  const fresh = card(page, ids.fresh); await fresh.locator(".sbe-roll-notes").waitFor();
  assert.equal(await fresh.locator(".sbe-roll-note").count(), 2);
  assert.match(await fresh.locator(".sbe-roll-notes").textContent(), /Defender · Target reminder/);
  const data = await page.evaluate(({id, key}) => ({context: game.messages.get(key).getFlag(id, "context"), executed: globalThis.notesExecuted}), {id, key: ids.fresh});
  assert.equal(data.context.attackerNotes, undefined);
  assert.doesNotMatch(JSON.stringify(data.context.notes), /Private-secret-text|onerror|<script/);
  assert.equal(data.executed, undefined);
  for (const key of [ids.old, ids.fresh]) {
    const notes = card(page, key).locator(".sbe-roll-notes"); await notes.waitFor();
    assert.equal(await notes.evaluate(el => [...el.parentElement.children].every(child => child === el || child.getBoundingClientRect().bottom <= el.getBoundingClientRect().top + 1)), true);
  }
  if (shots) await fresh.screenshot({path: `${shots}/notes-bottom-and-targets.png`, animations: "disabled"});
  console.log("PASS incoming target notes match the roll, omit secret/unsafe markup, and display below target flags");
  await card(page, ids.old).getByRole("button", {name: "Oppose roll", exact: true}).click();
  await page.locator(".sbe-opposed-chooser").getByRole("button", {name: /^Athletics/}).click();
  const dialog = page.locator(".roll-dialog"); await dialog.waitFor(); await dialog.getByRole("button", {name: "Roll", exact: true}).click(); await dialog.waitFor({state: "hidden"});
  await page.waitForFunction(() => game.messages.contents.at(-1)?.getFlag("swade-better-effects", "context")?.opposition);
  const opposedId = await page.evaluate(() => game.messages.contents.at(-1).id); await card(page, opposedId).locator(".sbe-roll-notes").waitFor();
  assert.match(await card(page, opposedId).locator(".sbe-roll-notes").textContent(), /Grapple resistance note/);
  assert.equal(await card(page, opposedId).locator(".sbe-roll-note").count(), 1);
  console.log("PASS opposed Athletics notes evaluate the original roll's saved fire flag");
  const player = await (await browser.newContext()).newPage(); await join(player, ids.player);
  assert.equal(await player.evaluate(key => game.messages.get(key).isContentVisible, ids.private), false);
  assert.equal(await card(player, ids.private).locator(".sbe-roll-notes").count(), 0);
  assert.deepEqual(errors, []); console.log("PASS private rolls do not reveal their notes to nonrecipients; no browser JavaScript errors");
} catch (error) {
  console.error("Browser errors:", errors);
  if (shots) await page.screenshot({path: `${shots}/note-targets-failure.png`}).catch(() => {});
  throw error;
} finally { await browser.close(); }
