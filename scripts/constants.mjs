import {t as sbsI18n} from "./i18n.mjs";
export const MODULE_ID = "swade-better-effects";
export const MAP_KEY = "sbe.map";
export const ADD_ITEM_KEY = "sbe.addItem";
export const APPLICATION_KEY = "sbe.application";
export const DEFENSES = {
  "sbe.weakness": {selector: "weakness", get label() { return sbsI18n("swade-better-effects.UI.Weakness_f3e0689e79"); }, type: "add"},
  "sbe.resistance": {selector: "resistance", get label() { return sbsI18n("swade-better-effects.UI.Resistance_c35070bce1"); }, type: "subtract"},
  "sbe.immunity": {selector: "immunity", get label() { return sbsI18n("swade-better-effects.UI.Immunity_806f8b53f4"); }, type: "override"}
};
export const EFFECT_TYPE = `${MODULE_ID}.effect`;
export const ICON = "systems/swade/assets/icons/active-effect.svg";
export const TEMPLATE = `modules/${MODULE_ID}/templates`;
export const SOURCES = {get roll() { return sbsI18n("swade-better-effects.UI.Rollhasflag_5647f26446"); }, get opposed() { return sbsI18n("swade-better-effects.UI.Opposedrollhasflag_fcc3d4821a"); }, get attacker() { return sbsI18n("swade-better-effects.UI.Attackerhasflag_eebdf9ce3c"); }, get target() { return sbsI18n("swade-better-effects.UI.Targethasflag_1e6364359d"); }, get item() { return sbsI18n("swade-better-effects.UI.Itemhasflag_2973a94f6f"); }, get actor() { return sbsI18n("swade-better-effects.UI.Effectownerhasflag_1f1b8dbeb6"); }};
export const SELECTORS = {get toughness() { return sbsI18n("swade-better-effects.UI.Toughness_19cd2c1eec"); }, get armor() { return sbsI18n("swade-better-effects.UI.Armor_a592855d05"); }, get "incoming-damage"() { return sbsI18n("swade-better-effects.UI.Incomingdamage_2ba01b79a5"); }, get "outgoing-damage"() { return sbsI18n("swade-better-effects.UI.Outgoingdamage_97da73e95b"); }, get ap() { return sbsI18n("swade-better-effects.UI.Armorpiercing_3997da7298"); }};
export const OPERATIONS = {get add() { return sbsI18n("swade-better-effects.UI.Add_9fd728c66c"); }, get subtract() { return sbsI18n("swade-better-effects.UI.Subtract_63df016f96"); }, get multiply() { return sbsI18n("swade-better-effects.UI.Multiply_33bcea6384"); }, get override() { return sbsI18n("swade-better-effects.UI.Override_43bc0f5fc0"); }, get upgrade() { return sbsI18n("swade-better-effects.UI.Atleast_3251982cbf"); }, get downgrade() { return sbsI18n("swade-better-effects.UI.Atmost_6797626fe4"); }};
