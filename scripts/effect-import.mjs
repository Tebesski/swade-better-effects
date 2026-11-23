import {MODULE_ID} from "./constants.mjs";
import {effectItemData} from "./effect-import-data.mjs";
import {wrapMethod} from "./effects.mjs";

export function installEffectImports() {
  // Compendium sheets can be read-only: copying an effect doesn't edit its actor.
  const bound = new WeakSet();
  Hooks.on("renderApplicationV2", (app, html) => {
    const actor = app.document;
    if (actor?.documentName !== "Actor" || !actor.testUserPermission(game.user, "OBSERVER")) return;
    for (const row of html.querySelectorAll(".effect[data-effect-id]")) {
      const parent = row.dataset.parentId ? actor.items.get(row.dataset.parentId) : actor;
      const effect = parent?.effects.get(row.dataset.effectId);
      if (!effect || bound.has(row)) continue;
      bound.add(row);
      row.draggable = true;
      row.addEventListener("dragstart", event => {
        if (!event.dataTransfer) return;
        event.stopImmediatePropagation();
        event.dataTransfer.setData("text/plain", JSON.stringify(effect.toDragData()));
        event.dataTransfer.effectAllowed = "copy";
      }, {capture: true});
    }
  });
  wrapMethod(foundry.applications.sidebar.tabs.ItemDirectory.prototype, "_onDrop", async function (original, event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "ActiveEffect") return original(event);
    event.preventDefault();
    if (!CONFIG.Item.documentClass.canUserCreate(game.user)) return;
    try {
      const effect = await CONFIG.ActiveEffect.documentClass.fromDropData(data);
      if (!effect?.testUserPermission(game.user, "OBSERVER")) return;
      const target = event.target.closest(".directory-item");
      const entry = game.items.get(target?.dataset.entryId);
      const folder = entry?.folder?.id ?? target?.closest(".directory-item.folder")?.dataset.folderId ?? null;
      return await CONFIG.Item.documentClass.create(effectItemData(effect.toObject(), folder), {renderSheet: false});
    } catch (error) {
      console.error(`${MODULE_ID} | Import effect`, error);
      ui.notifications.error(error.message);
    }
  });
}
