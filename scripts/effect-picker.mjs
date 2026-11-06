import {EFFECT_TYPE, MODULE_ID} from "./constants.mjs";

const FILTER = "effectPickerSources";
const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const packs = () => game.packs.filter(pack => pack.visible && pack.documentName === "Item");

export function registerEffectPicker() {
  game.settings.register(MODULE_ID, FILTER, {scope: "user", config: false, type: Object, default: {}});
}

export async function effectCatalog() {
  const entries = [];
  const add = (source, group, value, name, img) => entries.push({source, group, value, name, img});
  const addItem = (item, group, source = "world", uuid = item.uuid) => {
    if (item.getFlag?.(MODULE_ID, "scratch") || item.getFlag?.("swade-better-templates", "scratch")) return;
    if (item.type === EFFECT_TYPE) add(source, group, uuid, item.name, item.img);
    else if (item.effects?.[Symbol.iterator]) for (const effect of item.effects) {
      add(source, group, effect.uuid ?? `${uuid}.ActiveEffect.${effect._id}`, `${item.name} · ${effect.name}`, effect.img ?? item.img);
    }
  };
  for (const effect of CONFIG.statusEffects) {
    add("swade", "SWADE conditions", `status:${effect.id}`, game.i18n.localize(effect.name ?? effect.label), effect.img ?? effect.icon);
  }
  for (const item of game.items.filter(item => item.visible)) addItem(item, "World effects");
  const isTracker = game.modules.get("swade-better-powers")?.api?.isDurationTracker;
  for (const actor of game.actors.filter(actor => actor.visible)) {
    for (const effect of actor.effects) {
      if (!isTracker?.(effect) && !effect.getFlag("swade-better-templates", "regionUuid")) {
        add("world", `${actor.name} · Actor effects`, effect.uuid, effect.name, effect.img);
      }
    }
    for (const item of actor.items) addItem(item, `${actor.name} · Item effects`);
  }
  const indexed = await Promise.allSettled(packs().map(async pack => {
    const index = await pack.getIndex({fields: ["type", "effects"]});
    for (const item of index) addItem(item, pack.title, pack.collection, `Compendium.${pack.collection}.Item.${item._id}`);
  }));
  for (const result of indexed) if (result.status === "rejected") console.warn(`${MODULE_ID} | Could not index an effect pack`, result.reason);
  return [...new Map(entries.map(entry => [entry.value, entry])).values()]
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

let pending = Promise.resolve();
export async function pickEffect() {
  const entries = await effectCatalog();
  await pending.catch(() => {});
  const saved = game.settings.get(MODULE_ID, FILTER).sources;
  const savedSources = Array.isArray(saved) ? saved : null;
  const sources = [["world", "World effects"], ["swade", "SWADE conditions"],
    ...packs().map(pack => [pack.collection, pack.title]).sort((a, b) => a[1].localeCompare(b[1]))];
  const content = `<div class="sbe-effect-picker">
    <input type="search" placeholder="Search effects…" aria-label="Search effects">
    <details><summary>Effect sources <small data-source-count></small></summary><div class="sbe-effect-sources">
      ${sources.map(([id, title]) => `<label><input type="checkbox" name="source" value="${esc(id)}" ${!savedSources || savedSources.includes(id) ? "checked" : ""}> ${esc(title)}</label>`).join("")}
    </div><div class="sbe-effect-filter-actions"><button type="button" data-sources="all">Select all</button><button type="button" data-sources="none">Clear all</button></div></details>
    <div class="sbe-effect-picker-results">${entries.map((entry, index) => `<label data-source="${esc(entry.source)}" data-search="${esc(`${entry.name} ${entry.group}`.toLowerCase())}">
      <input type="radio" name="entry" value="${index}"><img src="${esc(entry.img || "icons/svg/aura.svg")}" alt=""><span>${esc(entry.name)}<small>${esc(entry.group)}</small></span></label>`).join("")}
      <p data-empty>No effects match the selected sources and search.</p></div></div>`;
  return foundry.applications.api.DialogV2.prompt({window: {title: "Choose an effect", icon: "fa-solid fa-list"}, position: {width: 480}, content, rejectClose: false,
    render: (_event, dialog) => {
      const root = dialog.element.querySelector(".sbe-effect-picker");
      const search = root.querySelector('input[type="search"]');
      const checks = [...root.querySelectorAll('input[name="source"]')];
      const rows = [...root.querySelectorAll("[data-source]")];
      const selected = () => checks.filter(check => check.checked).map(check => check.value);
      const refresh = () => {
        const allowed = new Set(selected());
        root.querySelector("[data-source-count]").textContent = allowed.size === checks.length ? "" : `(${allowed.size} of ${checks.length})`;
        const query = search.value.trim().toLowerCase();
        for (const row of rows) {
          row.hidden = !allowed.has(row.dataset.source) || !row.dataset.search.includes(query);
          if (row.hidden) row.querySelector("input").checked = false;
        }
        root.querySelector("[data-empty]").hidden = rows.some(row => !row.hidden);
      };
      const save = () => {
        refresh();
        const sources = [...selected(), ...(savedSources ?? []).filter(id => !checks.some(check => check.value === id))];
        pending = pending.catch(() => {}).then(() => game.settings.set(MODULE_ID, FILTER, {sources}));
        void pending.catch(error => ui.notifications.error(error.message));
      };
      search.addEventListener("input", refresh);
      for (const check of checks) check.addEventListener("change", save);
      for (const button of root.querySelectorAll("[data-sources]")) button.addEventListener("click", () => {
        for (const check of checks) check.checked = button.dataset.sources === "all";
        save();
      });
      refresh();
    }, ok: {label: "Insert", callback: (_event, button) => entries[Number(button.form.querySelector('input[name="entry"]:checked')?.value)]}});
}
