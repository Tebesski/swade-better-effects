export const LINGERING_PARENT = "lingeringParent";
export const LINGERING_APPLIED_TURN = "lingeringAppliedTurn";

export function isApplicationTurn(applied, combat, combatant, turn) {
  if (applied?.combat !== combat.id || !Number.isInteger(applied.round)) return false;
  if (turn.round < applied.round) return true;
  if (turn.round > applied.round) return false;
  return applied.combatant ? applied.combatant === combatant.id : applied.turn === turn.turn;
}

export function outcomeEffects(outcome) {
  const entries = Array.isArray(outcome.effects) ? outcome.effects
    : outcome.effectUuid ? [{uuid: outcome.effectUuid}] : [];
  return entries.filter(entry => typeof entry?.uuid === "string" && entry.uuid.trim())
    .map(entry => ({uuid: entry.uuid.trim(), removeWithParent: entry.removeWithParent !== false}));
}
