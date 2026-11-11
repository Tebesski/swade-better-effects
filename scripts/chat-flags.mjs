import {rollTarget} from "./flags.mjs";
import {normalizeFlags} from "./rules.mjs";

function flagList(flags) {
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
    empty.textContent = "No flags";
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
  const roll = accordion("Flags", "sbe-chat-roll-flags");
  roll.append(flagList(context.roll));
  content.append(roll);

  // isGM includes Assistant GMs. Never put defender flags into shared message data
  // or even into the DOM of a player client.
  if (!game.user.isGM) return;
  const targets = messageTargets(message, context);
  if (!targets.length) return;
  const targetFlags = accordion("Target flags", "sbe-chat-target-flags");
  for (const token of targets) {
    const group = document.createElement("section");
    const name = document.createElement("strong");
    name.textContent = token.name;
    group.append(name, flagList(rollTarget(context, token).flags));
    targetFlags.append(group);
  }
  html.append(targetFlags);
}
