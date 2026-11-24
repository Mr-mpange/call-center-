import { isDialable, cleanNumber } from "@/lib/phone";

/* ======================= Caller menu (IVR) flows ======================= */

export type NodeKind = "greeting" | "message" | "menu" | "hours" | "queue" | "transfer" | "ringgroup" | "voicemail" | "hangup" | "collectDigits" | "ifElse" | "switch" | "dayOfWeek" | "languageCondition" | "callerIdCondition" | "setVariable" | "getCallerNumber" | "wait" | "retry";

export interface MenuOption { key: string; label: string; next: string | null; targets?: string[] }
export interface IvrRoute { id: string; label: string; next: string | null; value?: string; targets?: string[] }
export interface IvrCondition { id: string; label: string; value: string; next: string | null; targets?: string[] }

export interface IvrNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** What the caller hears (greeting, message, menu prompt, voicemail prompt). */
  text?: string;
  /** Queue name, phone number or forwarding group name, depending on kind. */
  target?: string;
  /** Linear steps continue here. */
  next?: string | null;
  nextTargets?: string[];
  options?: MenuOption[];
  invalidNext?: string | null;
  invalidTargets?: string[];
  noInputNext?: string | null;
  noInputTargets?: string[];
  maxRetries?: number;
  noInputTimeoutSec?: number;
  routes?: IvrRoute[];
  conditions?: IvrCondition[];
  variableName?: string;
  variableValue?: string;
  expectedValue?: string;
  digitsLength?: number;
  waitSeconds?: number;
  retryLimit?: number;
  openNext?: string | null;
  closedNext?: string | null;
  openTargets?: string[];
  closedTargets?: string[];
  /** Canvas position in flow-builder coordinates. */
  x?: number;
  y?: number;
}

export interface IvrFlow { id: string; name: string; number: string; startId: string; nodes: Record<string, IvrNode>; published: boolean }

export const LINEAR_KINDS: NodeKind[] = ["greeting", "message"];
export const END_KINDS: NodeKind[] = ["queue", "transfer", "ringgroup", "voicemail", "hangup"];
export const MENU_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"];
export const QUEUES = ["General", "Billing", "Technical", "Sales", "VIP"];

export const KIND_LABEL: Record<NodeKind, string> = {
  greeting: "Welcome message", message: "Play message", menu: "Keypad menu", hours: "Opening hours check",
  queue: "Send to queue", transfer: "Forward to number", ringgroup: "Ring a phone group", voicemail: "Voicemail", hangup: "End call",
  collectDigits: "Collect digits", ifElse: "If / Else", switch: "Switch", dayOfWeek: "Day of week", languageCondition: "Language condition", callerIdCondition: "Caller ID condition", setVariable: "Set variable", getCallerNumber: "Get caller number", wait: "Wait", retry: "Retry",
};

let seq = 0;
export const nodeId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeNode(kind: NodeKind): IvrNode {
  const id = nodeId();
  switch (kind) {
    case "greeting": return { id, kind, label: "Welcome", text: "Karibu MPANGE. Welcome to MPANGE.", next: null };
    case "message": return { id, kind, label: "Message", text: "Thank you for calling.", next: null };
    case "menu": return { id, kind, label: "Menu", text: "Press 1 for … Press 2 for …", maxRetries: 3, noInputTimeoutSec: 5, options: [
      { key: "1", label: "Option 1", next: null },
      { key: "2", label: "Option 2", next: null },
    ] };
    case "hours": return { id, kind, label: "Are we open?", openNext: null, closedNext: null };
    case "queue": return { id, kind, label: "Queue", target: "General" };
    case "transfer": return { id, kind, label: "Forward", target: "+255 712 000 000" };
    case "ringgroup": return { id, kind, label: "Phone group", target: "Sales team" };
    case "voicemail": return { id, kind, label: "Voicemail", text: "Please leave a message after the tone." };
    case "hangup": return { id, kind, label: "Goodbye", text: "Asante. Goodbye." };
    case "collectDigits": return { id, kind, label: "Collect account number", text: "Enter your account number", digitsLength: 4, maxRetries: 3, noInputTimeoutSec: 8, routes: [{ id: "collected", label: "Digits collected", value: "collected", next: null }, { id: "invalid", label: "Invalid or timed out", value: "invalid", next: null }] };
    case "ifElse": return { id, kind, label: "Check condition", variableName: "callerType", expectedValue: "vip", routes: [{ id: "yes", label: "If matched", value: "true", next: null }, { id: "no", label: "Otherwise", value: "false", next: null }] };
    case "switch": return { id, kind, label: "Route by value", variableName: "language", routes: [{ id: "english", label: "English", value: "English", next: null }, { id: "kiswahili", label: "Kiswahili", value: "Kiswahili", next: null }, { id: "default", label: "Default", value: "default", next: null }] };
    case "dayOfWeek": return { id, kind, label: "Day of week", routes: [{ id: "weekday", label: "Weekday", value: "weekday", next: null }, { id: "weekend", label: "Weekend", value: "weekend", next: null }] };
    case "languageCondition": return { id, kind, label: "Caller language", routes: [{ id: "english", label: "English", value: "English", next: null }, { id: "kiswahili", label: "Kiswahili", value: "Kiswahili", next: null }, { id: "default", label: "Other language", value: "default", next: null }] };
    case "callerIdCondition": return { id, kind, label: "Check caller number", expectedValue: "+255", routes: [{ id: "match", label: "Number matches", value: "match", next: null }, { id: "no-match", label: "No match", value: "no-match", next: null }] };
    case "setVariable": return { id, kind, label: "Set caller type", variableName: "callerType", variableValue: "standard", next: null };
    case "getCallerNumber": return { id, kind, label: "Read caller number", variableName: "callerNumber", next: null };
    case "wait": return { id, kind, label: "Wait", waitSeconds: 2, next: null };
    case "retry": return { id, kind, label: "Retry step", retryLimit: 1, next: null };
  }
}

/** Which step comes after `node`, given the caller's key press or the open/closed state. */
export function nextStep(flow: IvrFlow, id: string, input?: string): IvrNode | null {
  const node = flow.nodes[id];
  if (!node) return null;
  let to: string | null | undefined = null;
  if (node.kind === "menu") { const option = node.options?.find((o) => o.key === input); to = option?.next ?? option?.targets?.[0]; }
  else if (node.kind === "hours") to = input === "closed" ? node.closedNext ?? node.closedTargets?.[0] : node.openNext ?? node.openTargets?.[0];
  else if (node.routes?.length && input) { const route = node.routes.find((item) => item.id === input); to = route?.next ?? route?.targets?.[0]; }
  else if (LINEAR_KINDS.includes(node.kind)) to = node.next ?? node.nextTargets?.[0];
  return to ? flow.nodes[to] ?? null : null;
}

/** Remove a step and reconnect anything pointing at it to where it led (or nothing). */
export function removeNode(flow: IvrFlow, id: string): IvrFlow {
  if (id === flow.startId) return flow;
  const gone = flow.nodes[id];
  if (!gone) return flow;
  const fallback = gone.next ?? null;
  const fix = (v: string | null | undefined) => (v === id ? fallback : v ?? null);
  const nodes: Record<string, IvrNode> = {};
  for (const n of Object.values(flow.nodes)) {
    if (n.id === id) continue;
    nodes[n.id] = {
      ...n,
      ...(n.next !== undefined && { next: fix(n.next) }),
      ...(n.openNext !== undefined && { openNext: fix(n.openNext) }),
      ...(n.closedNext !== undefined && { closedNext: fix(n.closedNext) }),
      ...(n.invalidNext !== undefined && { invalidNext: fix(n.invalidNext) }),
      ...(n.noInputNext !== undefined && { noInputNext: fix(n.noInputNext) }),
      ...(n.options && { options: n.options.map((o) => ({ ...o, next: fix(o.next), ...(o.targets && { targets: o.targets.filter((target) => target !== id) }) })) }),
      ...(n.routes && { routes: n.routes.map((route) => ({ ...route, next: fix(route.next), ...(route.targets && { targets: route.targets.filter((target) => target !== id) }) })) }),
      ...(n.conditions && { conditions: n.conditions.map((condition) => ({ ...condition, next: fix(condition.next), ...(condition.targets && { targets: condition.targets.filter((target) => target !== id) }) })) }),
      ...(n.nextTargets && { nextTargets: n.nextTargets.filter((target) => target !== id) }),
      ...(n.openTargets && { openTargets: n.openTargets.filter((target) => target !== id) }),
      ...(n.closedTargets && { closedTargets: n.closedTargets.filter((target) => target !== id) }),
      ...(n.invalidTargets && { invalidTargets: n.invalidTargets.filter((target) => target !== id) }),
      ...(n.noInputTargets && { noInputTargets: n.noInputTargets.filter((target) => target !== id) }),
    };
  }
  return { ...flow, nodes };
}

export interface FlowValidationIssue { severity: "error" | "warning"; nodeId: string | null; message: string }

/** Local structural checks only; these do not validate telephony or server configuration. */
export function validateFlowReport(flow: IvrFlow): FlowValidationIssue[] {
  const issues: FlowValidationIssue[] = [];
  const add = (severity: FlowValidationIssue["severity"], nodeId: string | null, message: string) => issues.push({ severity, nodeId, message });
  if (!flow.nodes[flow.startId]) add("error", null, `START node “${flow.startId}” does not exist.`);
  if (!Object.keys(flow.nodes).length) add("error", null, "The flow has no nodes.");
  for (const n of Object.values(flow.nodes)) {
    if (LINEAR_KINDS.includes(n.kind) && !n.next && !n.nextTargets?.length) add("error", n.id, `“${n.label}” needs a connected next step.`);
    if (n.kind === "menu" && !n.options?.length) add("error", n.id, `“${n.label}” has no keypad options.`);
    if (n.kind === "menu") {
      const keys = new Set<string>();
      n.options?.forEach((option) => {
        if (keys.has(option.key)) add("error", n.id, `Key ${option.key} is used more than once in “${n.label}”.`);
        keys.add(option.key);
        if (!option.next && !option.targets?.length) add("error", n.id, `Key ${option.key} in “${n.label}” has no connected destination.`);
      });
      if (!Number.isInteger(n.maxRetries ?? 3) || (n.maxRetries ?? 3) < 0 || (n.maxRetries ?? 3) > 10) add("error", n.id, `“${n.label}” retries must be between 0 and 10.`);
      if (!Number.isInteger(n.noInputTimeoutSec ?? 5) || (n.noInputTimeoutSec ?? 5) < 1 || (n.noInputTimeoutSec ?? 5) > 60) add("error", n.id, `“${n.label}” timeout must be between 1 and 60 seconds.`);
    }
    if (n.kind === "hours" && ((!n.openNext && !n.openTargets?.length) || (!n.closedNext && !n.closedTargets?.length))) add("error", n.id, `“${n.label}” needs both an open and a closed path.`);
    n.routes?.forEach((route) => { if (!route.next && !route.targets?.length) add("error", n.id, `Route “${route.label}” in “${n.label}” needs a destination.`); });
    if (n.kind === "transfer" && !isDialable(n.target ?? "")) add("error", n.id, `“${n.label}” has an invalid phone number.`);
    if (n.kind === "ringgroup" && !n.target) add("warning", n.id, `“${n.label}” has no phone group selected.`);
    const targets = [n.next, ...(n.nextTargets ?? []), n.openNext, ...(n.openTargets ?? []), n.closedNext, ...(n.closedTargets ?? []), n.invalidNext, ...(n.invalidTargets ?? []), n.noInputNext, ...(n.noInputTargets ?? []), ...(n.options ?? []).flatMap((option) => [option.next, ...(option.targets ?? [])]), ...(n.routes ?? []).flatMap((route) => [route.next, ...(route.targets ?? [])])];
    for (const target of targets) if (target && !flow.nodes[target]) add("error", n.id, `“${n.label}” points to missing node “${target}”.`);
  }
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id) || !flow.nodes[id]) return;
    reachable.add(id);
    const node = flow.nodes[id]!;
    const targets = [node.next, ...(node.nextTargets ?? []), node.openNext, ...(node.openTargets ?? []), node.closedNext, ...(node.closedTargets ?? []), node.invalidNext, ...(node.invalidTargets ?? []), node.noInputNext, ...(node.noInputTargets ?? []), ...(node.options ?? []).flatMap((option) => [option.next, ...(option.targets ?? [])]), ...(node.routes ?? []).flatMap((route) => [route.next, ...(route.targets ?? [])])];
    targets.forEach((target) => { if (target) visit(target); });
  };
  if (flow.nodes[flow.startId]) visit(flow.startId);
  for (const node of Object.values(flow.nodes)) if (!reachable.has(node.id)) add("warning", node.id, `“${node.label}” cannot be reached from START.`);
  const checked = new Set<string>();
  const active = new Set<string>();
  let cycleAt: string | null = null;
  const findCycle = (id: string) => {
    if (active.has(id)) { cycleAt = id; return true; }
    if (checked.has(id) || !flow.nodes[id]) return false;
    active.add(id);
    const node = flow.nodes[id]!;
    const targets = [node.next, ...(node.nextTargets ?? []), node.openNext, ...(node.openTargets ?? []), node.closedNext, ...(node.closedTargets ?? []), node.invalidNext, ...(node.invalidTargets ?? []), node.noInputNext, ...(node.noInputTargets ?? []), ...(node.options ?? []).flatMap((option) => [option.next, ...(option.targets ?? [])]), ...(node.routes ?? []).flatMap((route) => [route.next, ...(route.targets ?? [])])];
    const found = targets.some((target) => target ? findCycle(target) : false);
    active.delete(id);
    checked.add(id);
    return found;
  };
  Object.keys(flow.nodes).some(findCycle);
  if (cycleAt) add("warning", cycleAt, "This flow contains a loop. Test mode will stop after 100 transitions.");
  return issues;
}

/** Problems that prevent the local preview from reaching an outcome. */
export function validateFlow(flow: IvrFlow): string[] {
  return validateFlowReport(flow).filter((issue) => issue.severity === "error").map((issue) => issue.message);
}

export function defaultFlows(): IvrFlow[] {
  const main: IvrFlow = {
    id: "f-main", name: "Main menu (SW/EN)", number: "+255 800 110 110", startId: "welcome", published: true,
    nodes: {
      welcome: { id: "welcome", kind: "greeting", label: "Welcome", text: "Karibu MPANGE. Welcome to MPANGE.", next: "hours" },
      hours: { id: "hours", kind: "hours", label: "Are we open?", openNext: "menu", closedNext: "vm" },
      menu: { id: "menu", kind: "menu", label: "Main menu", text: "Kwa malipo bonyeza 1. For internet help press 2. For new products press 3. To speak to an agent press 0.", options: [
        { key: "1", label: "Bills & payments", next: "q-billing" },
        { key: "2", label: "Internet & technical", next: "q-tech" },
        { key: "3", label: "New products", next: "rg-sales" },
        { key: "9", label: "Request a callback", next: "cb-msg" },
        { key: "0", label: "Speak to an agent", next: "q-general" },
      ] },
      "q-billing": { id: "q-billing", kind: "queue", label: "Billing queue", target: "Billing" },
      "q-tech": { id: "q-tech", kind: "queue", label: "Technical queue", target: "Technical" },
      "rg-sales": { id: "rg-sales", kind: "ringgroup", label: "Sales phones", target: "Sales team" },
      "cb-msg": { id: "cb-msg", kind: "message", label: "Callback note", text: "We have saved your number and will call you back within 2 hours.", next: "bye" },
      bye: { id: "bye", kind: "hangup", label: "Goodbye", text: "Asante. Goodbye." },
      "q-general": { id: "q-general", kind: "queue", label: "General queue", target: "General" },
      vm: { id: "vm", kind: "voicemail", label: "After-hours voicemail", text: "We are closed. Please leave a message after the tone." },
    },
  };
  const after: IvrFlow = {
    id: "f-after", name: "After hours", number: "+255 27 254 8800", startId: "a1", published: false,
    nodes: {
      a1: { id: "a1", kind: "greeting", label: "Closed notice", text: "Our Arusha office is closed. Ofisi imefungwa.", next: "a2" },
      a2: { id: "a2", kind: "voicemail", label: "Voicemail", text: "Leave your name and number after the tone." },
    },
  };
  return [main, after];
}

/* ======================= Forwarding: one number → many phones ======================= */

/** A forwarding group must offer at least this many phones, so calls keep finding someone. */
export const MIN_FORWARD_NUMBERS = 7;
export const MAX_FORWARD_NUMBERS = 15;

export type RingStrategy = "sequential" | "simultaneous" | "round-robin";
/** Local test-run behavior when a simulated call reaches the flow. */
export type MemberState = "available" | "busy" | "no-answer";

export interface ForwardMember { id: string; name: string; number: string; enabled: boolean; state: MemberState; isSoftphone?: boolean }
export interface ForwardGroup {
  id: string; name: string; ownNumber: string; verified: boolean;
  strategy: RingStrategy; ringSeconds: number; fallback: "voicemail" | "queue" | "hangup";
  members: ForwardMember[]; lastAnsweredId: string | null;
}

export type HuntStep = { member: ForwardMember; result: "answered" | "busy" | "no-answer" | "off" };
export interface HuntResult { steps: HuntStep[]; answeredBy: ForwardMember | null }

/** Order in which phones are tried. Round-robin starts with the phone after the last one that answered. */
export function huntOrder(members: ForwardMember[], strategy: RingStrategy, lastAnsweredId: string | null): ForwardMember[] {
  if (strategy !== "round-robin" || !lastAnsweredId) return members;
  const i = members.findIndex((m) => m.id === lastAnsweredId);
  return i < 0 ? members : [...members.slice(i + 1), ...members.slice(0, i + 1)];
}

/** Try phones until one that is free picks up. Switched-off phones are skipped; busy phones are passed over. */
export function runHunt(group: Pick<ForwardGroup, "members" | "strategy" | "lastAnsweredId">): HuntResult {
  const order = huntOrder(group.members, group.strategy, group.lastAnsweredId);
  const steps: HuntStep[] = [];
  if (group.strategy === "simultaneous") {
    const winner = order.find((m) => m.enabled && m.state === "available") ?? null;
    for (const m of order) steps.push({ member: m, result: !m.enabled ? "off" : m === winner ? "answered" : m.state === "busy" ? "busy" : "no-answer" });
    return { steps, answeredBy: winner };
  }
  for (const m of order) {
    if (!m.enabled) { steps.push({ member: m, result: "off" }); continue; }
    if (m.state === "available") { steps.push({ member: m, result: "answered" }); return { steps, answeredBy: m }; }
    steps.push({ member: m, result: m.state });
  }
  return { steps, answeredBy: null };
}

/** Why a phone can't be added to the group, or null if it can. */
export function memberError(members: ForwardMember[], number: string): string | null {
  if (members.length >= MAX_FORWARD_NUMBERS) return `A group can hold up to ${MAX_FORWARD_NUMBERS} phones`;
  if (!isDialable(number)) return "Enter a valid phone number";
  if (members.some((m) => cleanNumber(m.number) === cleanNumber(number))) return "That number is already in the group";
  return null;
}

/** True when the group has enough switched-on phones to go live. */
export function groupReady(g: Pick<ForwardGroup, "members" | "verified">) {
  return g.verified && g.members.filter((m) => m.enabled).length >= MIN_FORWARD_NUMBERS;
}

const mk = (id: string, name: string, number: string, state: MemberState = "available", extra: Partial<ForwardMember> = {}): ForwardMember => ({ id, name, number, enabled: true, state, ...extra });

export function defaultGroups(): ForwardGroup[] {
  return [
    {
      id: "g-sales", name: "Sales team", ownNumber: "+255 754 300 300", verified: true, strategy: "sequential", ringSeconds: 15, fallback: "voicemail", lastAnsweredId: null,
      members: [
        mk("m1", "Neema Kweka", "+255 713 410 001", "busy"),
        mk("m2", "Baraka Mollel", "+255 754 410 002", "no-answer"),
        mk("m3", "My softphone (Ext 101)", "101", "available", { isSoftphone: true }),
        mk("m4", "Halima Said", "+255 715 410 004"),
        mk("m5", "Juma Mwakyusa", "+255 768 410 005"),
        mk("m6", "Rehema Lyimo", "+255 622 410 006", "no-answer"),
        mk("m7", "Office desk phone", "+255 22 211 4410"),
      ],
    },
    {
      id: "g-support", name: "Support line", ownNumber: "+255 22 211 4401", verified: true, strategy: "simultaneous", ringSeconds: 20, fallback: "queue", lastAnsweredId: null,
      members: Array.from({ length: 7 }, (_, i) => mk(`s${i + 1}`, ["Amani Shirima", "Faraja Ngowi", "Kelvin Mallya", "Zawadi Mrema", "Omari Juma", "Asha Mfinanga", "Night desk"][i]!, `+255 71${i} 520 0${i}${i}`, i < 2 ? "busy" : "available")),
    },
  ];
}

/* ---------- Drag & drop editing of caller menu flows ---------- */

/** A place under a step where the next step can be attached. */
export type Slot = { type: "next" } | { type: "open" } | { type: "closed" } | { type: "option"; key: string };

export function slotTarget(n: IvrNode, slot: Slot): string | null {
  if (slot.type === "next") return n.next ?? null;
  if (slot.type === "open") return n.openNext ?? null;
  if (slot.type === "closed") return n.closedNext ?? null;
  return n.options?.find((o) => o.key === slot.key)?.next ?? null;
}

export function withSlot(n: IvrNode, slot: Slot, to: string | null): IvrNode {
  if (slot.type === "next") return { ...n, next: to };
  if (slot.type === "open") return { ...n, openNext: to };
  if (slot.type === "closed") return { ...n, closedNext: to };
  return { ...n, options: (n.options ?? []).map((o) => (o.key === slot.key ? { ...o, next: to } : o)) };
}

/** Every step reachable from `id`, including `id` itself. */
export function subtree(flow: IvrFlow, id: string): Set<string> {
  const seen = new Set<string>();
  const walk = (x?: string | null) => {
    if (!x || seen.has(x) || !flow.nodes[x]) return;
    seen.add(x);
    const n = flow.nodes[x]!;
    walk(n.next); n.nextTargets?.forEach(walk); walk(n.openNext); n.openTargets?.forEach(walk); walk(n.closedNext); n.closedTargets?.forEach(walk); walk(n.invalidNext); n.invalidTargets?.forEach(walk); walk(n.noInputNext); n.noInputTargets?.forEach(walk); n.options?.forEach((o) => { walk(o.next); o.targets?.forEach(walk); }); n.routes?.forEach((route) => { walk(route.next); route.targets?.forEach(walk); });
  };
  walk(id);
  return seen;
}

/**
 * Put `node` (new or already in the flow) into `slot` under `parentId`.
 * If the slot already led somewhere and the dropped step is a message with no next step,
 * the old path carries on after it, so dropping between two steps inserts it.
 */
export function placeAt(flow: IvrFlow, parentId: string, slot: Slot, node: IvrNode): IvrFlow {
  const parent = flow.nodes[parentId];
  if (!parent) return flow;
  const old = slotTarget(parent, slot);
  let placed = node;
  if (old && old !== node.id && LINEAR_KINDS.includes(node.kind) && !node.next) placed = { ...node, next: old };
  const nodes = { ...flow.nodes, [placed.id]: placed };
  nodes[parentId] = withSlot(nodes[parentId]!, slot, placed.id);
  return { ...flow, nodes };
}

/**
 * Move an existing step (with everything after it) to a new slot.
 * Returns null when the move is not allowed: the first step, or dropping a step inside its own branch.
 */
export function moveNode(flow: IvrFlow, id: string, parentId: string, slot: Slot): IvrFlow | null {
  if (id === flow.startId || !flow.nodes[id] || !flow.nodes[parentId]) return null;
  if (subtree(flow, id).has(parentId)) return null;
  if (slotTarget(flow.nodes[parentId]!, slot) === id) return flow;
  const clear = (v: string | null | undefined) => (v === id ? null : v ?? null);
  const nodes: Record<string, IvrNode> = {};
  for (const n of Object.values(flow.nodes)) {
    nodes[n.id] = {
      ...n,
      ...(n.next !== undefined && { next: clear(n.next) }),
      ...(n.openNext !== undefined && { openNext: clear(n.openNext) }),
      ...(n.closedNext !== undefined && { closedNext: clear(n.closedNext) }),
      ...(n.invalidNext !== undefined && { invalidNext: clear(n.invalidNext) }),
      ...(n.noInputNext !== undefined && { noInputNext: clear(n.noInputNext) }),
      ...(n.options && { options: n.options.map((o) => ({ ...o, next: clear(o.next), ...(o.targets && { targets: o.targets.filter((target) => target !== id) }) })) }),
      ...(n.routes && { routes: n.routes.map((route) => ({ ...route, next: clear(route.next), ...(route.targets && { targets: route.targets.filter((target) => target !== id) }) })) }),
      ...(n.nextTargets && { nextTargets: n.nextTargets.filter((target) => target !== id) }),
      ...(n.openTargets && { openTargets: n.openTargets.filter((target) => target !== id) }),
      ...(n.closedTargets && { closedTargets: n.closedTargets.filter((target) => target !== id) }),
      ...(n.invalidTargets && { invalidTargets: n.invalidTargets.filter((target) => target !== id) }),
      ...(n.noInputTargets && { noInputTargets: n.noInputTargets.filter((target) => target !== id) }),
    };
  }
  const detached = { ...flow, nodes };
  return placeAt(detached, parentId, slot, detached.nodes[id]!);
}
