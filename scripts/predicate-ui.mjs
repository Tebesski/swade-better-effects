import {SOURCES} from "./constants.mjs";
import {normalizePattern} from "./rules.mjs";
import {catalogFlags} from "./flags.mjs";

const element = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
};

export function mountPredicate(container, predicate, onChange = () => {}) {
  const replace = (node, data) => { for (const key of Object.keys(node)) delete node[key]; Object.assign(node, data); };
  // Keep a group at the root, including when editing an older single-condition effect.
  // The Add condition control must remain available after selecting IF or IF NOT.
  if (!["all", "any"].includes(predicate.op)) replace(predicate, {op: "all", children: [structuredClone(predicate)]});
  const list = element("datalist"); list.id = `sbe-predicate-${foundry.utils.randomID()}`;
  for (const flag of catalogFlags()) { const option = element("option"); option.value = flag; list.append(option); }
  const draw = () => { container.replaceChildren(renderNode(predicate, 0), list); };
  function renderNode(node, depth) {
    const root = element("div", "", "sbe-predicate-node");
    const bar = element("div", "", "sbe-predicate-bar");
    const isGroup = ["all", "any"].includes(node.op);
    if (isGroup) root.classList.add("sbe-condition-group");
    const flagNode = node.op === "flag" ? node : node.op === "not" && node.child?.op === "flag" ? node.child : null;
    const choices = depth === 0 ? {all: "ALL conditions (AND)", any: "ANY condition (OR)"}
      : isGroup ? {all: "ALL (AND)", any: "ANY (OR)", not: "IF NOT"} : {flag: "IF", not: "IF NOT"};
    const op = element("select"); op.setAttribute("aria-label", depth === 0 ? "Match conditions" : "Condition operator");
    for (const [value, label] of Object.entries(choices)) {
      const option = element("option", label); option.value = value; option.selected = node.op === value; op.append(option);
    }
    op.addEventListener("change", event => {
      event.stopPropagation(); const previous = structuredClone(node);
      const next = op.value === "flag" ? (previous.op === "not" ? previous.child : previous)
        : op.value === "not" ? {op: "not", child: previous}
          : {op: op.value, children: ["all", "any"].includes(previous.op) ? previous.children : [previous]};
      replace(node, next);
      onChange(); draw();
    });
    bar.append(op); root.append(bar);
    if (flagNode) {
      const source = element("select"); source.setAttribute("aria-label", "Flag source");
      for (const [value, label] of Object.entries(SOURCES)) {
        const option = element("option", label); option.value = value; option.selected = flagNode.source === value; source.append(option);
      }
      source.addEventListener("change", event => { event.stopPropagation(); flagNode.source = source.value; onChange(); });
      const input = element("input"); input.type = "text"; input.value = flagNode.flag; input.placeholder = "fire"; input.setAttribute("aria-label", "Flag"); input.setAttribute("list", list.id);
      input.addEventListener("change", event => { event.stopPropagation(); flagNode.flag = normalizePattern(input.value); input.value = flagNode.flag; onChange(); });
      bar.append(source, input);
    } else if (node.op === "not") {
      root.append(renderNode(node.child, depth + 1));
    } else {
      for (const [index, child] of node.children.entries()) {
        const childEl = renderNode(child, depth + 1);
        const remove = element("a", "", "sbe-remove-condition sbe-trash"); remove.role = "button"; remove.tabIndex = 0; remove.title = "Remove condition"; remove.setAttribute("aria-label", "Remove condition");
        remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
        remove.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); remove.click(); } });
        remove.addEventListener("click", event => { event.stopPropagation(); node.children.splice(index, 1); onChange(); draw(); });
        childEl.querySelector(":scope > .sbe-predicate-bar").append(remove);
        root.append(childEl);
      }
      if (depth < 10) {
        const actions = element("div", "", "sbe-condition-actions");
        const add = element("button", "Add condition"); add.type = "button";
        add.dataset.conditionAction = "add-condition";
        add.addEventListener("click", event => { event.stopPropagation(); node.children.push({op: "flag", source: "roll", flag: ""}); onChange(); draw(); });
        const group = element("button", "Add group"); group.type = "button"; group.dataset.conditionAction = "add-group";
        group.addEventListener("click", event => { event.stopPropagation(); node.children.push({op: "all", children: []}); onChange(); draw(); });
        actions.append(add, group); root.append(actions);
      }
    }
    return root;
  }
  draw();
}
