import test from "node:test";
import assert from "node:assert/strict";
import {restrictionMatches, validateRestriction} from "../scripts/restriction-data.mjs";
const attribute = {rollType: "trait", attribute: "agility", roll: ["trait", "agility"]};
const skill = {...attribute, skill: {name: "Stealth", swid: "stealth"}};

test("Restrict distinguishes attributes, specific skills and linked skills", () => {
  assert.equal(restrictionMatches({traits: ["agility"]}, attribute), true);
  assert.equal(restrictionMatches({traits: ["agility"]}, skill), false);
  assert.equal(restrictionMatches({traits: ["agility"], linkedAttributes: ["agility"]}, skill), true);
  assert.equal(restrictionMatches({traits: ["Agilité"]}, attribute, {agility: "Agilité"}), true);
  assert.equal(restrictionMatches({traits: ["sTeAlTh"]}, skill), true);
  assert.equal(restrictionMatches({traits: ["* "]}, skill), true);
  assert.equal(restrictionMatches({traits: ["vigor"]}, skill), false);
});

test("restricted flags block matching trait, power, damage and formula rolls", () => {
  for (const rollType of ["trait", "damage"]) {
    assert.equal(restrictionMatches({rollFlags: ["spell*"]}, {rollType, roll: ["spellcasting"]}), true);
    assert.equal(restrictionMatches({rollFlags: ["power"]}, {rollType, roll: ["attack"]}), false);
  }
  assert.equal(restrictionMatches({traits: ["*"]}, {rollType: "damage", roll: ["damage"]}), false);
  assert.equal(restrictionMatches({traits: ["*"]}, {...attribute, roll: ["trait", "formula"]}), false);
  assert.equal(restrictionMatches({rollFlags: ["formula"]}, {...attribute, roll: ["trait", "formula"]}), true);
});

test("restriction configuration trims entries and removes stale linked attributes", () => {
  assert.deepEqual(validateRestriction({traits: " agility, Stealth ", linkedAttributes: ["agility", "vigor"], rollFlags: "Power, trapping-fire*"}),
    {traits: ["agility", "Stealth"], linkedAttributes: ["agility"], rollFlags: ["power", "trapping-fire*"]});
  assert.throws(() => validateRestriction({}));
});
