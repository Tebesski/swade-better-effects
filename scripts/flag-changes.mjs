import {changeSignature, hasCondition, normalizeFlag, normalizeFlags} from "./rules.mjs";

export const MODIFY_FLAG_KEY = "sbe.modifyFlag";

const scope = "swade-better-effects";
let nativeSuppressed = effect => !!effect.isSuppressed;
export function setNativeSuppressionGetter(getter) { nativeSuppressed = getter; }

export function effectFlags(effect) {
  const data = effect.flags?.[scope] ?? {};
  const excluded = new Set(normalizeFlags(data.excludedTags));
  return normalizeFlags([normalizeFlag(effect.name), ...normalizeFlags(data.tags)]).filter(flag => !excluded.has(flag));
}

function available(effect) {
  return !(Object.hasOwn(effect, "active") && effect.active === false) && !effect.disabled && !effect.duration?.expired && !nativeSuppressed(effect);
}

function flagChanges(effect) {
  const changes = effect._source?.system?.changes ?? effect.system?.changes ?? [];
  const conditions = effect.flags?.[scope]?.conditions ?? [];
  if (!Array.isArray(conditions) || conditions.some((entry, index) => hasCondition(entry?.predicate) && entry.signature !== changeSignature(changes[index] ?? {}))) return [];
  return changes.filter((change, index) => change.key === MODIFY_FLAG_KEY && !hasCondition(conditions[index]?.predicate))
    .map(change => ({type: change.type, flag: normalizeFlag(change.value)})).filter(change => change.flag);
}

// Return a source component of the remaining suppression graph. Mutually
// suppressing cycles stay suspended; their outgoing rules do not run.
function sourceCycle(pending, outgoing, incoming) {
  const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
  let next = 0;
  function visit(node) {
    indices.set(node, next); low.set(node, next++); stack.push(node); onStack.add(node);
    for (const target of outgoing.get(node)) {
      if (!pending.has(target)) continue;
      if (!indices.has(target)) { visit(target); low.set(node, Math.min(low.get(node), low.get(target))); }
      else if (onStack.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)));
    }
    if (low.get(node) !== indices.get(node)) return;
    const component = new Set();
    let member;
    do { member = stack.pop(); onStack.delete(member); component.add(member); } while (member !== node);
    components.push(component);
  }
  for (const node of pending) if (!indices.has(node)) visit(node);
  return components.find(component => [...component].every(node => [...incoming.get(node)].every(source => !pending.has(source) || component.has(source))));
}

export function resolveEffectState(effects = [], {grantsFlags = () => true} = {}) {
  const candidates = [...new Set(effects)].filter(available);
  const active = new Set(), suppressed = new Set();
  const changes = new Map(candidates.map(effect => [effect, grantsFlags(effect) ? flagChanges(effect) : []]));
  if (![...changes.values()].some(rows => rows.some(row => row.type === "subtract"))) return {active: new Set(candidates), suppressed};
  const incoming = new Map(candidates.map(effect => [effect, new Set()]));
  const outgoing = new Map(candidates.map(effect => [effect, new Set()]));
  const tags = new Map(candidates.map(effect => [effect, new Set(effectFlags(effect))]));
  for (const source of candidates) for (const change of changes.get(source)) {
    if (change.type !== "subtract") continue;
    for (const target of candidates) {
      if (source === target || !tags.get(target).has(change.flag)) continue;
      outgoing.get(source).add(target); incoming.get(target).add(source);
    }
  }
  const pending = new Set(candidates);
  while (pending.size) {
    const roots = [...pending].filter(node => ![...incoming.get(node)].some(source => pending.has(source)));
    if (!roots.length) {
      for (const node of sourceCycle(pending, outgoing, incoming)) { suppressed.add(node); pending.delete(node); }
      continue;
    }
    for (const root of roots) { active.add(root); pending.delete(root); }
    for (const root of roots) for (const target of outgoing.get(root)) if (pending.delete(target)) suppressed.add(target);
  }
  return {active, suppressed};
}

// Derive inherited flags without writing temporary additions or suppression to
// the actor. Suppressed effects supply neither their own flags nor their rules.
export function applyFlagChanges(flags, effects = []) {
  const add = [], remove = [];
  for (const effect of resolveEffectState(effects).active) {
    add.push(...effectFlags(effect));
    for (const change of flagChanges(effect)) {
      if (change.type === "add") add.push(change.flag);
      else if (change.type === "subtract") remove.push(change.flag);
    }
  }
  const removed = new Set(remove);
  return normalizeFlags([...flags, ...add]).filter(flag => !removed.has(flag));
}

export function suppressesFlag(effects, flag) {
  const normalized = normalizeFlag(flag);
  return [...resolveEffectState(effects).active].some(effect => flagChanges(effect).some(change => change.type === "subtract" && change.flag === normalized));
}
