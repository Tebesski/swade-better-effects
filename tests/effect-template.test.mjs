import test from "node:test";
import assert from "node:assert/strict";
import {initializeTemplateCopy} from "../scripts/effect-template.mjs";
import {EFFECT_TYPE, MODULE_ID} from "../scripts/constants.mjs";
import {effectiveFlags} from "../scripts/default-flags.mjs";

test("duplicating an Effect gives its embedded effect the copy's name and generated flag", () => {
  const source = {name: "Effect", _id: "embedded", system: {changes: [{key: "system.stats.toughness.value", type: "add", value: 2}]},
    flags: {[MODULE_ID]: {nameFlag: "effect", tags: ["custom"], conditions: [{signature: "saved"}]}}};
  const original = structuredClone(source);
  let saved;
  const item = {type: EFFECT_TYPE, name: "Effect (Copy)",
    effects: {size: 1, contents: [{toObject: () => structuredClone(source)}]},
    updateSource: data => { saved = data; }};
  initializeTemplateCopy(item);
  const [copy] = saved.effects;
  assert.equal(copy.name, item.name);
  assert.equal(copy.flags[MODULE_ID].nameFlag, "effect-copy");
  assert.deepEqual(effectiveFlags({...copy, documentName: "ActiveEffect"}), ["custom", "effect-copy"]);
  assert.deepEqual(copy.system, source.system);
  assert.deepEqual(copy.flags[MODULE_ID].conditions, source.flags[MODULE_ID].conditions);
  assert.deepEqual(source, original);
});

test("multi-effect templates and ordinary items retain their individual effect names", () => {
  for (const [type, size] of [[EFFECT_TYPE, 2], ["edge", 1]]) {
    initializeTemplateCopy({type, effects: {size}, updateSource() { assert.fail("Unexpected rename"); }});
  }
});
