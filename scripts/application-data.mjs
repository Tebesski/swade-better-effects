import {t as sbsI18n} from "./i18n.mjs";
export const APPLICATION_BEHAVIOURS = {get note() { return sbsI18n("swade-better-effects.UI.Note_d8da2c49df"); }, get request() { return sbsI18n("swade-better-effects.UI.RequestRoll_f3e4f31128"); }, get effect() { return sbsI18n("swade-better-effects.UI.ApplyEffect_5b84c767f1"); }, get macro() { return sbsI18n("swade-better-effects.UI.ExecuteMacro_d3d8ff34d0"); }};
export const APPLICATION_CONDITIONS = {get attack() { return sbsI18n("swade-better-effects.UI.SuccessfulAttack_16787485eb"); }, get shaken() { return sbsI18n("swade-better-effects.UI.Shakenapplied_afe06dfb39"); }, get wounds() { return sbsI18n("swade-better-effects.UI.Woundsapplied_fcf8e1f7f0"); }};
export const APPLICATION_RECIPIENTS = {get target() { return sbsI18n("swade-better-effects.UI.Target_978354db0c"); }, get source() { return sbsI18n("swade-better-effects.UI.Source_0e570ca6fa"); }, get both() { return sbsI18n("swade-better-effects.UI.Both_b6c1d862f9"); }};

export function applicationMatches(rule, event) {
  if (rule.condition === "attack") return event.attack === true;
  if (rule.condition === "shaken") return event.shaken === true;
  return rule.condition === "wounds" && Number.isSafeInteger(rule.wounds) && rule.wounds >= 1 && event.wounds >= rule.wounds;
}
