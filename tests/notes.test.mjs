import test from "node:test";
import assert from "node:assert/strict";
import {NOTE_PREFIX, noteBaseKey, noteChangeKey, noteSelectorForKey, resolveRollNotes} from "../scripts/note-rules.mjs";
import {changeGroups} from "../scripts/change-presets.mjs";

const note = (selector, extra = {}) => ({id: selector, label: "Training", html: "<p><strong>Remember</strong> the rule.</p>",
  selector, predicate: {op: "all", children: []}, ...extra});
const context = {hasRoll: true, rollType: "trait", roll: ["trait", "skill", "attack", "melee"], skill: {id: "athletics-id", name: "Athletics"}, attribute: "agility"};

test("stored skill notes escape the legacy SWADE skill migrator and round-trip Unicode names", () => {
  const key = "@Skill{Athlétics: Climb}[system.die.modifier]", stored = noteChangeKey(key);
  assert.ok(stored.startsWith(NOTE_PREFIX));
  assert.ok(!stored.includes("@Skill"));
  assert.equal(noteBaseKey(stored), key);
  assert.equal(noteBaseKey("system.stats.globalMods.trait"), null);
  assert.equal(noteBaseKey(`${NOTE_PREFIX}%invalid`), null);
});

test("the Damage preset starts with the actor's damage rather than incoming target damage", () => {
  const groups = changeGroups({globalModPresets: [{key: "system.stats.globalMods.targetDamage"}, {key: "system.stats.globalMods.damage"}], otherPresets: []});
  assert.equal(groups.global.find(group => group.id === "damage").options[0].key, "system.stats.globalMods.damage");
});

test("notes support existing roll presets and trait components without treating stats as rolls", () => {
  assert.equal(NOTE_PREFIX, "sbe.rollNote.");
  for (const component of ["die.sides", "wild-die.sides", "die.modifier"]) {
    assert.equal(noteSelectorForKey(`@Skill{Athletics}[system.${component}]`), "skill:Athletics");
    assert.equal(noteSelectorForKey(`system.attributes.agility.${component}`), "attribute:agility");
  }
  assert.equal(noteSelectorForKey("system.stats.globalMods.trait"), "global:trait");
  assert.equal(noteSelectorForKey("system.stats.globalMods.attack"), "global:attack");
  assert.equal(noteSelectorForKey("system.stats.globalMods.damage"), "outgoing-damage");
  assert.equal(noteSelectorForKey("sbe.targetRoll.targetAttackRanged"), "target-roll:targetAttackRanged");
  assert.equal(noteSelectorForKey("system.stats.toughness.value"), null);
  assert.equal(noteSelectorForKey("sbe.modifyFlag"), null);
});
test("roll notes match only the chosen roll type and exact skill or attribute", () => {
  const notes = [note("global:trait"), note("global:attack"), note("skill:Athletics"), note("skill:athletics-id"), note("skill:Fighting"), note("attribute:agility"), note("outgoing-damage")];
  assert.deepEqual(resolveRollNotes({context, attackerNotes: notes}).map(n => n.label), Array(4).fill("Training"));
  assert.equal(resolveRollNotes({context: {...context, rollType: "damage"}, attackerNotes: notes}).length, 1);
  assert.equal(resolveRollNotes({context: {...context, skill: null, roll: ["trait", "attribute"]}, attackerNotes: notes}).length, 2);
});
test("conditional notes use roll flags and effect-owner flags, without modifying results", () => {
  const notes = [note("global:trait", {predicate: {op: "flag", source: "roll", flag: "fire"}}),
    note("global:attack", {ownerFlags: ["wizard"], predicate: {op: "flag", source: "actor", flag: "wizard"}})];
  const before = structuredClone(context);
  assert.equal(resolveRollNotes({context, attackerNotes: notes}).length, 1);
  assert.equal(resolveRollNotes({context: {...context, roll: [...context.roll, "fire"]}, attackerNotes: notes}).length, 2);
  assert.deepEqual(context, before);
});
test("attacker notes deduplicate across targets and incoming notes belong to the correct target", () => {
  const targets = [{uuid: "a", name: "Elf", flags: ["elf"], notes: [note("global:targetAttackMelee"), note("global:attack")]},
    {uuid: "b", name: "Human", flags: ["human"], notes: [note("global:targetAttackRanged")]}];
  const notes = [note("global:trait"), note("global:attack", {predicate: {op: "flag", source: "target", flag: "elf"}}), note("incoming-damage")];
  const resolved = resolveRollNotes({context, attackerNotes: notes, targets});
  assert.equal(resolved.length, 3);
  assert.equal(resolved[2].target, "Elf");
  assert.equal(resolveRollNotes({context: {...context, rollType: "damage"}, attackerNotes: notes, targets}).length, 0);
});
test("opposed roll notes can match source flags without inheriting its attack classification", () => {
  const opposed = {...context, roll: [...context.roll, "grapple", "opposed"], rollKinds: ["trait", "skill", "opposed"]};
  assert.equal(resolveRollNotes({context: opposed, attackerNotes: [note("global:attack")]}).length, 0);
  assert.equal(resolveRollNotes({context: opposed, attackerNotes: [note("skill:Athletics", {predicate: {op: "flag", source: "roll", flag: "grapple"}})]}).length, 1);
});
