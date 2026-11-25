import {EFFECT_TYPE, MODULE_ID} from "./constants.mjs";
import {normalizeFlag} from "./rules.mjs";

export function initializeTemplateCopy(item) {
  if (item.type !== EFFECT_TYPE || item.effects.size !== 1) return;
  const effect = item.effects.contents[0].toObject();
  effect.name = item.name;
  effect.flags ??= {};
  effect.flags[MODULE_ID] = {...effect.flags[MODULE_ID], nameFlag: normalizeFlag(item.name)};
  item.updateSource({effects: [effect]});
}
