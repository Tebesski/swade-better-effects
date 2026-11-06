export async function moduleScriptBase(id) {
  const local = new URL(`${foundry.utils.getRoute(`modules/${id}`)}/`, window.location.href);
  const forge = globalThis.ForgeVTT;
  if (!forge?.usingTheForge) return local;

  const {version, esmodules} = game.modules.get(id);
  const cdn = new URL(`bazaar/modules/${id}/${version}/`, forge.ASSETS_LIBRARY_URL_PREFIX);
  const isCdnUrl = url => url.startsWith(cdn.href);

  // Use the URL already used by Forge's module graph. Importing through the
  // game-server redirect can fail CORS or load a separate copy of the classes.
  if (Array.from(document.scripts).some(script => isCdnUrl(script.src)) ||
      performance.getEntriesByType("resource").some(entry => isCdnUrl(entry.name))) return cdn;

  // A redirected entry may only be listed under its original URL in the page.
  const [entry] = esmodules;
  if (!entry) return local;
  const response = await fetch(new URL(entry, local), {method: "HEAD"}).catch(() => null);
  return response?.ok && isCdnUrl(response.url) ? cdn : local;
}
