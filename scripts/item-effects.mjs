import {ADD_ITEM_KEY, MODULE_ID} from "./constants.mjs";
import {conditionsValid} from "./effects.mjs";
import {hasCondition} from "./rules.mjs";

const GRANT_SOURCE = "grantedItemSource";
export const isItemEffect = effect => effect?.parent?.documentName === "Item" && !!effect.getFlag(MODULE_ID, "itemEffect");

export async function resolveGrantItem(uuid) {
  const item = await foundry.utils.fromUuid(String(uuid ?? "").trim()).catch(() => null);
  return item?.documentName === "Item" && item.visible ? item : null;
}

function itemGrants(effect) {
  if (!effect.active || !conditionsValid(effect)) return [];
  const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
  return effect._source.system.changes
    .filter((change, index) => change.key === ADD_ITEM_KEY && change.type === "add" && !hasCondition(conditions[index]?.predicate))
    .map(change => String(change.value ?? "").trim()).filter(Boolean);
}

function sourceUuids(item) {
  return [item.uuid, item._stats?.compendiumSource, item._stats?.duplicateSource, item.getFlag("core", "sourceId")].filter(Boolean);
}

async function planItemGrants(actor) {
  const managed = new Map();
  const originalSources = new Set();
  const roots = new Set();
  const effectsByItem = new Map();
  for (const effect of actor.allApplicableEffects()) {
    if (effect.parent === actor || !effect.parent.getFlag(MODULE_ID, GRANT_SOURCE)) roots.add(effect);
    else {
      const effects = effectsByItem.get(effect.parent.id) ?? [];
      effects.push(effect);
      effectsByItem.set(effect.parent.id, effects);
    }
  }
  for (const item of actor.items) {
    const source = item.getFlag(MODULE_ID, GRANT_SOURCE);
    if (source) {
      const list = managed.get(source) ?? [];
      list.push(item);
      managed.set(source, list);
    } else {
      for (const uuid of sourceUuids(item)) originalSources.add(uuid);
    }
  }

  // Follow grants from actor effects and ordinary items. A chain or cycle of
  // granted items cannot keep itself on the actor after its source goes away.
  const wanted = new Set();
  for (const effect of roots) {
    for (const uuid of itemGrants(effect)) {
      if (originalSources.has(uuid) || wanted.has(uuid)) continue;
      wanted.add(uuid);
      const existing = managed.get(uuid)?.[0];
      for (const embedded of effectsByItem.get(existing?.id) ?? []) roots.add(embedded);
    }
  }
  const added = await Promise.all([...wanted].filter(uuid => !managed.has(uuid)).map(async uuid => {
    const item = await resolveGrantItem(uuid);
    if (!item || sourceUuids(item).some(source => originalSources.has(source))) return null;
    const data = item.toObject();
    for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete data[key];
    if (data.flags?.swade) delete data.flags.swade.hasGranted;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_SOURCE}`, item.uuid);
    return data;
  }));
  const remove = [...managed].flatMap(([uuid, items]) => items.slice(wanted.has(uuid) ? 1 : 0).map(item => item.id));
  const create = added.filter(Boolean);
  if (!remove.length && !create.length) return;
  return {remove, create, signature: JSON.stringify([...wanted].sort())};
}

export function registerItemGrants() {
  const pending = new Map();
  function schedule(actor, userId) {
    if (!game.ready || !actor?.isOwner) return;
    const coordinator = game.users.activeGM
      ?? game.users.find(user => user.active && actor.testUserPermission(user, "OWNER"));
    if ((coordinator?.id ?? userId) !== game.user.id) return;
    const uuid = actor.uuid;
    const task = (pending.get(uuid) ?? Promise.resolve()).then(async () => {
      const current = await foundry.utils.fromUuid(uuid);
      if (!current?.isOwner) return;
      const seen = new Set();
      for (;;) {
        const plan = await planItemGrants(current);
        if (!plan) break;
        if (seen.has(plan.signature)) {
          console.warn(`${MODULE_ID} | Add Item rules on ${current.name} could not settle. Check for rules that disable their own source.`);
          break;
        }
        seen.add(plan.signature);
        if (plan.remove.length) await current.deleteEmbeddedDocuments("Item", plan.remove, {sbeItemGrant: true});
        if (plan.create.length) await current.createEmbeddedDocuments("Item", plan.create, {renderSheet: false, sbeItemGrant: true});
      }
    }).catch(error => console.error(`${MODULE_ID} | Add Item: ${actor.name}`, error)).finally(() => {
      if (pending.get(uuid) === task) pending.delete(uuid);
    });
    pending.set(uuid, task);
  }
  for (const event of ["create", "update", "delete"]) {
    Hooks.on(`${event}ActiveEffect`, (effect, ...args) => {
      if (!args.at(-2)?.sbeItemGrant) schedule(effect.actor, args.at(-1));
    });
    Hooks.on(`${event}Item`, (item, ...args) => {
      if (!args.at(-2)?.sbeItemGrant) schedule(item.actor, args.at(-1));
    });
  }
  Hooks.on("createActor", (actor, _options, userId) => schedule(actor, userId));
  Hooks.on("updateActor", (actor, change, options, userId) => {
    if (!options.sbeItemGrant && (change.effects || change.items)) schedule(actor, userId);
  });
  Hooks.on("createToken", (token, _options, userId) => {
    if (!token.actorLink) schedule(token.actor, userId);
  });
  Hooks.on("updateToken", (token, change, options, userId) => {
    if (!options.sbeItemGrant && !token.actorLink && change.delta) schedule(token.actor, userId);
  });
  Hooks.once("ready", () => {
    for (const actor of game.actors) schedule(actor, game.user.id);
    for (const token of canvas.scene?.tokens ?? []) if (!token.actorLink) schedule(token.actor, game.user.id);
  });
  Hooks.on("canvasReady", () => {
    for (const token of canvas.scene?.tokens ?? []) if (!token.actorLink) schedule(token.actor, game.user.id);
  });
}
