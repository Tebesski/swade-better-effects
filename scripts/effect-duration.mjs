import {MODULE_ID} from "./constants.mjs";

function normalizeEmbedded(data) {
  for (const effect of data.effects ?? []) {
    effect.duration ??= {};
    if (!effect.duration.units || effect.duration.units === "seconds") effect.duration.units = "rounds";
  }
  for (const item of data.items ?? []) normalizeEmbedded(item);
}

export function registerEffectDurations() {
  Hooks.on("preCreateActiveEffect", effect => {
    if (!effect.duration?.units || effect.duration.units === "seconds") effect.updateSource({"duration.units": "rounds"});
  });
  Hooks.on("preUpdateActiveEffect", (_effect, changes) => {
    if (changes["duration.units"] === "seconds") changes["duration.units"] = "rounds";
    if (changes.duration?.units === "seconds") changes.duration.units = "rounds";
  });
  for (const type of ["Actor", "Item"]) Hooks.on(`preCreate${type}`, document => {
    const data = document.toObject();
    normalizeEmbedded(data);
    document.updateSource({effects: data.effects, ...(data.items ? {items: data.items} : {})});
  });
  Hooks.once("ready", async () => {
    if (!game.user.isActiveGM) return;
    const visited = new Set();
    const migrate = async document => {
      if (!document || visited.has(document.uuid)) return;
      visited.add(document.uuid);
      const effects = [...(document.effects ?? [])].filter(effect => effect._source.duration?.units === "seconds");
      if (effects.length) await document.updateEmbeddedDocuments("ActiveEffect",
        effects.map(effect => ({_id: effect.id, "duration.units": "rounds"})));
      for (const item of document.items ?? []) await migrate(item);
    };
    try {
      for (const document of [...game.actors, ...game.items]) await migrate(document);
      for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink) await migrate(token.actor);
      for (const pack of game.packs) {
        if (pack.locked || !["Actor", "Item"].includes(pack.documentName)) continue;
        for (const document of await pack.getDocuments()) await migrate(document);
      }
    } catch (error) { console.error(`${MODULE_ID} | Effect duration conversion`, error); }
  });
}
