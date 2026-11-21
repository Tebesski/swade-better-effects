import test from "node:test";
import assert from "node:assert/strict";
import {automaticFlags, effectiveFlags, equipmentFlags, flagInputData, flagsAfterAncestryChange, flagsAfterEquipmentChange, hudActionFlag, itemGrantsFlags, rollCategoryFlags} from "../scripts/default-flags.mjs";
import {normalizePattern, matchesFlag, testPredicate, resolveTrait, selectorForKey} from "../scripts/rules.mjs";
const item = (name, type, extra = {}) => ({documentName: "Item", name, type, system: {}, ...extra});
const actor = items => ({documentName: "Actor", name: "Hero", type: "character", system: {details: {species: {name: "Elf"}}}, isWildcard: true, items});
const predicate = {op: "flag", source: "actor", flag: "dodge"};

test("automatic names are whole flags, including commas; renames replace derived names", () => {
  const sword = item("Sword, Long", "weapon");
  assert.deepEqual(automaticFlags(sword), ["sword-long"]);
  sword.name = "Sword, Short";
  assert.deepEqual(automaticFlags(sword), ["sword-short"]);
});
test("powers derive an Arcane flag that follows the field and respects manual exclusions", () => {
  const power = item("Burst", "power", {system: {arcane: "Spellcasting"}});
  assert.deepEqual(effectiveFlags(power), ["burst", "spellcasting"]);
  assert.deepEqual(effectiveFlags(actor([power])), ["elf"]);
  power.system.arcane = " Wéird Science, Arcane ";
  assert.deepEqual(effectiveFlags(power), ["burst", "weird-science-arcane"]);
  power.flags = {"swade-better-effects": flagInputData(power, ["burst", "fire"])};
  assert.deepEqual(effectiveFlags(structuredClone(power)), ["burst", "fire"]);
  power.system.arcane = "Faith";
  assert.deepEqual(effectiveFlags(power), ["burst", "faith", "fire"]);
  power.system.arcane = "";
  assert.deepEqual(effectiveFlags(power), ["burst", "fire"]);
  power.system.arcane = "Burst";
  assert.deepEqual(effectiveFlags(power), ["burst", "fire"]);
  assert.deepEqual(effectiveFlags(item("Burst", "edge", {system: {arcane: "Spellcasting"}})), ["burst"]);
});
test("each equipment state supplies exactly one flag to its item and none to its actor", () => {
  const sword = item("Sword", "weapon", {system: {equipStatus: 4}});
  const hero = actor([sword]);
  for (const [state, flag] of ["stored","carried","off-hand","equipped","main-hand","two-hands"].entries()) {
    sword.system.equipStatus = state;
    assert.deepEqual(equipmentFlags(sword), [flag]);
    assert.deepEqual(effectiveFlags(sword), [flag,"sword"].sort());
    assert.deepEqual(effectiveFlags(hero), ["elf"]);
  }
});
test("powers derive flags from the current comma-separated Trappings field", () => {
  const power = item("Bolt", "power", {system: {arcane: "Spellcasting", trapping: " Côld Iron, Blue Fire, blue fire "}});
  assert.deepEqual(effectiveFlags(power), ["bolt", "spellcasting", "trapping-blue-fire", "trapping-cold-iron"]);
  power.system.trapping = "Lightning";
  assert.deepEqual(effectiveFlags(power), ["bolt", "spellcasting", "trapping-lightning"]);
  power.flags = {"swade-better-effects": flagInputData(power, "bolt, spellcasting")};
  assert.deepEqual(effectiveFlags(power), ["bolt", "spellcasting"]);
  assert.deepEqual(effectiveFlags(item("Bolt", "weapon", {system: {trapping: "Fire"}})), ["bolt"]);
});
test("action card flags use the rolling token or its group leader and follow redraws", () => {
  const hero = actor([]);
  const combatant = {initiative: 13.4, cardValue: 13, cardString: "K♠"};
  const token = {combatant};
  hero.getCombatant = () => ({initiative: 9.1, cardValue: 9, cardString: "9♣"});
  assert.deepEqual(effectiveFlags(hero), ["card-9", "card-number", "elf"]);
  assert.deepEqual(effectiveFlags(hero, token), ["card-face", "card-king", "elf"]);
  combatant.groupLeader = {initiative: 14.3, cardValue: 14, cardString: "A♥"};
  assert.deepEqual(effectiveFlags(hero, token), ["card-ace", "elf"]);
  combatant.groupLeader = {initiative: 98, cardValue: 98, cardString: "Blk J", hasJoker: true};
  assert.deepEqual(effectiveFlags(hero, token), ["card-black-joker", "card-joker", "elf"]);
  assert.deepEqual(effectiveFlags(hero, {combatant: {initiative: 7, cardValue: 7, cardString: ""}}), ["elf"]);
  assert.deepEqual(effectiveFlags(hero, {combatant: {initiative: null, cardValue: 13, cardString: "K♠"}}), ["elf"]);
  assert.deepEqual(effectiveFlags(hero, {combatant: null}), ["elf"]);
});
test("HUD actions use action identifiers for Support and Tests", () => {
  const action = (module, actionKind, name = "") => item(name, "action", {flags: {[module]: {actionKind}}});
  assert.equal(hudActionFlag(action("swade-hud", "support")), "support");
  assert.equal(hudActionFlag(action("swade-better-setting", "test")), "test");
  assert.equal(hudActionFlag(action("swade-hud", "intimidation"), true), "test");
  assert.equal(hudActionFlag(action("swade-hud", "intimidation"), false), undefined);
  assert.equal(hudActionFlag(item("Test", "skill")), undefined);
});
test("actors automatically receive ancestry and current Size without inheriting item flags", () => {
  const hero = actor([item("Dodge", "edge"), item("High Elf", "ancestry")]);
  hero.system.stats = {size: 0};
  assert.deepEqual(effectiveFlags(hero),["high-elf", "size0"]);
  assert.deepEqual(effectiveFlags(hero.items[0]),["dodge"]);
  hero.items.shift();
  assert.ok(!effectiveFlags(hero).includes("dodge"));
  hero.items = [];
  hero.system.stats.size = -1;
  assert.deepEqual(effectiveFlags(hero),["elf", "size-1"]);
  hero.system.details.species.name="";
  hero.system.stats.size = 1;
  assert.deepEqual(effectiveFlags(hero),["size1"]);
  assert.deepEqual(effectiveFlags({...hero, type: "vehicle", system: {size: 4}}), ["size4"]);
});
test("gear's own flags never transfer to its actor; explicit flag-granting effects respect equipped/carried", () => {
  const gear = item("Fire charm", "gear", {system: {equipStatus: 1, quantity: 1}, flags: {"swade-better-effects": {tags: ["fire"]}}});
  const hero = actor([gear]);
  assert.equal(itemGrantsFlags(gear), false);
  assert.ok(!effectiveFlags(hero).includes("fire"));
  gear.system.equipStatus = 2;
  assert.ok(!effectiveFlags(hero).includes("fire"));
  hero.effects=[{active:true,parent:gear,system:{changes:[{key:"sbe.modifyFlag",type:"add",value:"fire"}]}}];
  assert.ok(effectiveFlags(hero).includes("fire"));
  gear.system.equipStatus = 1;
  gear.flags["swade-better-effects"].flagActivation = "carried";
  assert.ok(effectiveFlags(hero).includes("fire"));
  gear.system.equipStatus = 0;
  assert.ok(!effectiveFlags(hero).includes("fire"));
  gear.system.equipStatus = 3; gear.system.quantity = 0;
  assert.ok(!effectiveFlags(hero).includes("fire"));
});
test("manual deletions of generated ancestry and item names survive repeated reads and reload", () => {
  const hero=actor([]);hero.flags={"swade-better-effects":flagInputData(hero,[])};
  assert.deepEqual(effectiveFlags(hero),[]);
  assert.deepEqual(effectiveFlags(structuredClone(hero)),[]);
  const sword=item("Sword, Long","weapon",{system:{equipStatus:4}});
  sword.flags={"swade-better-effects":flagInputData(sword,["main-hand","fire"])};
  assert.deepEqual(effectiveFlags(sword),["fire","main-hand"]);
  sword.flags["swade-better-effects"]={...sword.flags["swade-better-effects"],...flagInputData(sword,["sword-long","main-hand","fire"])};
  assert.deepEqual(effectiveFlags(sword),["fire","main-hand","sword-long"]);
});
test("changing equipment replaces stale stored hand flags and resets only equipment exclusions", () => {
  const sword=item("Sword","weapon",{system:{equipStatus:4},flags:{"swade-better-effects":{tags:["off-hand","two-hands","magic"],excludedTags:["main-hand","sword"]}}});
  assert.deepEqual(effectiveFlags(sword),["magic"]);
  const next=flagsAfterEquipmentChange(sword);
  assert.deepEqual(next,{tags:["magic"],excludedTags:["sword"]});
  sword.system.equipStatus=2;sword.flags["swade-better-effects"]={...next};
  assert.deepEqual(effectiveFlags(sword),["magic","off-hand"]);
});
test("returning to an ancestry regenerates its flag without restoring unrelated removals", () => {
  const hero=actor([]);hero.system.details.species.name="Human";
  hero.flags={"swade-better-effects":{...flagInputData(hero,[]),excludedTags:["human","silver"]}};
  assert.deepEqual(effectiveFlags(hero),[]);
  hero.system.details.species.name="Elf";
  Object.assign(hero.flags["swade-better-effects"],flagsAfterAncestryChange(hero,"Elf"));
  assert.deepEqual(effectiveFlags(hero),["elf"]);
  hero.system.details.species.name="Human";
  Object.assign(hero.flags["swade-better-effects"],flagsAfterAncestryChange(hero,"Human"));
  assert.deepEqual(effectiveFlags(hero),["human"]);
  assert.deepEqual(hero.flags["swade-better-effects"].excludedTags,["silver"]);
});
test("roll categories distinguish mixed weapons by the actual rolled skill", () => {
  const weapon = item("Bayonet", "weapon", {system: {isMelee: true, isRanged: true, range: "12/24/48"}});
  assert.ok(rollCategoryFlags(weapon, {kind: "trait", skill: {name: "Fighting", system: {swid: "fighting"}}}).includes("melee"));
  assert.ok(!rollCategoryFlags(weapon, {kind: "trait", skill: {name: "Fighting", system: {swid: "fighting"}}}).includes("ranged"));
  assert.deepEqual(rollCategoryFlags(weapon, {kind: "damage"}), ["attack", "damage", "ranged", "weapon"]);
  assert.ok(rollCategoryFlags(weapon, {kind: "trait", skill: "Shooting"}).includes("ranged"));
});
test("power casting and damage generate power without attack", () => {
  const power = item("Bolt", "power");
  assert.deepEqual(rollCategoryFlags(power), ["damage", "power"]);
  assert.deepEqual(rollCategoryFlags(power, {kind: "damage"}), ["damage", "power"]);
  assert.deepEqual(rollCategoryFlags(power, {kind: "trait", skill: "Spellcasting"}), ["power", "skill", "spellcasting", "trait"]);
});
test("wildcards support prefix, suffix and internal matches without executable regex", () => {
  assert.equal(normalizePattern(" SWÓRD-* "), "sword-*");
  assert.equal(matchesFlag("sword*", ["sword-long"]), true);
  assert.equal(matchesFlag("sword-*", ["swordfish"]), false);
  assert.equal(matchesFlag("*iron", ["cold-iron"]), true);
  assert.equal(matchesFlag("s*long", ["sword-long"]), true);
  assert.equal(matchesFlag("sword*", ["longsword"]), false);
  assert.equal(testPredicate({op: "not", child: {op: "flag", source: "item", flag: "sword*"}}, {hasRoll: true, item: ["sword-long"]}), false);
});
test("incoming ranged attack rule matches its owner's Dodge flag only on ranged attacks", () => {
  const rule = {selector: "target-roll:targetAttackRanged", value: -2, type: "add", predicate, ownerFlags: ["dodge"], label: "Dodge"};
  const context = {hasRoll: true, roll: ["trait", "attack", "ranged"], attribute: "agility"};
  assert.equal(resolveTrait({context, defenderRules: [rule]}).value, -2);
  assert.equal(resolveTrait({context: {...context, roll: ["trait", "attack", "melee"]}, defenderRules: [rule]}).value, 0);
  assert.equal(resolveTrait({context, defenderRules: [{...rule, ownerFlags: []}]}).value, 0);
  assert.equal(resolveTrait({context, attackerRules: [rule]}).value, 0);
});
test("native target-attack globals and linked traits work with predicates", () => {
  assert.equal(selectorForKey("system.stats.globalMods.targetAttackRanged"), "global:targetAttackRanged");
  const context = {hasRoll: true, roll: ["trait", "attack", "ranged"], attribute: "agility"};
  const p = {op: "all", children: []};
  assert.equal(resolveTrait({context, attackerRules: [{selector: "global:agility", value: 1, predicate:p}],
    defenderRules: [{selector: "global:targetAttackRanged", value: -2, predicate:p}]}).value, -1);
  assert.equal(resolveTrait({context, defenderRules: [{selector:"target-roll:trait",value:-1,predicate:p}]}).value,-1);
  assert.equal(resolveTrait({context, defenderRules: [{selector:"target-roll:damage",value:-5,predicate:p}]}).value,0);
  assert.equal(resolveTrait({context: {...context,roll:["trait","attack","melee","gang-up"]}, defenderRules:[{selector:"global:gangUpDefend",value:2,predicate:p}]}).value,-2);
});
