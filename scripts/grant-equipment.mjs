import {t as sbsI18n} from "./i18n.mjs";
export function grantEquipmentState(item, requested, hand = sbsI18n("swade-better-effects.UI.default_37a8eec1ce"), occupied = new Set()) {
  const state = requested ?? item.system.equipStatus;
  if (state < 2 || !["weapon", "shield"].includes(item.type)) return state;
  const both = state === 5 || item.system.equipStatus === 5 || Number(item.system.hands) === 2;
  if (both) {
    if (occupied.size) return 1;
    occupied.add("main"); occupied.add("off");
    return 5;
  }
  const preferred = hand === "off" || hand === "default" && (state === 2 || item.type === "shield") ? "off" : "main";
  const selected = hand === "any" && occupied.has(preferred) ? (preferred === "main" ? "off" : "main") : preferred;
  if (occupied.has(selected)) return 1;
  occupied.add(selected);
  return item.type === "shield" ? 3 : selected === "main" ? 4 : 2;
}

export function occupiedHands(items) {
  const occupied = new Set();
  for (const item of items) {
    const state = Number(item.system.equipStatus);
    if (state < 2 || !["weapon", "shield"].includes(item.type)) continue;
    if (state === 5) { occupied.add("main"); occupied.add("off"); }
    else occupied.add(item.type === "shield" && state === 3
      ? item.flags?.["swade-better-effects"]?.grantedEquipHand ?? "off" : state === 2 ? "off" : "main");
  }
  return occupied;
}
