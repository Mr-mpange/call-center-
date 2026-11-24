import { END_KINDS, LINEAR_KINDS, type IvrFlow, type IvrNode } from "@/lib/ivr";

export type SimulationStatus = "running" | "waiting" | "completed" | "failed" | "stopped";
export type SimulationNodeStatus = "pending" | "running" | "success" | "failed" | "skipped" | "waiting";
export type SimulationInput = { type: "dtmf"; digit: string } | { type: "invalid-dtmf"; digit: string } | { type: "no-input" } | { type: "route"; routeId: string };

export interface SimulationContext {
  callerNumber: string;
  language: "English" | "Kiswahili";
  isBusinessOpen: boolean;
  dayOfWeek?: number;
  variables?: Record<string, string>;
  simulatedDigits?: string;
}

export interface SimulationNodeRun {
  id: string;
  nodeId: string;
  status: SimulationNodeStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  input?: string;
  output?: string;
  selectedEdgeId?: string;
  error?: string;
}

export interface IvrSimulation {
  id: string;
  flowId: string;
  status: SimulationStatus;
  currentNodeId: string | null;
  context: SimulationContext;
  attempts: number;
  nodeRuns: SimulationNodeRun[];
  path: string[];
  startedAt: number;
  endedAt?: number;
  message?: string;
}

export function createIvrSimulation(flow: IvrFlow, context: SimulationContext, now = Date.now()): IvrSimulation {
  return {
    id: `sim-${now.toString(36)}`,
    flowId: flow.id,
    status: "running",
    currentNodeId: flow.nodes[flow.startId] ? flow.startId : null,
    context,
    attempts: 0,
    nodeRuns: [],
    path: [],
    startedAt: now,
    ...(!flow.nodes[flow.startId] && { status: "failed" as const, endedAt: now, message: `START node "${flow.startId}" was not found.` }),
  };
}

function destination(node: IvrNode, target: string | null | undefined) {
  return target && node.id !== target ? target : null;
}

function edgeId(nodeId: string, handle: string, target: string) {
  return `${nodeId}-${handle}-${target}`;
}

function finishNode(run: IvrSimulation, node: IvrNode, now: number, result: { status: "success" | "failed"; output?: string; error?: string; input?: string; selectedEdgeId?: string; next?: string | null }): IvrSimulation {
  const active = run.nodeRuns.find((item) => item.nodeId === node.id && item.status === "waiting");
  const event: SimulationNodeRun = {
    ...(active ?? { id: `${run.id}-${node.id}-${run.nodeRuns.length + 1}`, nodeId: node.id, startedAt: now }),
    status: result.status,
    endedAt: now,
    durationMs: Math.max(0, now - (active?.startedAt ?? now)),
    ...(result.input !== undefined && { input: result.input }),
    ...(result.output !== undefined && { output: result.output }),
    ...(result.error !== undefined && { error: result.error }),
    ...(result.selectedEdgeId !== undefined && { selectedEdgeId: result.selectedEdgeId }),
  };
  const nodeRuns = active
    ? run.nodeRuns.map((item) => item.id === active.id ? event : item)
    : [...run.nodeRuns, event];
  if (result.status === "failed") return { ...run, status: "failed", currentNodeId: node.id, nodeRuns, endedAt: now, message: result.error ?? "Node execution failed." };
  const next = result.next ?? null;
  if (END_KINDS.includes(node.kind) || !next) {
    const noNextError = !END_KINDS.includes(node.kind) ? `"${node.label}" has no connected next step.` : undefined;
    if (noNextError) {
      const failedEvent = { ...event, status: "failed" as const, error: noNextError };
    return { ...run, status: "failed", currentNodeId: node.id, nodeRuns: nodeRuns.map((item) => item.id === event.id ? failedEvent : item), endedAt: now, message: noNextError };
    }
    return { ...run, status: "completed" as const, currentNodeId: node.id, nodeRuns, endedAt: now, message: result.output ?? "Simulation completed." };
  }
  return { ...run, status: "running" as const, currentNodeId: next, attempts: 0, nodeRuns, path: [...run.path, node.id] };
}

/** Execute one deterministic, side-effect-free simulation step from the current flow definition. */
export function executeIvrSimulationStep(flow: IvrFlow, run: IvrSimulation, input?: SimulationInput, now = Date.now()): IvrSimulation {
  if (["completed", "failed", "stopped"].includes(run.status)) return run;
  if (run.path.length >= 100) return { ...run, status: "failed", endedAt: now, message: "Simulation stopped after 100 transitions to prevent an endless loop. Check for a cycle in the flow." };
  const node = run.currentNodeId ? flow.nodes[run.currentNodeId] : undefined;
  if (!node) return { ...run, status: "failed", endedAt: now, message: "The current node is missing from this flow." };

  if (node.kind === "menu") {
    const waitingRun = run.nodeRuns.find((item) => item.nodeId === node.id && item.status === "waiting");
    if (!input) {
      if (waitingRun) return run;
      return {
        ...run,
        status: "waiting",
        nodeRuns: [...run.nodeRuns, { id: `${run.id}-${node.id}-${run.nodeRuns.length + 1}`, nodeId: node.id, status: "waiting", startedAt: now, output: node.text || "Waiting for keypad input." }],
        message: "Waiting for a simulated caller to press a key.",
      };
    }
    if (input.type === "route") {
      const route = node.routes?.find((item) => item.id === input.routeId);
      const next = destination(node, route?.next ?? route?.targets?.[0]);
      if (!route || !next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", input: route?.label ?? input.routeId, error: `Route "${route?.label ?? input.routeId}" has no valid destination.` });
      return finishNode(run, node, now, { status: "success", input: route.label, output: `Selected route: ${route.label}`, selectedEdgeId: edgeId(node.id, `route:${route.id}`, next), next });
    }
    const retries = node.maxRetries ?? 3;
    const fallback = input.type === "no-input"
      ? destination(node, node.noInputNext ?? node.noInputTargets?.[0])
      : destination(node, node.invalidNext ?? node.invalidTargets?.[0]);
    if (fallback && flow.nodes[fallback]) {
      const handle = input.type === "no-input" ? "no-input" : "invalid";
      return finishNode(run, node, now, { status: "success", input: input.type === "no-input" ? "No input" : `Invalid key ${input.digit}`, output: `Used ${input.type === "no-input" ? "no-input" : "invalid-input"} fallback.`, selectedEdgeId: edgeId(node.id, handle, fallback), next: fallback });
    }
    const suppliedDigit = "digit" in input ? input.digit : "";
    const invalidDigit = input.type === "invalid-dtmf" || !node.options?.some((item) => item.key === suppliedDigit);
    if (input.type === "no-input" || invalidDigit) {
      const attempt = run.attempts + 1;
      if (attempt <= retries) return {
        ...run,
        status: "waiting",
        attempts: attempt,
        message: input.type === "no-input" ? `No input. Waiting for another attempt (${attempt}/${retries}).` : `Key ${suppliedDigit} is invalid. Waiting for another attempt (${attempt}/${retries}).`,
        nodeRuns: run.nodeRuns.map((item) => item.id === waitingRun?.id ? { ...item, input: input.type === "no-input" ? "No input" : suppliedDigit, output: input.type === "no-input" ? `No input; retry ${attempt} of ${retries}.` : `Invalid key; retry ${attempt} of ${retries}.` } : item),
      };
      const error = input.type === "no-input" ? `No input after ${retries} retries on "${node.label}".` : `Key ${suppliedDigit} is invalid after ${retries} retries on "${node.label}".`;
      return { ...run, status: "failed", currentNodeId: node.id, endedAt: now, message: error, nodeRuns: run.nodeRuns.map((item) => item.id === waitingRun?.id ? { ...item, status: "failed", endedAt: now, durationMs: Math.max(0, now - item.startedAt), input: input.type === "no-input" ? "No input" : suppliedDigit, error } : item) };
    }
    const option = node.options?.find((item) => item.key === suppliedDigit);
    const next = destination(node, option?.next ?? option?.targets?.[0]);
    if (!option || !next || !flow.nodes[next]) return {
      ...run,
      status: "failed",
      currentNodeId: node.id,
      endedAt: now,
      message: !option ? `Key ${suppliedDigit} is not configured on "${node.label}".` : `Key ${suppliedDigit} has no valid destination.`,
      nodeRuns: run.nodeRuns.map((item) => item.id === waitingRun?.id ? { ...item, status: "failed", endedAt: now, durationMs: Math.max(0, now - item.startedAt), input: suppliedDigit, error: !option ? `Key ${suppliedDigit} is not configured.` : "The selected key has no valid destination." } : item),
    };
    return finishNode(run, node, now, { status: "success", input: suppliedDigit, output: `Key ${suppliedDigit}: ${option.label}`, selectedEdgeId: edgeId(node.id, `option:${option.key}`, next), next });
  }

  if (node.kind === "collectDigits") {
    const waitingRun = run.nodeRuns.find((item) => item.nodeId === node.id && item.status === "waiting");
    if (!input) return waitingRun ? run : { ...run, status: "waiting", nodeRuns: [...run.nodeRuns, { id: `${run.id}-${node.id}-${run.nodeRuns.length + 1}`, nodeId: node.id, status: "waiting", startedAt: now, output: node.text || "Waiting for caller digits." }], message: `Waiting for ${node.digitsLength ?? 4} caller digits.` };
    const value = input.type === "dtmf" ? input.digit : "";
    const valid = input.type === "dtmf" && value.length === (node.digitsLength ?? 4) && /^\\d+$/.test(value);
    const route = node.routes?.find((item) => item.id === (valid ? "collected" : "invalid"));
    const next = destination(node, route?.next ?? route?.targets?.[0]);
    if (!route || !next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", input: value || "No input", error: `${valid ? "Digits collected" : "Invalid digits"} path has no valid destination.` });
    return finishNode(run, node, now, { status: "success", input: value || "Invalid or no input", output: valid ? `Collected ${value.length} digits.` : "Input did not match the required digit count.", selectedEdgeId: edgeId(node.id, `route:${route.id}`, next), next });
  }

  if (node.routes?.length) {
    const waitingRun = run.nodeRuns.find((item) => item.nodeId === node.id && item.status === "waiting");
    if (!input) {
      if (waitingRun) return run;
      const conditionNode = ["ifElse", "switch", "dayOfWeek", "languageCondition", "callerIdCondition"].includes(node.kind);
      if (conditionNode) {
        let chosenRouteId = "default";
        let chosenValue = "default";
        if (node.kind === "ifElse") {
          const actual = run.context.variables?.[node.variableName ?? ""] ?? "";
          const matched = actual.toLowerCase() === (node.expectedValue ?? "").toLowerCase();
          chosenRouteId = matched ? "yes" : "no"; chosenValue = matched ? "true" : "false";
        } else if (node.kind === "switch") {
          chosenValue = run.context.variables?.[node.variableName ?? ""] ?? (node.variableName === "language" ? run.context.language : "");
          chosenRouteId = node.routes.find((item) => item.id !== "default" && item.value?.toLowerCase() === chosenValue.toLowerCase())?.id ?? "default";
        } else if (node.kind === "dayOfWeek") {
          const day = run.context.dayOfWeek ?? new Date(now).getDay();
          chosenRouteId = day === 0 || day === 6 ? "weekend" : "weekday"; chosenValue = chosenRouteId;
        } else if (node.kind === "languageCondition") {
          chosenValue = run.context.language;
          chosenRouteId = node.routes.find((item) => item.value?.toLowerCase() === chosenValue.toLowerCase())?.id ?? "default";
        } else {
          const matched = !!node.expectedValue && run.context.callerNumber.includes(node.expectedValue);
          chosenRouteId = matched ? "match" : "no-match"; chosenValue = chosenRouteId;
        }
        const route = node.routes.find((item) => item.id === chosenRouteId);
        const next = destination(node, route?.next ?? route?.targets?.[0]);
        if (!route || !next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", input: chosenValue, error: `Selected ${route?.label ?? "condition"} branch has no valid destination.` });
        return finishNode(run, node, now, { status: "success", input: chosenValue, output: `Condition selected: ${route.label}.`, selectedEdgeId: edgeId(node.id, `route:${route.id}`, next), next });
      }
      return { ...run, status: "waiting", nodeRuns: [...run.nodeRuns, { id: `${run.id}-${node.id}-${run.nodeRuns.length + 1}`, nodeId: node.id, status: "waiting", startedAt: now, output: "Choose a configured route to continue." }], message: "Waiting for a route selection." };
    }
    if (input.type !== "route") return run;
    const route = node.routes.find((item) => item.id === input.routeId);
    const next = destination(node, route?.next ?? route?.targets?.[0]);
    if (!route || !next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", input: route?.label ?? input.routeId, error: `Route "${route?.label ?? input.routeId}" has no valid destination.` });
    return finishNode(run, node, now, { status: "success", input: route.label, output: `Selected route: ${route.label}`, selectedEdgeId: edgeId(node.id, `route:${route.id}`, next), next });
  }

  if (node.kind === "hours") {
    const isOpen = run.context.isBusinessOpen;
    const handle = isOpen ? "open" : "closed";
    const next = destination(node, isOpen ? node.openNext ?? node.openTargets?.[0] : node.closedNext ?? node.closedTargets?.[0]);
    if (!next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", input: isOpen ? "When open" : "When closed", error: `The ${isOpen ? "open" : "closed"} business-hours path has no valid destination.` });
    return finishNode(run, node, now, { status: "success", input: isOpen ? "When open" : "When closed", output: `Simulated business is ${isOpen ? "open" : "closed"}.`, selectedEdgeId: edgeId(node.id, handle, next), next });
  }

  if (node.kind === "setVariable" || node.kind === "getCallerNumber") {
    const variableName = node.variableName || (node.kind === "getCallerNumber" ? "callerNumber" : "value");
    const variableValue = node.kind === "getCallerNumber" ? run.context.callerNumber : (node.variableValue ?? "");
    const next = destination(node, node.next ?? node.nextTargets?.[0]);
    if (!next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", error: `"${node.label}" has no valid next step.` });
    return finishNode({ ...run, context: { ...run.context, variables: { ...run.context.variables, [variableName]: variableValue } } }, node, now, { status: "success", output: `Set ${variableName} to ${node.kind === "getCallerNumber" ? "the simulated caller number" : variableValue}.`, selectedEdgeId: edgeId(node.id, "next", next), next });
  }

  if (node.kind === "wait" || node.kind === "retry") {
    const next = destination(node, node.next ?? node.nextTargets?.[0]);
    if (!next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", error: `"${node.label}" has no valid next step.` });
    const output = node.kind === "wait" ? `Simulated wait: ${node.waitSeconds ?? 1} second(s).` : `Simulated retry limit: ${node.retryLimit ?? 1}.`;
    return finishNode(run, node, now, { status: "success", output, selectedEdgeId: edgeId(node.id, "next", next), next });
  }

  if (LINEAR_KINDS.includes(node.kind)) {
    const next = destination(node, node.next ?? node.nextTargets?.[0]);
    if (!next || !flow.nodes[next]) return finishNode(run, node, now, { status: "failed", ...(node.text !== undefined && { output: node.text }), error: `"${node.label}" has no valid next step.` });
    return finishNode(run, node, now, { status: "success", output: node.text || `${node.label} completed.`, selectedEdgeId: edgeId(node.id, "next", next), next });
  }

  if (END_KINDS.includes(node.kind)) {
    const output = node.kind === "queue" ? `Simulation only: would route to queue “${node.target || "Unspecified"}”.`
      : node.kind === "ringgroup" ? `Simulation only: would ring group “${node.target || "Unspecified"}”.`
        : node.kind === "transfer" ? `Simulation only: would transfer to ${node.target || "an unspecified number"}.`
          : node.kind === "voicemail" ? `Simulation only: voicemail step reached. ${node.text ?? ""}`
            : `Simulation only: call ended at “${node.label}”.`;
    return finishNode(run, node, now, { status: "success", output });
  }

  return finishNode(run, node, now, { status: "failed", error: `Node type “${node.kind}” is not supported by the local simulator.` });
}

export function stopIvrSimulation(run: IvrSimulation, now = Date.now()): IvrSimulation {
  if (["completed", "failed", "stopped"].includes(run.status)) return run;
  return { ...run, status: "stopped", endedAt: now, message: "Simulation stopped by the user.", nodeRuns: run.nodeRuns.map((item) => item.status === "waiting" ? { ...item, status: "skipped", endedAt: now, durationMs: Math.max(0, now - item.startedAt) } : item) };
}
