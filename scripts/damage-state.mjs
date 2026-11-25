export async function applyDamageWounds(actor, token, incoming) {
  const {value, max} = actor.system.wounds;
  const total = value + incoming;
  await actor.update({"system.wounds.value": Math.min(max, total)});
  if (total <= max) return;
  if (!actor.statuses.has("incapacitated")) await actor.toggleActiveEffect("incapacitated", {active: true});
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const existing = actor.effects.find(effect => effect.statuses.has(defeated));
  if (existing) {
    if (!existing.getFlag("core", "overlay")) await existing.setFlag("core", "overlay", true);
  } else await actor.toggleActiveEffect(defeated, {active: true, overlay: true});
  // Status effects also cover actors outside initiative. Mark the damaged token's
  // combatants explicitly when the current user may update them.
  for (const combat of game.combats ?? []) {
    const updates = combat.combatants.filter(c => c.token?.uuid === token.uuid && !c.defeated
      && c.canUserModify(game.user, "update")).map(c => ({_id: c.id, defeated: true}));
    if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  }
}
