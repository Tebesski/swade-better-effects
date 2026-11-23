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
