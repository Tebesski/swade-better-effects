import test from "node:test";
import assert from "node:assert/strict";
import {SUPPRESS_KEY} from "../scripts/constants.mjs";
import {applyFlagChanges, resolveEffectState, suppressionFlags} from "../scripts/flag-changes.mjs";
import {filterSuppressedModifiers, isFlagSuppressed, modifierFlags} from "../scripts/default-flags.mjs";
const scope = "swade-better-effects";
const effect = (name, tags = [], changes = []) => ({name, flags: {[scope]: {tags}}, system: {changes}});
const suppressor = value => effect("Ward", [], [{key: SUPPRESS_KEY, type: "add", value}]);
const actor = effects => ({documentName: "Actor", effects});

test("Suppress suspends all matching effect modifiers and restores them without changing stored data", () => {
  const poison = effect("Venom", ["poison"], [{key: "system.stats.globalMods.trait", value: "-2"}]);
  const fire = effect("Burning", ["fire"]);
  const ward = suppressor("poison, fire");
  assert.deepEqual(resolveEffectState([poison, fire, ward]).suppressed, new Set([poison, fire]));
  assert.equal(poison.disabled, undefined);
  // Unlike Flag Rules, the standalone Suppress rule does not erase actor tags.
  assert.deepEqual(applyFlagChanges(["poison"], [poison, fire, ward]), ["poison", "ward"]);
  ward.disabled = true;
  assert.deepEqual(resolveEffectState([poison, fire, ward]).active, new Set([poison, fire]));
});

test("Suppress handles comma-separated flags and wildcard patterns", () => {
  assert.deepEqual(suppressionFlags("Poison*, FATIGUE, poison*"), ["fatigue", "poison*"]);
  const a = effect("Venom", ["poison-injury"]), b = effect("Toxin", ["poison-contact"]), c = effect("Cold");
  const ward = suppressor("poison*, fatigue");
  assert.deepEqual(resolveEffectState([a, b, c, ward]).suppressed, new Set([a, b]));
  assert.equal(isFlagSuppressed(actor([ward]), "fatigue"), true);
  ward.duration = {expired: true};
  assert.equal(isFlagSuppressed(actor([ward]), "fatigue"), false);
});

test("suppressed suppressors have no effect, including built-in penalty suppression", () => {
  const ward = suppressor("fatigue");
  const counter = effect("Counter", [], [{key: SUPPRESS_KEY, value: "ward"}]);
  assert.equal(isFlagSuppressed(actor([ward, counter]), "fatigue"), false);
  counter.disabled = true;
  assert.equal(isFlagSuppressed(actor([ward, counter]), "fatigue"), true);
});

test("modifier suppression respects explicit flags and localized native labels", () => {
  const before = globalThis.game;
  globalThis.game = {i18n: {localize: key => ({"SWADE.Wounds": "Blessures", "SWADE.Distr": "Distrait"})[key] ?? key}};
  try {
    const ward = suppressor("wounds, distracted, poison*, custom-bonus");
    const modifiers = [{label: "Blessures", value: -2}, {label: "Distrait", value: -2},
      {label: "Venom", value: -4, flags: ["poison-injury"]},
      {label: "Custom Bonus", value: 1}, {label: "Fatigue", value: -1}, {label: "Other", value: 2}];
    const original = structuredClone(modifiers);
    assert.ok(modifierFlags(modifiers[0]).includes("wounds"));
    assert.deepEqual(filterSuppressedModifiers(actor([ward]), modifiers), original.slice(4));
    assert.deepEqual(modifiers[0], {label: "Fatigue", value: -1});
    ward.disabled = true;
    assert.deepEqual(filterSuppressedModifiers(actor([ward]), original), original);
  } finally { globalThis.game = before; }
});

test("ineligible and stale conditional suppression rules cannot run", () => {
  const venom = effect("Venom", ["poison"]), ward = suppressor("poison");
  assert.equal(resolveEffectState([venom, ward], {grantsFlags: e => e !== ward}).suppressed.size, 0);
  ward.flags[scope].conditions = [{signature: "stale", predicate: {op: "flag", source: "actor", flag: "elf"}}];
  assert.equal(resolveEffectState([venom, ward]).suppressed.size, 0);
});
