import test from "node:test";
import assert from "node:assert/strict";
import {applyFlagChanges, effectFlags, resolveEffectState, MODIFY_FLAG_KEY} from "../scripts/flag-changes.mjs";
import {effectiveFlags, flagInputData, isFlagSuppressed} from "../scripts/default-flags.mjs";
const scope = "swade-better-effects";
const effect = (name, tags = [], changes = []) => ({documentName: "ActiveEffect", name, active: true,
  flags: {[scope]: {tags}}, system: {changes}});
const suppress = flag => ({key: MODIFY_FLAG_KEY, type: "subtract", value: flag});

test("fatigue suppression can be detected without any fatigue effect or actor flag", () => {
  const drink = effect("Energy Drink", [], [suppress("fatigue")]);
  const actor = {documentName: "Actor", system: {fatigue: {value: 2}}, effects: [drink]};
  assert.equal(isFlagSuppressed(actor, "fatigue"), true);
  assert.equal(effectiveFlags(actor).includes("fatigue"), false);
  drink.disabled = true;
  assert.equal(isFlagSuppressed(actor, "fatigue"), false);
  assert.equal(actor.system.fatigue.value, 2);
});

test("effects own a dynamic name flag and custom flags, independently of their active state", () => {
  const stance = effect("Aggressive Stance", ["melee", "Offensive"]);
  assert.deepEqual(effectFlags(stance), ["aggressive-stance", "melee", "offensive"]);
  assert.deepEqual(effectiveFlags(stance), effectFlags(stance));
  stance.name = "Defensive Stance"; stance.disabled = true;
  assert.deepEqual(effectFlags(stance), ["defensive-stance", "melee", "offensive"]);
  assert.deepEqual(applyFlagChanges([], [stance]), []);
});

test("the actor inherits active effects' flags without storing temporary additions", () => {
  const fatigue = effect("Fatigue", ["tired"]);
  assert.deepEqual(applyFlagChanges(["elf"], [fatigue]), ["elf", "fatigue", "tired"]);
  fatigue.duration = {expired: true};
  assert.deepEqual(applyFlagChanges(["elf"], [fatigue]), ["elf"]);
});

test("manual removal of an effect's generated flag persists without making inherited actor flags permanent", () => {
  const stance = effect("Aggressive Stance", ["offensive"]);
  Object.assign(stance.flags[scope], flagInputData(stance, ["offensive"]));
  assert.deepEqual(effectFlags(stance), ["offensive"]);
  const actor = {documentName: "Actor", name: "Hero", system: {}, items: [], effects: [stance]};
  assert.deepEqual(flagInputData(actor, ["offensive", "elf"]), {tags: ["elf"], excludedTags: []});
});

test("Suppress removes a custom actor flag and suspends every effect with that own flag", () => {
  const fatigue = effect("Fatigue", ["tired"]), extra = effect("Exhausted", ["fatigue"]);
  const drink = effect("Energy Drink", [], [suppress("fatigue")]);
  const effects = [fatigue, drink, extra], state = resolveEffectState(effects);
  assert.deepEqual(new Set(state.suppressed), new Set([fatigue, extra]));
  assert.deepEqual(applyFlagChanges(["fatigue", "elf"], effects), ["elf", "energy-drink"]);
  assert.equal(fatigue.disabled, undefined);
  drink.disabled = true;
  assert.deepEqual(applyFlagChanges(["elf"], effects), ["elf", "exhausted", "fatigue", "tired"]);
});

test("a suppressed effect cannot grant flags or suppress other effects", () => {
  const fatigue = effect("Fatigue"), drink = effect("Energy Drink", [], [suppress("fatigue")]);
  const antidote = effect("Antidote", [], [suppress("energy-drink")]);
  for (const effects of [[fatigue, drink, antidote], [antidote, drink, fatigue]]) {
    assert.deepEqual(applyFlagChanges([], effects), ["antidote", "fatigue"]);
    assert.deepEqual(resolveEffectState(effects).suppressed, new Set([drink]));
  }
});

test("matching effects resume only after the last active suppressor ends", () => {
  const fatigue = effect("Fatigue"), first = effect("First Drink", [], [suppress("fatigue")]), second = effect("Second Drink", [], [suppress("fatigue")]);
  first.disabled = true;
  assert.equal(resolveEffectState([fatigue, first, second]).suppressed.has(fatigue), true);
  second.duration = {expired: true};
  assert.equal(resolveEffectState([fatigue, first, second]).active.has(fatigue), true);
});

test("self-suppression does not disable its source; cycles are deterministic and do not suppress downstream effects", () => {
  const self = effect("Fatigue", [], [suppress("fatigue")]);
  assert.equal(resolveEffectState([self]).active.has(self), true);
  const a = effect("A", [], [suppress("b")]), b = effect("B", [], [suppress("a"), suppress("c")]), c = effect("C");
  for (const effects of [[a, b, c], [c, b, a]]) {
    assert.deepEqual(resolveEffectState(effects).suppressed, new Set([a, b]));
    assert.deepEqual(applyFlagChanges([], effects), ["c"]);
  }
  const outside = effect("Outside", [], [suppress("a")]);
  assert.deepEqual(applyFlagChanges([], [a, b, outside]), ["b", "outside"]);
});

test("only eligible actor effect sources can suppress; stale or conditioned flag rules do not run", () => {
  const fatigue = effect("Fatigue"), drink = effect("Drink", [], [suppress("fatigue")]);
  assert.equal(resolveEffectState([fatigue, drink], {grantsFlags: e => e !== drink}).active.has(fatigue), true);
  drink.flags[scope].conditions = [{signature: "stale", predicate: {op: "flag", source: "actor", flag: "elf"}}];
  assert.equal(resolveEffectState([fatigue, drink]).active.has(fatigue), true);
});
