import {EFFECT_TYPE, MAP_KEY, MODULE_ID} from "./constants.mjs";
import {changeSignature, conditionFor, hasCondition, normalizeFlags, selectorForKey} from "./rules.mjs";
import {documentFlags} from "./flags.mjs";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";
import {NOTE_PREFIX, noteBaseKey, noteSelectorForKey} from "./note-rules.mjs";

export function conditionsValid(effect) {
  const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
  if (!Array.isArray(conditions)) return false;
  const changes = effect._source.system.changes;
  return conditions.every((entry, index) => !hasCondition(entry?.predicate) || entry.signature === changeSignature(changes[index] ?? {}));
}

export function collectRules(actor, item) {
  if (!actor) return [];
  const effects = [...actor.allApplicableEffects()];
  if (item) effects.push(...item.effects.filter(e => !e.transfer));
  const result = [];
  for (const effect of effects) {
    if (!effect.active) continue;
    const flags = effect.flags[MODULE_ID] ?? {};
    const ownerFlags = documentFlags(actor);
    for (const rule of flags.rules ?? []) result.push({...structuredClone(rule), ownerFlags, label: rule.label || effect.name});
    if (!conditionsValid(effect)) continue;
    const changes = effect._source.system.changes;
    for (const [index, change] of changes.entries()) {
      const predicate = conditionFor(change, index, flags.conditions);
      const selector = selectorForKey(change.key);
      if (selector && (hasCondition(predicate) || change.key.startsWith("sbe.targetRoll.") || change.key === MAP_KEY || selector.startsWith("power-roll:"))) result.push({selector, predicate: structuredClone(predicate ?? {op: "all", children: []}), type: change.type, value: change.value,
        priority: change.priority ?? undefined, label: effect.name, ownerFlags});
    }
  }
  return result;
}

export function wrapMethod(object, name, wrapper) {
  const original = object[name];
  if (typeof original !== "function" || original.sbeWrapped) return;
  const replacement = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
  Object.defineProperty(replacement, "sbeWrapped", {value: true});
  object[name] = replacement;
}

export function collectRollNotes(actor, item) {
  if (!actor) return [];
  const effects = new Set(actor.allApplicableEffects());
  if (item) for (const effect of item.effects) if (!effect.transfer) effects.add(effect);
  const notes = [];
  for (const effect of effects) {
    if (!effect.active || !conditionsValid(effect)) continue;
    const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
    for (const [index, change] of effect._source.system.changes.entries()) {
      if (!change.key.startsWith(NOTE_PREFIX)) continue;
      const selector = noteSelectorForKey(noteBaseKey(change.key) ?? "");
      if (selector) notes.push({id: `${effect.uuid}:${index}`, selector, label: effect.name, html: String(change.value ?? ""),
        ownerFlags: documentFlags(actor), predicate: structuredClone(conditionFor(change, index, conditions) ?? {op: "all", children: []})});
    }
  }
  return notes;
}

export function installConditionGate() {
  wrapMethod(CONFIG.ActiveEffect.documentClass.prototype, "shouldApplyChange", function (original, change, options) {
    if (change.key.startsWith(NOTE_PREFIX) || change.key.startsWith("sbe.targetRoll.") || change.key.startsWith("sbe.powerRoll.") || change.key === MODIFY_FLAG_KEY || change.key === MAP_KEY) return false;
    const conditions = this.getFlag(MODULE_ID, "conditions");
    if (!conditions?.length) return original(change, options);
    // A standard-editor reorder must never turn a resistance into an unconditional bonus.
    if (!conditionsValid(this)) return false;
    const index = this.system.changes.indexOf(change);
    const predicate = conditions[index]?.predicate;
    if (hasCondition(predicate)) return false;
    return original(change, options);
  });
}

export async function applyEffectTemplate(template, actor) {
  if (!actor?.isOwner) throw new Error("You need ownership of the target actor to apply effects.");
  if (template.type !== EFFECT_TYPE) throw new Error("This item is not an Effect template.");
  if (template.testUserPermission && !template.testUserPermission(game.user, "LIMITED")) throw new Error("You cannot access this Effect template.");
  const effects = template.effects?.contents ?? template.effects ?? [];
  if (!effects.length) throw new Error("This Effect template is empty. Finish creating it in A.E.G.I.S. first.");
  const data = effects.map(effect => {
    const source = effect.toObject ? effect.toObject() : foundry.utils.deepClone(effect);
    for (const key of ["_id", "_stats", "folder", "sort"]) delete source[key];
    source.transfer = false;
    source.origin = template.uuid ?? template._stats?.compendiumSource ?? null;
    source.start = {time: game.time.worldTime, combat: game.combat?.id ?? null, round: game.combat?.round ?? null, turn: game.combat?.turn ?? null};
    source.duration = {...source.duration, expired: false};
    source.flags ??= {}; source.flags[MODULE_ID] = {...source.flags[MODULE_ID], templateUuid: template.uuid ?? null};
    return source;
  });
  return actor.createEmbeddedDocuments("ActiveEffect", data);
}

export async function applyToSelected(template) {
  const actors = [...new Map((canvas.tokens?.controlled ?? []).map(t => [t.actor?.uuid, t.actor])).values()].filter(Boolean);
  if (!actors.length) return ui.notifications.warn("Select at least one token first.");
  for (const actor of actors) await applyEffectTemplate(template, actor);
  ui.notifications.info(`Applied ${template.name} to ${actors.length} actor(s).`);
}

export function installSheetDrops() {
  const seen = new Set();
  for (const sheetClass of Object.values(game.swade.sheets)) {
    let proto = sheetClass.prototype;
    while (proto && !seen.has(proto)) {
      seen.add(proto);
      if (Object.hasOwn(proto, "_onDropItem")) wrapMethod(proto, "_onDropItem", async function (original, event, data) {
        const item = await CONFIG.Item.documentClass.fromDropData(data);
        if (item?.type === EFFECT_TYPE) { await applyEffectTemplate(item, this.actor); return []; }
        return original(event, data);
      });
      if (Object.hasOwn(proto, "_onDropItemCreate")) wrapMethod(proto, "_onDropItemCreate", async function (original, data, ...rest) {
        const list = Array.isArray(data) ? data : [data];
        const templates = list.filter(d => d.type === EFFECT_TYPE);
        if (!templates.length) return original(data, ...rest);
        for (const template of templates) await applyEffectTemplate(template, this.actor);
        const normal = list.filter(d => d.type !== EFFECT_TYPE);
        return normal.length ? original(normal, ...rest) : [];
      });
      proto = Object.getPrototypeOf(proto);
    }
  }
}

function templateType(data) {
  if (data.sbeEffect) return true;
  if (!data.uuid) return false;
  try { if (foundry.utils.fromUuidSync(data.uuid)?.type === EFFECT_TYPE) return true; } catch { /* Unloaded compendium document. */ }
  const match = data.uuid.match(/^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/);
  return match && game.packs.get(match[1])?.index.get(match[2])?.type === EFFECT_TYPE;
}

export function registerCanvasDrops() {
  document.addEventListener("dragstart", event => {
    try {
      const data = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (data.type === "Item" && templateType(data)) event.dataTransfer.setData("text/plain", JSON.stringify({...data, sbeEffect: true}));
    } catch { /* Other applications use other drag payloads. */ }
  });
  Hooks.on("dropCanvasData", (_canvas, data) => {
    if (data.type !== "Item" || !templateType(data)) return;
    const tokens = canvas.tokens.placeables.filter(t => t.bounds.contains(data.x, data.y) && t.visible).reverse();
    const token = tokens[0];
    if (!token) { ui.notifications.warn("Drop the Effect directly onto a token."); return false; }
    CONFIG.Item.documentClass.fromDropData(data).then(item => applyEffectTemplate(item, token.actor))
      .catch(error => ui.notifications.error(error.message));
    return false;
  });
}
