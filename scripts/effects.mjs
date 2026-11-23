import {t as sbsI18n} from "./i18n.mjs";
import {ADD_ITEM_KEY, APPLICATION_KEY, DEFENSES, EFFECT_TYPE, MAP_KEY, MODULE_ID, RESTRICT_KEY, SUPPRESS_KEY} from "./constants.mjs";
import {changeSignature, conditionFor, customChangeName, hasCondition, isOwnerCondition, normalizeFlags, selectorForKey, testPredicate} from "./rules.mjs";
import {documentFlags} from "./flags.mjs";
import {MODIFY_FLAG_KEY, withSuppressionScope} from "./flag-changes.mjs";
import {NOTE_PREFIX, noteBaseKey, noteSelectorForKey} from "./note-rules.mjs";

export function conditionsValid(effect) {
  const conditions = effect.getFlag(MODULE_ID, "conditions") ?? [];
  if (!Array.isArray(conditions)) return false;
  const changes = effect._source.system.changes;
  return conditions.every((entry, index) => !hasCondition(entry?.predicate) || entry.signature === changeSignature(changes[index] ?? {}));
}

function collectChanges(effects, ownerFlags, {rules, notes}) {
  for (const effect of effects) {
    const flags = effect.flags[MODULE_ID] ?? {};
    const changes = effect._source.system.changes;
    // Ignore ordinary native effects before asking Foundry whether they're active.
    const legacy = rules && flags.rules?.length;
    if (!legacy && !(rules && flags.conditions?.some?.(entry => hasCondition(entry?.predicate)))
      && !changes.some(({key}) => (notes && key.startsWith(NOTE_PREFIX)) || (rules && isVirtualRollChange(key)))) continue;
    if (!effect.active) continue;
    if (legacy) for (const rule of flags.rules) rules.push({...structuredClone(rule), ownerFlags: ownerFlags(), label: rule.label || effect.name});
    if (!conditionsValid(effect)) continue;
    const conditions = flags.conditions;
    for (const [index, change] of changes.entries()) {
      if (notes && change.key.startsWith(NOTE_PREFIX)) {
        const selector = noteSelectorForKey(noteBaseKey(change.key) ?? "");
        if (selector) notes.push({id: `${effect.uuid}:${index}`, selector, label: customChangeName(change, index, conditions) || effect.name,
          html: String(change.value ?? ""), ownerFlags: ownerFlags(), predicate: structuredClone(conditionFor(change, index, conditions) ?? {op: "all", children: []})});
        continue;
      }
      if (!rules) continue;
      const predicate = conditionFor(change, index, conditions);
      if (!hasCondition(predicate) && !isVirtualRollChange(change.key)) continue;
      if (isOwnerCondition(change, predicate)) continue;
      const selector = selectorForKey(change.key);
      if (selector) rules.push({selector, predicate: structuredClone(predicate ?? {op: "all", children: []}), type: change.type, value: change.value,
        priority: change.priority ?? undefined, label: customChangeName(change, index, conditions) || effect.name, ownerFlags: ownerFlags()});
    }
  }
}

function isVirtualRollChange(key) {
  return key.startsWith("sbe.targetRoll.") || key.startsWith("sbe.powerRoll.") || key === MAP_KEY || Object.hasOwn(DEFENSES, key);
}

function collectActorChanges(actor, item, flags, result) {
  if (!actor) return result;
  return withSuppressionScope(actor, () => {
    const effects = new Set(actor.allApplicableEffects());
    for (const effect of item?.effects ?? []) if (!effect.transfer) effects.add(effect);
    collectChanges(effects, () => flags ??= documentFlags(actor), result);
    return result;
  });
}

export function collectRules(actor, item, ownerFlags) {
  return collectActorChanges(actor, item, ownerFlags, {rules: []}).rules;
}

export function collectEffectRules(effects, ownerFlags) {
  const rules = [];
  collectChanges(effects, () => ownerFlags, {rules});
  return rules;
}

export function collectRollEffects(actor, item, ownerFlags) {
  return collectActorChanges(actor, item, ownerFlags, {rules: [], notes: []});
}

export function wrapMethod(object, name, wrapper) {
  const original = object[name];
  if (typeof original !== "function" || original.sbeWrapped) return;
  const replacement = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
  Object.defineProperty(replacement, "sbeWrapped", {value: true});
  object[name] = replacement;
}

export function collectRollNotes(actor, item, ownerFlags) {
  return collectActorChanges(actor, item, ownerFlags, {notes: []}).notes;
}

export function installConditionGate() {
  wrapMethod(CONFIG.ActiveEffect.documentClass, "_updateTraitRollEffects", function (original, entries, change, ...args) {
    const result = original(entries, change, ...args);
    const effect = change.effect;
    const conditions = effect.getFlag(MODULE_ID, "conditions");
    if (!conditions?.some?.(entry => entry?.customName)) return result;
    // Foundry fills in the effective priority on the prepared change.
    const changes = effect._source.system.changes;
    const index = changes.findIndex(row => changeSignature(row) === changeSignature({...change, priority: row.priority ?? null}));
    const name = index < 0 ? "" : customChangeName(changes[index], index, conditions);
    if (name) {
      const entry = entries.find(row => row.effectID === effect.id);
      if (entry) entry.label = name;
    }
    return result;
  });
  wrapMethod(CONFIG.ActiveEffect.documentClass.prototype, "shouldApplyChange", function (original, change, options) {
    if (change.key.startsWith(NOTE_PREFIX) || change.key.startsWith("sbe.targetRoll.") || change.key.startsWith("sbe.powerRoll.") ||
      [MODIFY_FLAG_KEY, MAP_KEY, ADD_ITEM_KEY, APPLICATION_KEY, RESTRICT_KEY, SUPPRESS_KEY].includes(change.key) || Object.hasOwn(DEFENSES, change.key)) return false;
    const conditions = this.getFlag(MODULE_ID, "conditions");
    if (!conditions?.length) return original(change, options);
    // A standard-editor reorder must never turn a resistance into an unconditional bonus.
    if (!conditionsValid(this)) return false;
    const index = this.system.changes.indexOf(change);
    const predicate = conditions[index]?.predicate;
    if (hasCondition(predicate)) {
      if (!isOwnerCondition(change, predicate) || !this.actor) return false;
      if (!testPredicate(predicate, {actor: documentFlags(this.actor)})) return false;
    }
    return original(change, options);
  });
}

export async function applyEffectTemplate(template, actor) {
  if (!actor?.isOwner) throw new Error(sbsI18n("swade-better-effects.UI.Youneedownershipofthetarget_5bbd675b3b"));
  if (template.type !== EFFECT_TYPE) throw new Error(sbsI18n("swade-better-effects.UI.ThisitemisnotanEffect_e7540def19"));
  if (template.testUserPermission && !template.testUserPermission(game.user, "LIMITED")) throw new Error(sbsI18n("swade-better-effects.UI.YoucannotaccessthisEffecttemplate_127ad149f5"));
  const effects = template.effects?.contents ?? template.effects ?? [];
  if (!effects.length) throw new Error(sbsI18n("swade-better-effects.UI.ThisEffecttemplateisemptyFinish_01e81d3048"));
  const data = effects.map(effect => effectApplicationData(effect, template.uuid ?? template._stats?.compendiumSource ?? null));
  return actor.createEmbeddedDocuments("ActiveEffect", data);
}

export function effectApplicationData(effect, origin, binding) {
  const source = effect.toObject ? effect.toObject() : foundry.utils.deepClone(effect);
  for (const key of ["_id", "_stats", "folder", "sort"]) delete source[key];
  source.transfer = false;
  source.origin = origin;
  source.start = CONFIG.ActiveEffect.documentClass.getEffectStart();
  source.duration = {...source.duration, expired: false};
  source.flags ??= {};
  const flags = source.flags[MODULE_ID] = {...source.flags[MODULE_ID], templateUuid: origin};
  delete flags.lingeringState;
  delete flags.lingeringParent;
  delete flags.lingeringAppliedTurn;
  delete flags.lingeringSource;
  const actor = effect.actor;
  if (binding) flags.lingeringSource = binding;
  else if (actor) flags.lingeringSource = {actorUuid: actor.uuid, tokenUuid: actor.token?.uuid ?? null};
  return source;
}

export async function applyToSelected(template) {
  const actors = [...new Map((canvas.tokens?.controlled ?? []).map(t => [t.actor?.uuid, t.actor])).values()].filter(Boolean);
  if (!actors.length) return ui.notifications.warn(sbsI18n("swade-better-effects.UI.Selectatleastonetokenfirst_4050501bd5"));
  for (const actor of actors) await applyEffectTemplate(template, actor);
  ui.notifications.info(sbsI18n("swade-better-effects.UI.Appliedtoactors_4a36d27849", {p0: (template.name), p1: (actors.length)}));
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
  const replayed = new WeakSet();
  const applyDrop = (data, item) => {
    const tokens = canvas.tokens.placeables.filter(t => t.bounds.contains(data.x, data.y) && t.visible).reverse();
    const token = tokens[0];
    if (!token) return;
    return applyEffectTemplate(item, token.actor);
  };
  // Claim the DOM drop before another module interprets the item's image as a
  // tile. Compendium documents may require loading before their type is known.
  document.addEventListener("drop", event => {
    if (replayed.has(event) || !canvas.ready || !event.composedPath().includes(canvas.app.view)) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Item" || !data.uuid) return;
    const transfer = new DataTransfer();
    for (const type of event.dataTransfer.types) {
      if (type !== "Files") transfer.setData(type, event.dataTransfer.getData(type));
    }
    const target = event.target;
    const options = {bubbles: true, cancelable: true, composed: true, dataTransfer: transfer,
      clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
      altKey: event.altKey, metaKey: event.metaKey};
    const point = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
    event.preventDefault();
    event.stopImmediatePropagation();
    void CONFIG.Item.documentClass.fromDropData(data).then(item => {
      if (item?.type === EFFECT_TYPE) return applyDrop({...data, ...point}, item);
      const replay = new DragEvent("drop", options);
      replayed.add(replay);
      target.dispatchEvent(replay);
    }).catch(error => ui.notifications.error(error.message));
  }, {capture: true});
  document.addEventListener("dragstart", event => {
    try {
      const data = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (data.type === "Item" && templateType(data)) event.dataTransfer.setData("text/plain", JSON.stringify({...data, sbeEffect: true}));
    } catch { /* Other applications use other drag payloads. */ }
  });
  Hooks.on("dropCanvasData", (_canvas, data) => {
    if (data.type !== "Item" || !templateType(data)) return;
    CONFIG.Item.documentClass.fromDropData(data).then(item => applyDrop(data, item))
      .catch(error => ui.notifications.error(error.message));
    return false;
  });
}
