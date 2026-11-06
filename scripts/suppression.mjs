import {isFlagSuppressed, isGear, itemGrantsFlags} from "./default-flags.mjs";
import {resolveEffectState, setNativeSuppressionGetter} from "./flag-changes.mjs";
import {wrapMethod} from "./effects.mjs";

export function installEffectSuppression() {
  const proto = CONFIG.ActiveEffect.documentClass.prototype;
  let owner = proto, descriptor;
  while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, "isSuppressed"))) owner = Object.getPrototypeOf(owner);
  const native = descriptor.get;
  setNativeSuppressionGetter(effect => effect.documentName === "ActiveEffect" ? native.call(effect) : !!effect.isSuppressed);
  Object.defineProperty(proto, "isSuppressed", {...descriptor, get() {
    if (native.call(this) || this.duration?.expired) return true;
    const actor = this.actor;
    if (!actor || this.disabled) return false;
    const applicable = new Set(actor.allApplicableEffects());
    const effects = [...applicable, ...[...actor.items].flatMap(item => [...item.effects])];
    return resolveEffectState(effects, {grantsFlags: effect => applicable.has(effect)
      && (!isGear(effect.parent) || itemGrantsFlags(effect.parent))}).suppressed.has(this);
  }});
  wrapMethod(CONFIG.Actor.documentClass.prototype, "calcFatiguePenalties", function (original, ...args) {
    return isFlagSuppressed(this, "fatigue") ? 0 : original(...args);
  });
}
