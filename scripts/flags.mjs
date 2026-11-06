import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {normalizeFlag, normalizeFlags, predicateFlags} from "./rules.mjs";
import {ancestryFlag, effectiveFlags, excludedFlags, flagActivation, flagInputData, flagsAfterAncestryChange, flagsAfterEquipmentChange, isGear, STANDARD_FLAGS} from "./default-flags.mjs";
import {MODIFY_FLAG_KEY} from "./flag-changes.mjs";

export const documentFlags = effectiveFlags;
export function catalogFlags() { return normalizeFlags([...STANDARD_FLAGS, ...game.settings.get(MODULE_ID, "flagLibrary")]); }
let pendingCatalog = Promise.resolve();

export function rememberFlags(flags) {
  if (!game.user.isGM || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;
  const additions = normalizeFlags(flags);
  pendingCatalog = pendingCatalog.then(async () => {
    const old = catalogFlags();
    const next = normalizeFlags([...old, ...additions]);
    if (JSON.stringify(old) !== JSON.stringify(next)) await game.settings.set(MODULE_ID, "flagLibrary", next);
  }).catch(error => console.error(`${MODULE_ID} | Flag library`, error));
  return pendingCatalog;
}

export function flagsInDocument(document) {
  const data = document.flags?.[MODULE_ID] ?? {};
  return normalizeFlags([...documentFlags(document), ...(data.context?.roll ?? []), ...(data.conditions ?? []).flatMap(c => predicateFlags(c?.predicate)),
    ...(document.system?.changes ?? []).filter(change => change.key === MODIFY_FLAG_KEY).map(change => change.value),
    ...(data.rules ?? []).flatMap(r => predicateFlags(r.predicate))]);
}

export function registerFlagHooks() {
  Hooks.once("ready", () => {
    const docs = [...game.actors, ...game.items, ...game.scenes];
    return rememberFlags(docs.flatMap(doc => [...flagsInDocument(doc), ...[...(doc.items ?? [])].flatMap(flagsInDocument),
      ...[...(doc.allApplicableEffects?.() ?? doc.effects ?? [])].flatMap(flagsInDocument)]));
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
    for (const event of ["create", "update"]) Hooks.on(`${event}${type}`, document => rememberFlags(flagsInDocument(document)));
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
    for (const key of ["tags", "excludedTags"]) {
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
    id: "sbe-flag-library", tag: "form", classes: ["sbe-app"], window: {title: "Better Effects — Flag Library"}, position: {width: 500},
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
    tag: "form", classes: ["sbe-app"], window: {title: "Better Effects — Flags"}, position: {width: 460},
    form: {handler: DocumentFlagsEditor.save, closeOnSubmit: true}
  };
  static PARTS = {form: {template: `${TEMPLATE}/document-flags.hbs`}};
  async _prepareContext() { return {name: this.document.name, tags: documentFlags(this.document).join(", "), flags: catalogFlags(), editable: this.document.isOwner, listId: `${this.id}-flags`, isGear: isGear(this.document), activation: flagActivation(this.document)}; }
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
  if (!doc || !["Actor", "Item", "Token", "ActiveEffect"].includes(doc.documentName)) return;
  const existing = html.querySelector(".sbe-tags-field");
  if (existing) {
    const input = existing.querySelector("input");
    if (input && document.activeElement !== input) input.value = documentFlags(doc).join(", ");
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
  const label = document.createElement("label"); label.textContent = "Flags";
  const fields = document.createElement("div"); fields.className = "form-fields";
  const input = document.createElement("input"); input.type = "text"; input.value = documentFlags(doc).join(", ");
  input.placeholder = "fire, silver"; input.disabled = !doc.isOwner;
  input.id = `${app.id}-sbe-flags`; label.htmlFor = input.id;
  input.setAttribute("aria-label", "Flags");
  const list = document.createElement("datalist"); list.id = `${app.id}-sbe-tags`;
  input.setAttribute("list", list.id);
  const suggestions = () => {
    const parts = input.value.split(","); parts.pop(); const prefix = parts.map(p => p.trim()).filter(Boolean).join(", ");
    list.replaceChildren(...catalogFlags().map(flag => { const option = document.createElement("option"); option.value = prefix ? `${prefix}, ${flag}` : flag; return option; }));
  };
  suggestions(); input.addEventListener("input", suggestions);
  // This field owns its update, rather than letting the host form store a string in flags.tags.
  input.addEventListener("change", event => {
    event.stopImmediatePropagation();
    saveDocumentFlags(doc, input.value, activation?.value).then(() => { input.value = documentFlags(doc).join(", "); }).catch(error => ui.notifications.error(error.message));
  });
  let activation;
  if (isGear(doc)) {
    activation = document.createElement("select"); activation.className = "sbe-flag-activation"; activation.setAttribute("aria-label", "Flag activation"); activation.disabled = !doc.isOwner;
    for (const [value, text] of [["equipped", "When equipped"], ["carried", "When carried"]]) {
      const option = new Option(text, value); option.selected = value === flagActivation(doc); activation.append(option);
    }
    activation.addEventListener("change", event => { event.stopImmediatePropagation(); doc.setFlag(MODULE_ID, "flagActivation", activation.value).catch(error => ui.notifications.error(error.message)); });
  }
  fields.append(input, list); if (activation) fields.append(activation); group.append(label, fields);
  const trademark = properties?.querySelector('[name="system.trademark"]')?.closest(".form-group");
  if (effectName) effectName.after(group);
  else if (trademark) trademark.before(group); else if (effects) effects.append(group); else target.append(group);
}
