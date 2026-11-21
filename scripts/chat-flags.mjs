import {t as sbsI18n} from "./i18n.mjs";
import {rollTarget} from "./flags.mjs";
import {normalizeFlags} from "./rules.mjs";

export function flagList(flags) {
  const list = document.createElement("div");
  list.className = "sbe-roll-flags";
  for (const flag of normalizeFlags(flags)) {
    const badge = document.createElement("span");
    badge.className = "sbe-flag";
    badge.textContent = flag;
    list.append(badge);
  }
  if (!list.children.length) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.textContent = sbsI18n("swade-better-effects.UI.Noflags_50aa828f5b");
    list.append(empty);
  }
  return list;
}

function accordion(label, className) {
  const details = document.createElement("details");
  details.className = `sbe-chat-flags ${className}`;
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary);
  return details;
}

export function messageTargets(message, context) {
  const scene = game.scenes.get(message.speaker?.scene) ?? canvas.scene;
  const toolsTargets = message.flags?.["swade-tools"]?.usetarget;
  const uuids = toolsTargets ? String(toolsTargets).split(",").map(id => scene?.tokens.get(id)?.uuid)
    : message.getFlag("swade", "targets")?.map(target => target.uuid) ?? context.targetUuids ?? [];
  return [...new Set(uuids.filter(Boolean))].map(uuid => foundry.utils.fromUuidSync(uuid)).filter(Boolean);
}

export function renderChatFlags(message, html, context) {
  const content = html.querySelector(".message-content") ?? html;
  const roll = accordion(sbsI18n("swade-better-effects.UI.BetterEffectsflags_3bb5f82be2"), "sbe-chat-roll-flags");
  roll.append(flagList(context.roll));
  content.append(roll);

  // isGM includes Assistant GMs. Never put defender flags into shared message data
  // or even into the DOM of a player client.
  if (!game.user.isGM) return;
  const targets = messageTargets(message, context);
  if (!targets.length) return;
  for (const token of targets) {
    const row = [...html.querySelectorAll(".sbe-target-row")].find(row => row.dataset.tokenUuid === token.uuid);
    if (row) {
      row.querySelector(".sbe-target-flags")?.append(flagList(rollTarget(context, token).flags));
      continue;
    }
  }
}
