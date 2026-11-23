import test from "node:test";
import assert from "node:assert/strict";
import {inlineDamageModifiers, toolsDamageHits, sharedDamageResult} from "../scripts/inline-damage-data.mjs";

test("inline damage uses normal signed modifiers and excludes ignored entries without editing actor data", () => {
  const input = [{label: "Target", value: "7"}, {value: -2}, {value: "1d6x"}, {value: "@str"},
    {value: "+3"}, {value: "-4"}, {value: "+99", ignore: true}, {value: ""}];
  assert.deepEqual(inlineDamageModifiers(input).map(mod => mod.value), ["+7", "-2", "+1d6x", "@str", "+3", "-4"]);
  assert.equal(input[0].value, "7");
});

test("shared damage keeps identical rolled dice and total with independent defender contexts", () => {
  const result = {id: "one-roll", roll: {total: 12, terms: [{results: [4, 8]}], options: {"swade-better-effects": {targetUuids: ["a"]}}}, context: {targetUuids: ["a"], ap: 2}};
  const first = sharedDamageResult(result, "a"), second = sharedDamageResult(result, "b");
  assert.equal(first.id, second.id); assert.equal(first.roll.total, second.roll.total);
  assert.deepEqual(first.roll.terms, second.roll.terms);
  assert.deepEqual(second.context.targetUuids, ["b"]);
  second.context.ap = 99; assert.equal(first.context.ap, 2); assert.equal(result.context.ap, 2);
});

test("rapid-fire damage retains each native Tools hit and its own raise", () => {
  const normal = '<div class="swadetools-term-rof"><a class="swadetools-rolldamage" data-swadetools-raise=0>';
  const raise = '<div class="swadetools-term-rof"><a class="swadetools-rolldamage" data-swadetools-raise=1>';
  assert.deepEqual(toolsDamageHits([normal, '<div class="swadetools-term-rof">Miss', raise]), [{shot: 0, raise: false}, {shot: 2, raise: true}]);
});
