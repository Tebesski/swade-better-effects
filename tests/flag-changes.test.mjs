import test from "node:test";
import assert from "node:assert/strict";
import {applyFlagChanges, MODIFY_FLAG_KEY} from "../scripts/flag-changes.mjs";
import {customFlagsFromInput, effectiveFlags, flagInputData} from "../scripts/default-flags.mjs";
const effect = (value, type = "add", extra = {}) => ({active: true, system: {changes: [{key: MODIFY_FLAG_KEY, type, value}]}, ...extra});
const actor = effects => ({documentName: "Actor", type: "character", name: "Hero", system: {}, items: [], effects, flags: {"swade-better-effects": {tags: ["silver"]}}});

test("Modify flag follows the effect's active state without mutating stored flags", () => {
  const stance = effect("Aggressive Stance");
  const hero = actor([stance]);
  assert.ok(effectiveFlags(hero).includes("aggressive-stance"));
  stance.disabled = true;
  assert.ok(!effectiveFlags(hero).includes("aggressive-stance"));
  stance.disabled = false;
  assert.ok(effectiveFlags(hero).includes("aggressive-stance"));
  hero.effects = [];
  assert.ok(!effectiveFlags(hero).includes("aggressive-stance"));
  assert.deepEqual(hero.flags["swade-better-effects"].tags, ["silver"]);
});
test("Suppress flag hides a flag only while active; Suppress wins over active Add", () => {
  const add = effect("silver"), remove = effect("silver", "subtract");
  assert.deepEqual(applyFlagChanges(["silver", "elf"], [add,remove]), ["elf"]);
  assert.deepEqual(applyFlagChanges(["silver", "elf"], [remove,add]), ["elf"]);
  remove.active = false;
  assert.deepEqual(applyFlagChanges(["silver", "elf"], [remove,add]), ["elf", "silver"]);
});
test("suppressed, expired and inactive effects never supply flags", () => {
  assert.deepEqual(applyFlagChanges([], [effect("one", "add", {isSuppressed:true}), effect("two","add",{duration:{expired:true}}), effect("three","add",{active:false})]), []);
});
test("editing the visible Flags field neither persists temporary flags nor erases hidden stored flags", () => {
  const hero = actor([effect("aggressive-stance"), effect("silver","subtract")]);
  assert.deepEqual(customFlagsFromInput(hero, [...effectiveFlags(hero), "fire"]), ["fire", "silver"]);
  hero.effects = [effect("silver")];
  assert.deepEqual(customFlagsFromInput(hero, [...effectiveFlags(hero), "fire"]), ["fire", "silver"]);
});
test("manually deleting an effect-supplied flag takes precedence until explicitly re-added", () => {
  const stance=effect("aggressive-stance");const hero=actor([stance]);
  hero.flags["swade-better-effects"]={...flagInputData(hero,["silver"])};
  assert.deepEqual(effectiveFlags(hero),["silver"]);
  stance.disabled=true;stance.disabled=false;
  assert.deepEqual(effectiveFlags(hero),["silver"]);
  hero.flags["swade-better-effects"]={...flagInputData(hero,["silver","aggressive-stance"])};
  assert.deepEqual(effectiveFlags(hero),["aggressive-stance","silver"]);
  stance.disabled=true;
  assert.deepEqual(effectiveFlags(hero),["silver"]);
});
