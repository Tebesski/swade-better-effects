import {t as sbsI18n} from "./i18n.mjs";
import {ADD_ITEM_KEY, MODULE_ID} from "./constants.mjs";
import {conditionsValid} from "./effects.mjs";
import {hasCondition} from "./rules.mjs";
import {grantEquipmentState, occupiedHands} from "./grant-equipment.mjs";

const GRANT_SOURCE = "grantedItemSource";
export const isItemEffect = effect => effect?.parent?.documentName === "Item" && !!effect.getFlag(MODULE_ID, "itemEffect");

export function grantEquipOptions(item) {
  if (!item?.system || !("equipStatus" in item.system)) return [];
  const states = [[0, sbsI18n("swade-better-effects.UI.Stored_91da962689")], [1, sbsI18n("swade-better-effects.UI.Carried_4014b8870c")]];
  if (item.type === "weapon") {
    states.push([3, sbsI18n("swade-better-effects.UI.Equipped_c4dc8a3877")]);
  } else if (["armor", "shield"].includes(item.type) || item.system.equippable) {
    states.push([3, sbsI18n("swade-better-effects.UI.Equipped_c4dc8a3877")]);
  } else if (item.type === "gear" && item.system.isVehicular) {
    states.push([3, sbsI18n("swade-better-effects.UI.Installed_f8b32f4e92")]);
  }
  return states;
}

export function readItemGrant(value) {
  if (typeof value === "string") return {uuid: value.trim()};
  return {uuid: typeof value?.uuid === "string" ? value.uuid.trim() : "", equipStatus: value?.equipStatus, hand: value?.hand ?? "default"};
}

export async function resolveGrantItem(uuid) {
  const item = await foundry.utils.fromUuid(String(uuid ?? "").trim()).catch(() => null);
  return item?.documentName === "Item" && item.visible ? item : null;
}

function itemGrants(effect) {
  if (!effect.active || !conditionsValid(effect)) return [];
  const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
  return effect._source.system.changes
    .filter((change, index) => change.key === ADD_ITEM_KEY && change.type === "add" && !hasCondition(conditions[index]?.predicate))
    .map(change => readItemGrant(change.value)).filter(grant => grant.uuid);
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
  const wanted = new Map();
  for (const effect of roots) {
    for (const grant of itemGrants(effect)) {
      const {uuid} = grant;
      if (originalSources.has(uuid) || wanted.has(uuid)) continue;
      wanted.set(uuid, grant);
      const existing = managed.get(uuid)?.[0];
      for (const embedded of effectsByItem.get(existing?.id) ?? []) roots.add(embedded);
    }
  }
  const added = await Promise.all([...wanted].filter(([uuid]) => !managed.has(uuid)).map(async ([uuid, {equipStatus, hand}]) => {
    const item = await resolveGrantItem(uuid);
    if (!item || sourceUuids(item).some(source => originalSources.has(source))) return null;
    const data = item.toObject();
    for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete data[key];
    if (data.flags?.swade) delete data.flags.swade.hasGranted;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${GRANT_SOURCE}`, item.uuid);
    if ("equipStatus" in item.system) {
      return {data, uuid: item.uuid, equipStatus, hand, item};
    }
    return {data};
  }));
  const remove = [...managed].flatMap(([uuid, items]) => items.slice(wanted.has(uuid) ? 1 : 0).map(item => item.id));
  const create = added.filter(Boolean);
  const occupied = occupiedHands([...actor.items].filter(item => !remove.includes(item.id)));
  for (const grant of create) {
    if (!grant.item) continue;
    const before = new Set(occupied);
    grant.equipStatus = grantEquipmentState(grant.item, grant.equipStatus, grant.hand, occupied);
    grant.data.system.equipStatus = grant.equipStatus;
    if (grant.item.type === "shield" && grant.equipStatus === 3) {
      foundry.utils.setProperty(grant.data, `flags.${MODULE_ID}.grantedEquipHand`, [...occupied].find(hand => !before.has(hand)));
    }
  }
  if (!remove.length && !create.length) return;
  return {remove, create, signature: JSON.stringify([...wanted.keys()].sort())};
}

export function registerItemGrants() {
  const pending = new Map();
  Hooks.on("preCreateItem", (item, data, options) => {
    if (!options.sbeItemGrant) return;
    const source = data.flags?.[MODULE_ID]?.[GRANT_SOURCE];
    const state = options.sbeGrantEquipStatus?.[source];
    // SWADE's NPC creation defaults can overwrite the incoming equipment state.
    if (state !== undefined) item.updateSource({"system.equipStatus": state});
  });
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
        if (plan.create.length) {
          const sbeGrantEquipStatus = Object.fromEntries(plan.create.filter(grant => grant.equipStatus !== undefined)
            .map(({uuid, equipStatus}) => [uuid, equipStatus]));
          await current.createEmbeddedDocuments("Item", plan.create.map(grant => grant.data),
            {renderSheet: false, sbeItemGrant: true, sbeGrantEquipStatus});
        }
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
