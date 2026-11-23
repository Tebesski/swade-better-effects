// Match RollDialog's modifier normalization when using native suppressChat rolls.
export function inlineDamageModifiers(modifiers) {
  return modifiers.filter(modifier => !modifier.ignore && String(modifier.value ?? "").trim()).map(modifier => {
    const value = String(modifier.value).trim();
    return {...modifier, value: /^[@+-]/.test(value) ? value : "+" + value};
  });
}

export function toolsDamageHits(shots) {
  return shots.flatMap((output, shot) => /swadetools-term-(?:hit|raise)\b|swadetools-rolldamage/.test(output)
    ? [{shot, raise: /swadetools-term-raise\b|data-swadetools-raise=["']?1/.test(output)}] : []);
}

export function sharedDamageResult(result, targetUuid) {
  // Nested Foundry roll terms may still contain Roll instances. Use their JSON
  // serialization, just as document updates and the player/GM query do.
  const copy = JSON.parse(JSON.stringify(result));
  copy.context.targetUuids = [targetUuid];
  if (copy.roll.options?.["swade-better-effects"]) copy.roll.options["swade-better-effects"].targetUuids = [targetUuid];
  return copy;
}
