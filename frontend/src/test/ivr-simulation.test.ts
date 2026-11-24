import { describe, expect, it } from "vitest";
import { defaultFlows, makeNode, validateFlowReport } from "@/lib/ivr";
import { createIvrSimulation, executeIvrSimulationStep, type SimulationContext } from "@/lib/ivr-simulation";

const context: SimulationContext = { callerNumber: "+255700000000", language: "English", isBusinessOpen: true };

describe("local IVR workflow simulation", () => {
  it("executes the configured open-hours and keypad route to its terminal", () => {
    const flow = defaultFlows()[0]!;
    let run = createIvrSimulation(flow, context, 100);

    run = executeIvrSimulationStep(flow, run, undefined, 200); // greeting
    expect(run.currentNodeId).toBe("hours");
    run = executeIvrSimulationStep(flow, run, undefined, 300); // open branch
    expect(run.currentNodeId).toBe("menu");
    run = executeIvrSimulationStep(flow, run, undefined, 400); // prompt caller
    expect(run.status).toBe("waiting");
    run = executeIvrSimulationStep(flow, run, { type: "dtmf", digit: "1" }, 500);
    expect(run.currentNodeId).toBe("q-billing");
    expect(run.nodeRuns.at(-1)?.selectedEdgeId).toBe("menu-option:1-q-billing");
    run = executeIvrSimulationStep(flow, run, undefined, 600);

    expect(run.status).toBe("completed");
    expect(run.nodeRuns.map((item) => item.status)).toEqual(["success", "success", "success", "success"]);
    expect(run.nodeRuns.at(-1)?.output).toContain("Simulation only");
  });

  it("follows the closed-hours connection when the simulated business is closed", () => {
    const flow = defaultFlows()[0]!;
    let run = createIvrSimulation(flow, { ...context, isBusinessOpen: false }, 100);
    run = executeIvrSimulationStep(flow, run, undefined, 200);
    run = executeIvrSimulationStep(flow, run, undefined, 300);
    run = executeIvrSimulationStep(flow, run, undefined, 400);

    expect(run.status).toBe("completed");
    expect(run.currentNodeId).toBe("vm");
    expect(run.nodeRuns[1]?.selectedEdgeId).toBe("hours-closed-vm");
  });

  it("uses a configured invalid-input fallback connection", () => {
    const base = defaultFlows()[0]!;
    const flow = { ...base, nodes: { ...base.nodes, menu: { ...base.nodes["menu"]!, invalidNext: "vm" } } };
    let run = createIvrSimulation(flow, context, 100);
    run = executeIvrSimulationStep(flow, run, undefined, 200);
    run = executeIvrSimulationStep(flow, run, undefined, 300);
    run = executeIvrSimulationStep(flow, run, undefined, 400);
    run = executeIvrSimulationStep(flow, run, { type: "invalid-dtmf", digit: "X" }, 500);

    expect(run.currentNodeId).toBe("vm");
    expect(run.nodeRuns.at(-1)?.selectedEdgeId).toBe("menu-invalid-vm");
  });

  it("retries invalid input up to the configured limit, then fails with an inspectable cause", () => {
    const base = defaultFlows()[0]!;
    const flow = { ...base, nodes: { ...base.nodes, menu: { ...base.nodes["menu"]!, maxRetries: 1 } } };
    let run = createIvrSimulation(flow, context, 100);
    run = executeIvrSimulationStep(flow, run, undefined, 200);
    run = executeIvrSimulationStep(flow, run, undefined, 300);
    run = executeIvrSimulationStep(flow, run, undefined, 400);
    run = executeIvrSimulationStep(flow, run, { type: "invalid-dtmf", digit: "X" }, 500);
    expect(run.status).toBe("waiting");
    run = executeIvrSimulationStep(flow, run, { type: "no-input" }, 600);

    expect(run.status).toBe("failed");
    expect(run.message).toContain("No input after 1 retries");
    expect(run.nodeRuns.at(-1)?.status).toBe("failed");
  });

  it("reports disconnected and unreachable steps separately", () => {
    const flow = defaultFlows()[0]!;
    const report = validateFlowReport({ ...flow, nodes: { ...flow.nodes, welcome: { ...flow.nodes["welcome"]!, next: "missing" }, orphan: { id: "orphan", kind: "hangup", label: "Unlinked" } } });
    expect(report.some((issue) => issue.severity === "error" && issue.message.includes("missing node"))).toBe(true);
    expect(report.some((issue) => issue.severity === "warning" && issue.nodeId === "orphan")).toBe(true);
  });

  it("sets and checks a local variable through connected condition branches", () => {
    const flow = defaultFlows()[0]!;
    const set = makeNode("setVariable"); set.id = "set"; set.variableName = "callerType"; set.variableValue = "vip"; set.next = "condition";
    const condition = makeNode("ifElse"); condition.id = "condition"; condition.variableName = "callerType"; condition.expectedValue = "vip"; condition.routes![0]!.next = "vip-end"; condition.routes![1]!.next = "regular-end";
    const vip = makeNode("hangup"); vip.id = "vip-end";
    const regular = makeNode("hangup"); regular.id = "regular-end";
    const testFlow = { ...flow, startId: "set", nodes: { set, condition, "vip-end": vip, "regular-end": regular } };
    let run = createIvrSimulation(testFlow, context, 100);
    run = executeIvrSimulationStep(testFlow, run, undefined, 200);
    expect(run.context.variables?.["callerType"]).toBe("vip");
    run = executeIvrSimulationStep(testFlow, run, undefined, 300);
    expect(run.currentNodeId).toBe("vip-end");
    expect(run.nodeRuns.at(-1)?.selectedEdgeId).toBe("condition-route:yes-vip-end");
  });
});
