import {MODULE_ID, TEMPLATE} from "./constants.mjs";
import {mergeRequestPresets, validateRequest} from "./request-data.mjs";

const LEGACY_PACK = "world.better-effects-roll-requests";
const LEGACY_GENERATOR = 'if (!game.user.isGM) return ui.notifications.warn("Only a GM or Assistant GM can generate roll requests.");\nconst api = game.modules.get("swade-better-effects")?.api;\nif (!api) return ui.notifications.warn("Enable SWADE Better Effects first.");\nawait api.openRollRequest();';
let actions, libraryApp, migration;
export const savedRollRequests = () => structuredClone(game.settings.get(MODULE_ID, "rollRequests"));

export async function saveRollRequest({id, name, request}) {
  if (!game.user.isGM) throw new Error("Only a GM or Assistant GM can save roll requests.");
  const entry = {id: id || foundry.utils.randomID(), name, request: structuredClone(request)};
  if (!name?.trim() || !validateRequest(request)) throw new Error("Complete the roll request before saving it.");
  const entries = savedRollRequests(), index = entries.findIndex(item => item.id === entry.id);
  if (index < 0) entries.push(entry); else entries[index] = entry;
  await game.settings.set(MODULE_ID, "rollRequests", entries);
  return entry;
}

export function openRollRequestLibrary() {
  if (!game.user.isGM) return;
  if (libraryApp?.rendered) { libraryApp.bringToFront(); return libraryApp; }
  libraryApp ??= new RollRequestLibrary(); libraryApp.render({force: true}); return libraryApp;
}

export function registerRollRequestSettings(callbacks) {
  actions = callbacks;
  game.settings.register(MODULE_ID, "rollRequests", {scope: "world", config: false, type: Array, default: []});
  game.settings.registerMenu(MODULE_ID, "rollRequests", {name: "Roll Requests", label: "Manage roll requests", hint: "Create, edit, and generate saved roll requests.",
    icon: "fa-solid fa-dice", type: RollRequestLibrary, restricted: true});
  Hooks.on("updateSetting", setting => { if (setting.key === `${MODULE_ID}.rollRequests` && libraryApp?.rendered) libraryApp.render(); });
}

export class RollRequestLibrary extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(...args) { super(...args); libraryApp = this; }
  static DEFAULT_OPTIONS = {classes: ["sbe-app", "sbe-request-library"], position: {width: 580}, window: {title: "Roll Requests", icon: "fa-solid fa-dice"},
    actions: {
      createRequest: function () { actions.open(undefined, {fresh: true}); },
      editRequest: function (_event, target) { const entry = savedRollRequests().find(item => item.id === target.dataset.id); if (entry) actions.open(entry); },
      generateRequest: async function (_event, target) { const entry = savedRollRequests().find(item => item.id === target.dataset.id); if (entry) await actions.generate(entry.request); },
      deleteRequest: async function (_event, target) {
        if (!game.user.isGM) return;
        await game.settings.set(MODULE_ID, "rollRequests", savedRollRequests().filter(item => item.id !== target.dataset.id));
      }
    }};
  static PARTS = {library: {template: `${TEMPLATE}/request-library.hbs`}};
  async _prepareContext() {
    if (!game.user.isGM) throw new Error("Only a GM or Assistant GM can manage roll requests.");
    return {query: this.query ?? "", entries: savedRollRequests().sort((a,b) => a.name.localeCompare(b.name)).map(entry => ({...entry,
      flags: entry.request.flags.join(", "), visibility: entry.request.recipients?.length
        ? `Private: ${entry.request.recipients.map(id => game.users.get(id)?.name ?? "Missing player").join(", ")}` : "Public"}))};
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const input = this.element.querySelector('[type="search"]');
    const filter = () => {
      this.query = input.value;
      const query = this.query.toLocaleLowerCase().trim();
      const rows = [...this.element.querySelectorAll("[data-request-search]")];
      for (const row of rows) row.hidden = !row.dataset.requestSearch.toLocaleLowerCase().includes(query);
      this.element.querySelector(".sbe-request-library-empty").hidden = rows.some(row => !row.hidden);
    };
    input.addEventListener("input", filter); filter();
    this.element.querySelectorAll('a[role="button"]').forEach(link => link.addEventListener("keydown", event => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); link.click(); }
    }));
  }
  async _onClose(options) { if (libraryApp === this) libraryApp = undefined; await super._onClose(options); }
}

// Transfer v0.9 presets before removing the obsolete Macro compendium and imports.
export function migrateRollRequestLibrary() {
  if (!game.user.isGM) return;
  migration ??= (async () => {
    const pack = game.packs.get(LEGACY_PACK), docs = pack ? await pack.getDocuments() : [];
    const imported = game.macros.filter(macro => validateRequest(macro.getFlag(MODULE_ID, "requestTemplate")));
    const incoming = [...docs, ...imported].filter(doc => validateRequest(doc.getFlag(MODULE_ID, "requestTemplate"))).map(doc => {
      const origin = doc._stats?.compendiumSource ?? doc.getFlag("core", "sourceId") ?? "";
      const originalId = origin.match(/^Compendium\.world\.better-effects-roll-requests\.(?:Macro\.)?([A-Za-z0-9]{16})$/)?.[1];
      return {id: originalId ?? doc.id, name: doc.name, request: doc.getFlag(MODULE_ID, "requestTemplate")};
    });
    if (incoming.length) await game.settings.set(MODULE_ID, "rollRequests", mergeRequestPresets(savedRollRequests(), incoming));
    // Preserve unrelated macros placed in the old pack as ordinary world macros.
    for (const doc of docs.filter(doc => !validateRequest(doc.getFlag(MODULE_ID, "requestTemplate")) )) {
      if (game.macros.some(macro => macro.getFlag(MODULE_ID, "legacyRequestSource") === doc.uuid)) continue;
      const data = doc.toObject(); delete data._id;
      data.folder = null;
      data.flags ??= {}; data.flags[MODULE_ID] = {...data.flags[MODULE_ID], legacyRequestSource: doc.uuid};
      if (data.flags.core?.sheetClass === `${MODULE_ID}.RollRequestSheet`) delete data.flags.core.sheetClass;
      await CONFIG.Macro.documentClass.create(data);
    }
    if (pack) { if (pack.locked) await pack.configure({locked: false}); await pack.deleteCompendium(); }
    const obsolete = game.macros.filter(macro => imported.includes(macro) || macro.command.replaceAll("\r\n", "\n").trim() === LEGACY_GENERATOR);
    if (obsolete.length) await CONFIG.Macro.documentClass.deleteDocuments(obsolete.map(macro => macro.id));
  })().catch(error => { migration = undefined; throw error; });
  return migration;
}
