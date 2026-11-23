import {changeSignature, flagMatcher, hasCondition, normalizeFlag, normalizeFlags, normalizePattern} from "./rules.mjs";
import {SUPPRESS_KEY} from "./constants.mjs";

export const MODIFY_FLAG_KEY = "sbe.modifyFlag";

const scope = "swade-better-effects";
const suppressionScopes = new WeakMap();
let nativeSuppressed = effect => !!effect.isSuppressed;
export function setNativeSuppressionGetter(getter) { nativeSuppressed = getter; }

// Share the graph only within a synchronous read or effect preparation phase.
// This keeps live changes to flags, equipment and duration visible on the next pass.
export function withSuppressionScope(actor, run) {
  if (!actor || suppressionScopes.has(actor)) return run();
  suppressionScopes.set(actor, {});
  try { return run(); }
  finally { suppressionScopes.delete(actor); }
}

export function scopedSuppression(actor, compute) {
  const state = suppressionScopes.get(actor);
  return state ? state.suppressed ??= compute() : compute();
}

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
  if (!changes.some(change => change.key === MODIFY_FLAG_KEY || change.key === SUPPRESS_KEY)) return [];
  const conditions = effect.flags?.[scope]?.conditions ?? [];
  if (!Array.isArray(conditions) || conditions.some((entry, index) => hasCondition(entry?.predicate) && entry.signature !== changeSignature(changes[index] ?? {}))) return [];
  return changes.filter((change, index) => [MODIFY_FLAG_KEY, SUPPRESS_KEY].includes(change.key) && !hasCondition(conditions[index]?.predicate))
    .flatMap(change => change.key === SUPPRESS_KEY
      ? suppressionFlags(change.value).map(flag => ({type: "subtract", flag, modifiersOnly: true}))
      : normalizeFlags(change.value).map(flag => ({type: change.type, flag})));
}

export function hasSuppressionRule(effect) {
  if (effect.disabled) return false;
  const changes = effect._source?.system?.changes ?? effect.system?.changes ?? [];
  return changes.some(change => change.key === SUPPRESS_KEY || change.key === MODIFY_FLAG_KEY && change.type === "subtract");
}

export function suppressionFlags(value) {
  return [...new Set((Array.isArray(value) ? value : String(value ?? "").split(","))
    .flatMap(entry => String(entry).split(",")).map(normalizePattern).filter(Boolean))].sort();
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

function effectState(effects, grantsFlags = () => true) {
  const candidates = [...new Set(effects)].filter(available);
  const active = new Set(), suppressed = new Set();
  const changes = new Map(candidates.map(effect => [effect, grantsFlags(effect) ? flagChanges(effect) : []]));
  if (![...changes.values()].some(rows => rows.some(row => row.type === "subtract"))) return {active: new Set(candidates), suppressed, changes};
  const incoming = new Map(candidates.map(effect => [effect, new Set()]));
  const outgoing = new Map(candidates.map(effect => [effect, new Set()]));
  const effectsByFlag = new Map();
  for (const effect of candidates) for (const flag of effectFlags(effect)) {
    if (!effectsByFlag.has(flag)) effectsByFlag.set(flag, []);
    effectsByFlag.get(flag).push(effect);
  }
  const wildcardTargets = new Map();
  const targetsFor = flag => {
    if (!flag.includes("*")) return effectsByFlag.get(flag) ?? [];
    if (!wildcardTargets.has(flag)) {
      const match = flagMatcher(flag);
      const targets = new Set();
      for (const [tag, effects] of effectsByFlag) if (match(tag)) for (const effect of effects) targets.add(effect);
      wildcardTargets.set(flag, targets);
    }
    return wildcardTargets.get(flag);
  };
  for (const source of candidates) for (const change of changes.get(source)) {
    if (change.type !== "subtract") continue;
    for (const target of targetsFor(change.flag)) {
      if (source === target) continue;
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
  return {active, suppressed, changes};
}

export function resolveEffectState(effects = [], {grantsFlags} = {}) {
  const {active, suppressed} = effectState(effects, grantsFlags);
  return {active, suppressed};
}

// Derive inherited flags without writing temporary additions or suppression to
// the actor. Suppressed effects supply neither their own flags nor their rules.
export function applyFlagChanges(flags, effects = []) {
  if (effects.length === 0) return normalizeFlags(flags);
  const add = [], remove = [];
  const {active, changes} = effectState(effects);
  for (const effect of active) {
    add.push(...effectFlags(effect));
    for (const change of changes.get(effect)) {
      if (change.type === "add") add.push(change.flag);
      else if (change.type === "subtract" && !change.modifiersOnly) remove.push(change.flag);
    }
  }
  const removed = new Set(remove);
  return normalizeFlags([...flags, ...add]).filter(flag => !removed.has(flag));
}

export function suppressionMatcher(effects) {
  const candidates = Array.isArray(effects) ? effects : [...effects];
  if (!candidates.some(hasSuppressionRule)) return null;
  const {active, changes} = effectState(candidates);
  const patterns = new Set();
  for (const effect of active) for (const change of changes.get(effect)) if (change.type === "subtract") patterns.add(change.flag);
  if (!patterns.size) return null;
  const wildcards = [...patterns].filter(flag => flag.includes("*")).map(flagMatcher);
  return flag => patterns.has(flag) || wildcards.some(match => match(flag));
}

export function suppressesFlag(effects, flag) {
  return suppressionMatcher(effects)?.(normalizeFlag(flag)) ?? false;
}
