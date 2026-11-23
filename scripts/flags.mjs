import {t as sbsI18n} from "./i18n.mjs";
import {APPLICATION_KEY, MODULE_ID, RESTRICT_KEY, SUPPRESS_KEY, TEMPLATE} from "./constants.mjs";
import {normalizeFlag, normalizeFlags, predicateFlags} from "./rules.mjs";
import {ancestryFlag, effectiveFlags, excludedFlags, flagActivation, flagInputData, flagsAfterAncestryChange, flagsAfterEquipmentChange, isGear, STANDARD_FLAGS} from "./default-flags.mjs";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";

export const documentFlags = effectiveFlags;

export function rollTarget(context, token, actor = token?.actor) {
  const document = token?.document ?? token;
  const item = context.targetItemId && context.targetUuids?.includes(document?.uuid)
    ? actor?.items?.get(context.targetItemId) : undefined;
  const flags = item ? documentFlags(item) : [...documentFlags(actor, document?.documentName === "Token" ? document : undefined), ...documentFlags(document)];
  globalThis.Hooks?.callAll("swadeBetterEffectsTargetFlags", context, document, actor, item, flags);
  return {item, flags: normalizeFlags(flags)};
}
let catalogSource;
let catalog;
let knownFlags;
export function catalogFlags() {
  const setting = game.settings.get(MODULE_ID, "flagLibrary", {document: true});
  const source = setting.id ? setting.value : null;
  if (source !== catalogSource) {
    catalogSource = source;
    catalog = Object.freeze(normalizeFlags([...STANDARD_FLAGS, ...(source ?? [])]));
    knownFlags = new Set(catalog);
  }
  return catalog;
}

const canRememberFlags = () => game.user.isGM && (game.users.activeGM?.isSelf ?? true);
const pendingFlags = new Set();
let pendingCatalog;
export function rememberFlags(flags) {
  if (!canRememberFlags()) return;
  const additions = normalizeFlags(flags);
  if (!additions.length) return pendingCatalog;
  catalogFlags();
  for (const flag of additions) if (!knownFlags.has(flag)) pendingFlags.add(flag);
  if (pendingFlags.size && !pendingCatalog) pendingCatalog = savePendingFlags();
  return pendingCatalog;
}

async function savePendingFlags() {
  try {
    // Collect changes emitted together by a single Foundry document operation.
    await Promise.resolve();
    while (pendingFlags.size) {
      const current = catalogFlags();
      const additions = [...pendingFlags].filter(flag => !knownFlags.has(flag));
      pendingFlags.clear();
      if (additions.length && canRememberFlags()) await game.settings.set(MODULE_ID, "flagLibrary", [...current, ...additions].sort());
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Flag library`, error);
  } finally {
    pendingCatalog = undefined;
  }
}

export function flagsInDocument(document) {
  const data = document.flags?.[MODULE_ID] ?? {};
  return normalizeFlags([...documentFlags(document), ...(data.context?.roll ?? []), ...(data.conditions ?? []).flatMap(c => predicateFlags(c?.predicate)),
    ...(document.system?.changes ?? []).flatMap(change => [MODIFY_FLAG_KEY, SUPPRESS_KEY].includes(change.key) ? String(change.value ?? "").split(",").filter(flag => !flag.includes("*")).flatMap(normalizeFlags)
      : change.key === APPLICATION_KEY ? normalizeFlags(change.value?.flags)
      : change.key === RESTRICT_KEY ? (change.value?.rollFlags ?? []).filter(flag => !flag.includes("*")).flatMap(normalizeFlags) : []),
    ...(data.rules ?? []).flatMap(r => predicateFlags(r.predicate))]);
}

export function registerFlagHooks() {
  Hooks.once("ready", async () => {
    if (!canRememberFlags()) return;
    const docs = [...game.actors, ...game.items, ...game.scenes];
    const flags = new Set();
    for (let start = 0; start < docs.length; start += 50) {
      for (const doc of docs.slice(start, start + 50)) {
        for (const entry of [doc, ...(doc.items ?? []), ...(doc.allApplicableEffects?.() ?? doc.effects ?? [])]) {
          for (const flag of flagsInDocument(entry)) flags.add(flag);
        }
      }
      if (start + 50 < docs.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return rememberFlags([...flags]);
  });
  for (const type of ["Actor", "Item", "Token", "ActiveEffect", "Scene", "JournalEntry", "ChatMessage"]) {
    Hooks.on(`preCreate${type}`, document => {
      if (type === "ActiveEffect") document.updateSource({[`flags.${MODULE_ID}.nameFlag`]: normalizeFlag(document.name)});
      const flags = document.flags?.[MODULE_ID];
      if (flags && "tags" in flags) document.updateSource({[`flags.${MODULE_ID}.tags`]: normalizeFlags(flags.tags)});
      if (flags && "excludedTags" in flags) document.updateSource({[`flags.${MODULE_ID}.excludedTags`]: normalizeFlags(flags.excludedTags)});
    });
    Hooks.on(`preUpdate${type}`, (document, changes) => {
      if (type === "ActiveEffect") {
        const nameFlag = normalizeFlag(changes.name ?? document.name);
        if (Object.hasOwn(changes, "name") || document.getFlag(MODULE_ID, "nameFlag") !== nameFlag) foundry.utils.setProperty(changes, `flags.${MODULE_ID}.nameFlag`, nameFlag);
      }
      const key = `flags.${MODULE_ID}.tags`;
      const value = foundry.utils.getProperty(changes, key);
      if (value !== undefined) foundry.utils.setProperty(changes, key, normalizeFlags(value));
      if (Object.hasOwn(changes, key)) changes[key] = normalizeFlags(changes[key]);
      const excludedKey = `flags.${MODULE_ID}.excludedTags`;
      const excluded = Object.hasOwn(changes, excludedKey) ? changes[excludedKey] : foundry.utils.getProperty(changes, excludedKey);
      if (excluded !== undefined) {
        if (Object.hasOwn(changes, excludedKey)) changes[excludedKey] = normalizeFlags(excluded);
        else foundry.utils.setProperty(changes, excludedKey, normalizeFlags(excluded));
      } else if (value !== undefined || Object.hasOwn(changes, key)) {
        const tags = normalizeFlags(Object.hasOwn(changes, key) ? changes[key] : value);
        foundry.utils.setProperty(changes, excludedKey, excludedFlags(document).filter(flag => !tags.includes(flag)));
      }
    });
    for (const event of ["create", "update"]) Hooks.on(`${event}${type}`, document => {
      if (canRememberFlags()) return rememberFlags(flagsInDocument(document));
    });
  }
  Hooks.on("preUpdateActor", (actor, changes) => {
    const path = "system.details.species.name";
    const value = Object.hasOwn(changes, path) ? changes[path] : foundry.utils.getProperty(changes, path);
    if (value === undefined || [...actor.items].some(item => item.type === "ancestry") || normalizeFlag(value) === ancestryFlag(actor)) return;
    const key = `flags.${MODULE_ID}.excludedTags`;
    const pending = Object.hasOwn(changes, key) ? changes[key] : foundry.utils.getProperty(changes, key);
    const data = flagsAfterAncestryChange({flags: {[MODULE_ID]: {excludedTags: pending ?? excludedFlags(actor)}}}, value);
    if (Object.hasOwn(changes, key)) changes[key] = data.excludedTags;
    else foundry.utils.setProperty(changes, key, data.excludedTags);
  });
  Hooks.on("preUpdateItem", (item, changes, options) => {
    if (item.type !== "ancestry" || !item.actor || item.actor.ancestry?.id !== item.id || !Object.hasOwn(changes, "name")) return;
    if (normalizeFlag(changes.name) !== normalizeFlag(item.name)) options.sbeAncestryChanged = true;
  });
  const refreshAncestry = (item, options, userId) => {
    const actor = item.actor;
    if (item.type !== "ancestry" || !actor?.isOwner || userId !== game.user.id) return;
    const flag = ancestryFlag(actor);
    if (!flag || !excludedFlags(actor).includes(flag)) return;
    actor.update({[`flags.${MODULE_ID}.excludedTags`]: flagsAfterAncestryChange(actor, flag).excludedTags})
      .catch(error => ui.notifications.error(error.message));
  };
  Hooks.on("updateItem", (item, _changes, options, userId) => {
    if (options.sbeAncestryChanged) refreshAncestry(item, options, userId);
  });
  Hooks.on("createItem", refreshAncestry);
  Hooks.on("deleteItem", refreshAncestry);
  Hooks.on("preUpdateItem", (item, changes) => {
    const stateKey = "system.equipStatus";
    const state = Object.hasOwn(changes, stateKey) ? changes[stateKey] : foundry.utils.getProperty(changes, stateKey);
    if (!isGear(item) || state === undefined || Number(state) === Number(item.system.equipStatus)) return;
    const data = structuredClone(item.flags?.[MODULE_ID] ?? {});
    for (const key of ["tags", sbsI18n("swade-better-effects.UI.excludedTags_e68b10a6ab")]) {
      const path = `flags.${MODULE_ID}.${key}`;
      const value = Object.hasOwn(changes, path) ? changes[path] : foundry.utils.getProperty(changes, path);
      if (value !== undefined) data[key] = value;
    }
    const next = flagsAfterEquipmentChange({flags: {[MODULE_ID]: data}});
    for (const [key, value] of Object.entries(next)) {
      const path = `flags.${MODULE_ID}.${key}`;
      if (Object.hasOwn(changes, path)) changes[path] = value;
      else foundry.utils.setProperty(changes, path, value);
    }
  });
}

export class FlagLibrary extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sbe-flag-library", tag: "form", classes: ["sbe-app"], window: {get title() { return sbsI18n("swade-better-effects.UI.BetterEffectsFlagLibrary_8a99e82656"); }}, position: {width: 500},
    form: {handler: FlagLibrary.save, closeOnSubmit: true}, actions: {scan: FlagLibrary.scan, add: FlagLibrary.add, remove: FlagLibrary.remove}
  };
  static PARTS = {form: {template: `${TEMPLATE}/flag-library.hbs`}};
  async _prepareContext() {
    this.draft ??= catalogFlags();
    return {flags: this.draft.map(flag => ({name: flag, builtIn: STANDARD_FLAGS.includes(flag)})), editable: game.user.isGM, query: this.query ?? "", newFlags: this.newFlags ?? ""};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const search = this.element.querySelector('[type="search"]');
    const filter = () => {
      this.query = search.value;
      const query = normalizeFlag(search.value);
      const rows = this.element.querySelectorAll("[data-library-flag]");
      for (const row of rows) row.hidden = !!query && !row.dataset.libraryFlag.includes(query);
      this.element.querySelector(".sbe-library-empty").hidden = [...rows].some(row => !row.hidden);
    };
    search.addEventListener("input", filter); filter();
    this.element.querySelector('[name="newFlags"]')?.addEventListener("input", event => { this.newFlags = event.target.value; });
    if (this.element.dataset.sbeLibraryBound) return;
    this.element.dataset.sbeLibraryBound = "true";
    this.element.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.matches('input')) {
        event.preventDefault();
        if (event.target.name === "newFlags") FlagLibrary.add.call(this);
      }
      if (["Enter", " "].includes(event.key) && event.target.matches('a[data-action="remove"]')) { event.preventDefault(); event.target.click(); }
    });
  }
  static add() {
    if (!game.user.isGM) return;
    const input = this.element.querySelector('[name="newFlags"]');
    this.draft = normalizeFlags([...this.draft, ...normalizeFlags(input.value)]);
    this.newFlags = "";
    this.render();
  }
  static remove(_event, target) {
    if (!game.user.isGM || STANDARD_FLAGS.includes(target.dataset.flag)) return;
    this.draft = this.draft.filter(flag => flag !== target.dataset.flag);
    this.render();
  }
  static async save(_event, _form, data) {
    if (game.user.isGM) await game.settings.set(MODULE_ID, "flagLibrary", normalizeFlags([...this.draft, ...normalizeFlags(data.object.newFlags)]));
  }
  static async scan() {
    const docs = [...game.actors, ...game.items, ...game.scenes];
    const flags = [];
    for (const doc of docs) {
      flags.push(...flagsInDocument(doc));
      for (const item of doc.items ?? []) flags.push(...flagsInDocument(item));
      for (const effect of doc.allApplicableEffects?.() ?? doc.effects ?? []) flags.push(...flagsInDocument(effect));
      for (const token of doc.tokens ?? []) flags.push(...flagsInDocument(token));
    }
    await rememberFlags(flags);
    this.draft = normalizeFlags([...(this.draft ?? catalogFlags()), ...flags]);
    this.render({force: true});
  }
}

export class DocumentFlagsEditor extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(document) { super(); this.document = document; }
  static DEFAULT_OPTIONS = {
    tag: "form", classes: ["sbe-app"], window: {get title() { return sbsI18n("swade-better-effects.UI.BetterEffectsFlags_46fc7f00ea"); }}, position: {width: 460},
    form: {handler: DocumentFlagsEditor.save, closeOnSubmit: true}
  };
  static PARTS = {form: {template: `${TEMPLATE}/document-flags.hbs`}};
  async _prepareContext() { return {name: this.document.name, tags: documentFlags(this.document).join(", "), editable: this.document.isOwner, inputId: `${this.id}-flags`, isGear: isGear(this.document), activation: flagActivation(this.document)}; }
  async _onRender(context, options) {
    await super._onRender(context, options);
    bindFlagSuggestions(this.element.querySelector('[name="tags"]'), catalogFlags, {multiple: true, normalize: normalizeFlag});
  }
  static async save(_event, _form, data) {
    if (this.document.isOwner) await saveDocumentFlags(this.document, data.object.tags, data.object.flagActivation);
  }
}

async function saveDocumentFlags(doc, value, activation) {
  const {tags, excludedTags} = flagInputData(doc, value);
  const changes = {[`flags.${MODULE_ID}.tags`]: tags, [`flags.${MODULE_ID}.excludedTags`]: excludedTags};
  if (isGear(doc) && activation) changes[`flags.${MODULE_ID}.flagActivation`] = activation;
  return doc.update(changes);
}

export function injectFlagField(app, html) {
  const doc = app.document;
  if (doc?.documentName === "Actor" && doc.type === "group") return;
  if (!doc || !["Actor", "Item", "Token", "ActiveEffect"].includes(doc.documentName)) return;
  const existing = html.querySelector(".sbe-tags-field");
  if (existing) {
    const input = existing.querySelector("input");
    if (input && input.ownerDocument.activeElement !== input) input.value = documentFlags(doc).join(", ");
    return;
  }
  const effectName = doc.documentName === "ActiveEffect" ? html.querySelector('[name="name"]') : null;
  const properties = html.querySelector('section[data-tab="properties"], .tab[data-tab="properties"]');
  const effects = doc.documentName === "Actor" && doc.type === "character" ? html.querySelector('section[data-tab="effects"], .tab[data-tab="effects"]') : null;
  const target = effectName?.parentElement ?? properties ?? effects ?? html.querySelector('.sheet-header .header-fields')
    ?? html.querySelector('section[data-tab="background"], section[data-tab="details"], .tab[data-tab="details"], section[data-tab="description"], .tab[data-tab="description"], .sheet-header');
  if (!target) return;
  const group = document.createElement("div");
  group.className = "form-group sbe-tags-field";
  const label = document.createElement("label"); label.textContent = sbsI18n("swade-better-effects.UI.Flags_f38d9950af");
  const fields = document.createElement("div"); fields.className = "form-fields";
  const input = document.createElement("input"); input.type = "text"; input.value = documentFlags(doc).join(", ");
  input.placeholder = sbsI18n("swade-better-effects.UI.firesilver_8578cc40fc"); input.disabled = !doc.isOwner;
  input.id = `${app.id}-sbe-flags`; label.htmlFor = input.id;
  input.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Flags_f38d9950af"));
  // This field owns its update, rather than letting the host form store a string in flags.tags.
  input.addEventListener("change", event => {
    event.stopImmediatePropagation();
    const value = input.value;
    saveDocumentFlags(doc, value, activation?.value).then(() => {
      if (input.value === value) input.value = documentFlags(doc).join(", ");
    }).catch(error => ui.notifications.error(error.message));
  });
  let activation;
  if (isGear(doc)) {
    activation = document.createElement("select"); activation.className = "sbe-flag-activation"; activation.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Flagactivation_a373ed66cc")); activation.disabled = !doc.isOwner;
    for (const [value, text] of [["equipped", sbsI18n("swade-better-effects.UI.Whenequipped_0a55e11457")], ["carried", sbsI18n("swade-better-effects.UI.Whencarried_e24f4b1e5f")]]) {
      const option = new Option(text, value); option.selected = value === flagActivation(doc); activation.append(option);
    }
    activation.addEventListener("change", event => { event.stopImmediatePropagation(); doc.setFlag(MODULE_ID, "flagActivation", activation.value).catch(error => ui.notifications.error(error.message)); });
  }
  fields.append(input); if (activation) fields.append(activation); group.append(label, fields);
  const trademark = properties?.querySelector('[name="system.trademark"]')?.closest(".form-group");
  if (effectName) effectName.after(group);
  else if (trademark) trademark.before(group); else if (effects) effects.append(group); else target.append(group);
  bindFlagSuggestions(input, catalogFlags, {multiple: true, normalize: normalizeFlag});
}
