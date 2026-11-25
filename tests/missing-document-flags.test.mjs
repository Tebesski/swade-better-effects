import test from "node:test";
import assert from "node:assert/strict";
import {effectiveFlags} from "../scripts/default-flags.mjs";

test("untargeted rolls do not emit document flag hooks with a missing document", () => {
  const previous = globalThis.Hooks;
  globalThis.Hooks = {callAll() { throw new Error("A document is required by flag integrations"); }};
  try {
    assert.deepEqual(effectiveFlags(undefined), []);
    assert.deepEqual(effectiveFlags(null), []);
  } finally { globalThis.Hooks = previous; }
});

test("reentrant flag hooks for the same unlinked token keep its built-in flags", () => {
  const previous = globalThis.Hooks;
  const token = {documentName: "Token"};
  const actor = {documentName: "Actor", token, system: {stats: {size: 0}}, flags: {
    "swade-better-effects": {tags: ["defensive", "hidden"], excludedTags: ["hidden"]}
  }};
  const other = {...actor, token: {...token}};
  let calls = 0;
  globalThis.Hooks = {callAll(_hook, doc, _token, flags) {
    calls++;
    if (doc === actor) {
      // Materializing the token's actor again can produce a different instance.
      assert.deepEqual(effectiveFlags({...doc}), ["defensive", "size0"]);
      assert.deepEqual(effectiveFlags(other), ["defensive", "light-cover", "size0"]);
    }
    flags.push("light-cover");
  }};
  try {
    for (let i = 0; i < 2; i++) assert.deepEqual(effectiveFlags(actor), ["defensive", "light-cover", "size0"]);
    assert.equal(calls, 4);
  } finally { globalThis.Hooks = previous; }
});
