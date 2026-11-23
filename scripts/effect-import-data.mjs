import {EFFECT_TYPE, MODULE_ID} from "./constants.mjs";

export function effectItemData(source, folder = null) {
  const effect = structuredClone(source);
  for (const key of ["_id", "_stats", "folder", "sort"]) delete effect[key];
  effect.transfer = false;
  effect.disabled = false;
  effect.origin = null;
  effect.start = null;
  effect.duration = {...effect.duration, expired: false};
  const flags = effect.flags?.[MODULE_ID];
  if (flags) for (const key of ["templateUuid", "itemEffect", "lingeringState", "lingeringParent", "lingeringProgress", "lingeringAppliedTurn", "lingeringSource"]) delete flags[key];
  return {name: effect.name, img: effect.img, type: EFFECT_TYPE, folder,
    system: {description: effect.description ?? ""}, effects: [effect]};
}
