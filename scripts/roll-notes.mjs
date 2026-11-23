import {t as sbsI18n} from "./i18n.mjs";
const pending = new WeakMap();
// Use Foundry's sanitizer before enriching user-authored markup.
export function cleanRollNote(html, {publicContent = false} = {}) {
  const content = document.createElement("div");
  content.innerHTML = foundry.utils.cleanHTML(String(html ?? ""));
  if (publicContent) content.querySelectorAll("section.secret:not(.revealed)").forEach(section => section.remove());
  return content.innerHTML;
}

export async function renderRollNotes(message, html, context) {
  const root = html[0] ?? html;
  const generation = {};
  pending.set(root, generation);
  root.querySelectorAll(".sbe-roll-notes[data-roll-notes]").forEach(node => node.remove());
  if (!context.notes?.length || message.isContentVisible === false || message.visible === false) return;
  const section = document.createElement("section"); section.className = "sbe-roll-notes";
  section.dataset.rollNotes = "true";
  section.setAttribute("aria-label", sbsI18n("swade-better-effects.UI.Rollnotes_6e1215b6ef")); section.tabIndex = 0;
  const actor = context.actorUuid ? foundry.utils.fromUuidSync(context.actorUuid) : null;
  for (const note of context.notes) {
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(cleanRollNote(note.html, {publicContent: true}),
      {secrets: false, relativeTo: actor, rollData: actor?.getRollData(), embeds: false});
    const entry = document.createElement("div"); entry.className = "sbe-roll-note";
    const label = document.createElement("strong"); label.className = "sbe-roll-note-label";
    label.textContent = note.target ? `${note.target} · ${note.label}` : note.label;
    const body = document.createElement("div"); body.className = "sbe-roll-note-body"; body.innerHTML = enriched;
    if (!body.textContent.trim() && !body.querySelector("img, hr")) continue;
    entry.append(label, body); section.append(entry);
  }
  if (pending.get(root) !== generation) return;
  if (section.children.length) (root.querySelector(".message-content") ?? root).append(section);
}
