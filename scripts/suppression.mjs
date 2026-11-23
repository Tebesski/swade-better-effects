import {filterSuppressedModifiers, isFlagSuppressed, isGear, itemGrantsFlags} from "./default-flags.mjs";
import {hasSuppressionRule, resolveEffectState, scopedSuppression, setNativeSuppressionGetter, withSuppressionScope} from "./flag-changes.mjs";
import {wrapMethod} from "./effects.mjs";

export function installEffectSuppression() {
  const proto = CONFIG.ActiveEffect.documentClass.prototype;
  let owner = proto, descriptor;
  while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, "isSuppressed"))) owner = Object.getPrototypeOf(owner);
  const native = descriptor.get;
  const none = new Set();
  setNativeSuppressionGetter(effect => effect.documentName === "ActiveEffect" ? native.call(effect) : !!effect.isSuppressed);
  Object.defineProperty(proto, "isSuppressed", {...descriptor, get() {
    if (native.call(this) || this.duration?.expired) return true;
    const actor = this.actor;
    if (!actor || this.disabled) return false;
    return scopedSuppression(actor, () => {
      const applicable = [...actor.allApplicableEffects()];
      const eligible = effect => !isGear(effect.parent) || itemGrantsFlags(effect.parent);
      if (!applicable.some(effect => hasSuppressionRule(effect) && eligible(effect))) return none;
      const sources = new Set(applicable.filter(eligible));
      for (const item of actor.items) for (const effect of item.effects) applicable.push(effect);
      return resolveEffectState(applicable, {grantsFlags: effect => sources.has(effect)}).suppressed;
    }).has(this);
  }});
  wrapMethod(CONFIG.Actor.documentClass.prototype, "applyActiveEffects", function (original, ...args) {
    return withSuppressionScope(this, () => original(...args));
  });
  wrapMethod(CONFIG.Actor.documentClass.prototype, "calcFatiguePenalties", function (original, ...args) {
    return isFlagSuppressed(this, "fatigue") ? 0 : original(...args);
  });
  wrapMethod(CONFIG.Actor.documentClass.prototype, "calcWoundPenalties", function (original, ...args) {
    return isFlagSuppressed(this, "wounds") ? 0 : original(...args);
  });
  wrapMethod(CONFIG.Actor.documentClass.prototype, "calcStatusPenalties", function (original, ...args) {
    return isFlagSuppressed(this, "distracted") ? 0 : original(...args);
  });
  wrapMethod(CONFIG.Actor.documentClass.prototype, "getTraitRollModifiers", function (original, ...args) {
    return filterSuppressedModifiers(this, original(...args));
  });
  // Work on the prepared modifier lists, preserving counters and stored data.
  // This also covers modifiers supplied directly by other modules.
  for (const hook of ["swadePreRollSkill", "swadePreRollAttribute", "swadeRollDamage"]) {
    Hooks.on(hook, (actor, _traitOrItem, _roll, modifiers) => { filterSuppressedModifiers(actor, modifiers); });
  }
}
