import test from "node:test";
import assert from "node:assert/strict";
import {moduleScriptBase} from "../scripts/module-imports.mjs";

const local = "https://game.example.test/table/modules/swade-tools/";
const assets = "https://assets.forge-vtt.com/";
const cdn = `${assets}bazaar/modules/swade-tools/4.1.4/`;

function mockHost(t, {forge, scripts = [], resources = [], response} = {}) {
  const globals = {
    window: {location: {href: "https://game.example.test/table/game"}},
    foundry: {utils: {getRoute: path => `/table/${path}`}},
    ForgeVTT: forge ? {usingTheForge: true, ASSETS_LIBRARY_URL_PREFIX: assets} : undefined,
    game: {modules: new Map([["swade-tools", {version: "4.1.4", esmodules: new Set(["scripts/start.js"])}]])},
    document: {scripts: scripts.map(src => ({src}))}
  };
  Object.assign(globalThis, globals);
  t.after(() => { for (const name of Object.keys(globals)) delete globalThis[name]; });
  t.mock.method(performance, "getEntriesByType", () => resources.map(name => ({name})));
  return t.mock.method(globalThis, "fetch", async () => response);
}

test("self-hosted imports use Foundry's route prefix", async t => {
  const fetch = mockHost(t);
  assert.equal((await moduleScriptBase("swade-tools")).href, local);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Forge uses the loaded Bazaar version from the script tag or module graph", async t => {
  await t.test("entry script", async t => {
    const fetch = mockHost(t, {forge: true, scripts: [`${cdn}scripts/start.js`]});
    assert.equal((await moduleScriptBase("swade-tools")).href, cdn);
    assert.equal(fetch.mock.callCount(), 0);
  });
  await t.test("nested module after a redirect", async t => {
    const fetch = mockHost(t, {forge: true, scripts: [`${local}scripts/start.js`], resources: [`${cdn}scripts/class/BasicRoll.js`]});
    assert.equal((await moduleScriptBase("swade-tools")).href, cdn);
    assert.equal(fetch.mock.callCount(), 0);
  });
});

test("Forge resolves an unobserved redirect without replacing local custom installs", async t => {
  await t.test("Bazaar redirect", async t => {
    const fetch = mockHost(t, {forge: true, response: {ok: true, url: `${cdn}scripts/start.js`}});
    assert.equal((await moduleScriptBase("swade-tools")).href, cdn);
    assert.equal(fetch.mock.calls[0].arguments[0].href, `${local}scripts/start.js`);
    assert.deepEqual(fetch.mock.calls[0].arguments[1], {method: "HEAD"});
  });
  await t.test("local custom module", async t => {
    mockHost(t, {forge: true, resources: [`${assets}bazaar/modules/swade-tools/4.1.3/scripts/start.js`],
      response: {ok: true, url: `${local}scripts/start.js`}});
    assert.equal((await moduleScriptBase("swade-tools")).href, local);
  });
});
