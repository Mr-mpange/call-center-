import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Bot, CheckCircle2, Clock, Copy, Grid3X3, ListOrdered, Loader2, LockKeyhole, MessageSquare, Pause, Pencil, Play, PhoneForwarded, PhoneOff, Plus, Redo2, Rocket, Search, Send, SkipForward, Sparkles, Square, Trash2, Undo2, Users, Volume2, Voicemail, type LucideIcon } from "lucide-react";
import { applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Panel, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePhone } from "@/components/phone/PhoneProvider";
import { defaultFlows, END_KINDS, KIND_LABEL, LINEAR_KINDS, makeNode, MENU_KEYS, nodeId, QUEUES, removeNode, subtree, validateFlow, validateFlowReport, type IvrFlow, type IvrNode, type NodeKind } from "@/lib/ivr";
import { createIvrSimulation, executeIvrSimulationStep, stopIvrSimulation, type IvrSimulation, type SimulationContext, type SimulationInput, type SimulationNodeStatus } from "@/lib/ivr-simulation";

const SIMULATION_HISTORY_STORE = "mpange.ivr.simulation-history.v1";
const NODE_CATEGORIES: { title: string; supported: { kind: NodeKind; label: string }[]; unavailable: string[] }[] = [
  { title: "Call triggers", supported: [], unavailable: ["Incoming Call", "Outgoing Call", "Call Answered", "Call Ended", "Missed Call", "Scheduled Call"] },
  { title: "Voice and audio", supported: [{ kind: "greeting", label: "Welcome message" }, { kind: "message", label: "Play message" }, { kind: "voicemail", label: "Voicemail" }], unavailable: ["Text-to-Speech", "Record Audio", "Hold Music", "Play Announcement", "Stop Audio"] },
  { title: "Input and interaction", supported: [{ kind: "menu", label: "DTMF menu" }, { kind: "collectDigits", label: "Collect digits" }], unavailable: ["Speech Input", "Yes/No Confirmation", "Repeat Menu", "Input Validation"] },
  { title: "Logic and conditions", supported: [{ kind: "hours", label: "Business hours" }, { kind: "ifElse", label: "If / Else" }, { kind: "switch", label: "Switch by variable" }, { kind: "dayOfWeek", label: "Day of week" }, { kind: "languageCondition", label: "Language condition" }, { kind: "callerIdCondition", label: "Caller ID condition" }], unavailable: ["Date Condition", "Variable Condition"] },
  { title: "Call routing", supported: [{ kind: "queue", label: "Call queue" }, { kind: "ringgroup", label: "Ring group" }, { kind: "transfer", label: "Forward call" }], unavailable: ["Department Routing", "Agent Selection", "Priority Routing", "Overflow Routing", "Fallback Routing"] },
  { title: "Agents and departments", supported: [], unavailable: ["Select Department", "Ring Agent", "Round Robin", "Least Busy", "Longest Idle", "Agent Availability", "Supervisor Escalation", "Queue Callback"] },
  { title: "AI and automation", supported: [], unavailable: ["AI Voice Agent", "Intent Detection", "Speech-to-Text", "AI Response", "AI Handoff", "Call Summarization", "Sentiment Detection"] },
  { title: "Integrations", supported: [], unavailable: ["HTTP Request", "Webhook", "CRM Lookup", "Database Lookup", "Create Ticket", "Send SMS", "Send Email", "Payment Verification"] },
  { title: "Call controls", supported: [{ kind: "hangup", label: "Hang up" }], unavailable: ["Answer Call", "Hold Call", "Resume Call", "Mute", "Record Call", "Stop Recording", "Blind Transfer", "Warm Transfer"] },
  { title: "Timers and events", supported: [{ kind: "wait", label: "Wait (simulated)" }, { kind: "retry", label: "Retry policy (simulated)" }], unavailable: ["Timeout", "Delay", "Schedule", "Maximum Wait"] },
  { title: "Data and variables", supported: [{ kind: "setVariable", label: "Set variable" }, { kind: "getCallerNumber", label: "Get caller number" }], unavailable: ["Get Variable", "Customer Lookup", "Save Caller Input", "Update Call Context"] },
  { title: "Security and compliance", supported: [], unavailable: ["PIN Verification", "OTP Verification", "Caller Verification", "Consent Request", "Sensitive Data Masking", "Restricted Action"] },
];
const NODE_ICON: Record<NodeKind, LucideIcon> = {
  greeting: MessageSquare, message: Volume2, menu: Grid3X3, hours: Clock, queue: ListOrdered,
  ringgroup: Users, transfer: PhoneForwarded, voicemail: Voicemail, hangup: PhoneOff,
  collectDigits: Grid3X3, ifElse: Clock, switch: Grid3X3, dayOfWeek: Clock, languageCondition: MessageSquare, callerIdCondition: PhoneForwarded, setVariable: ListOrdered, getCallerNumber: PhoneForwarded, wait: Clock, retry: Loader2,
};

type FlowNodeData = { node: IvrNode; isStart: boolean; isActive?: boolean; executionStatus?: SimulationNodeStatus; onEdit: (id: string) => void; onDelete: (id: string) => void; onDuplicate: (id: string) => void; routes: { key: string; label: string }[] };
type FlowCanvasNode = Node<FlowNodeData, "ivrNode">;

function IvrCanvasNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const routes = data.routes;
  const executionStyles: Record<SimulationNodeStatus, string> = {
    pending: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900",
    running: "border-amber-500 bg-amber-50 ring-4 ring-amber-400/30 dark:bg-amber-950",
    success: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950",
    failed: "border-red-500 bg-red-50 ring-2 ring-red-400/30 dark:bg-red-950",
    skipped: "border-blue-400 bg-blue-50 dark:bg-blue-950",
    waiting: "border-purple-500 bg-purple-50 ring-4 ring-purple-400/30 dark:bg-purple-950",
  };
  const executionLabels: Record<SimulationNodeStatus, string> = { pending: "Pending", running: "Running", success: "Success", failed: "Failed", skipped: "Skipped", waiting: "Waiting" };
  return <div className={`soft-card relative w-[220px] rounded-xl border-0 p-3 transition-all duration-300 ${data.executionStatus ? executionStyles[data.executionStatus] : ""} ${data.isActive ? "ring-4 ring-primary/30" : selected ? "ring-2 ring-primary/30" : ""}`}>
    {!data.isStart && <Handle type="target" position={Position.Left} id="in" isConnectable className="!z-20 !h-4 !w-4 !cursor-crosshair !border-2 !border-background !bg-primary" />}
    <div className="mb-2 flex items-center gap-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => data.onEdit(data.node.id)}><span className="min-w-0 flex-1"><span className="block text-[10px] uppercase text-muted-foreground">{KIND_LABEL[data.node.kind]}</span><span className="block truncate text-sm font-semibold">{data.node.label}</span></span>{data.isStart && <span className="text-[10px] font-semibold text-primary">START</span>}</button>
      {data.executionStatus && <span className="rounded-full border border-current/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase">{executionLabels[data.executionStatus]}</span>}
      {!data.executionStatus && <><Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Edit ${data.node.label}`} onClick={() => data.onEdit(data.node.id)}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Duplicate ${data.node.label}`} onClick={() => data.onDuplicate(data.node.id)}><Copy className="h-3.5 w-3.5" /></Button>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive" aria-label={`Delete ${data.node.label}`} disabled={data.isStart} onClick={() => data.onDelete(data.node.id)}><Trash2 className="h-3.5 w-3.5" /></Button></>}
    </div>
    <p className="line-clamp-2 text-xs text-muted-foreground">{data.node.text || data.node.target || (data.node.kind === "hours" ? "Open or closed route" : "")}</p>
    {routes.map((route) => <div key={route.key} className="surface-recessed relative mt-2 flex h-6 items-center rounded-full px-2 text-[10px]">{route.label}<Handle type="source" position={Position.Right} id={route.key} isConnectable className="!z-20 !h-4 !w-4 !cursor-crosshair !border-2 !border-background !bg-primary" /></div>)}
  </div>;
}

const nodeTypes = { ivrNode: IvrCanvasNode };

function buildSuggestedFlow(prompt: string, current: IvrFlow): IvrFlow {
  const request = prompt.toLowerCase();
  const welcome = makeNode("greeting");
  welcome.label = "Welcome";
  const menu = makeNode("menu");
  menu.label = "Choose a department";
  menu.text = "Press 1 for Billing, 2 for Support, or 3 to leave a message.";
  menu.options = [
    { key: "1", label: "Billing", next: null },
    { key: "2", label: "Support", next: null },
    { key: "3", label: "Leave a message", next: null },
  ];
  const billing = makeNode("queue"); billing.label = "Billing team"; billing.target = "Billing";
  const support = makeNode("queue"); support.label = "Support team"; support.target = request.includes("technical") ? "Technical" : "General";
  const voicemail = makeNode("voicemail");
  const useHours = /business hours|opening hours|after.hours|closed|open and closed/.test(request);
  const nodes: Record<string, IvrNode> = { [welcome.id]: welcome, [menu.id]: menu, [billing.id]: billing, [support.id]: support, [voicemail.id]: voicemail };
  menu.options![0]!.next = billing.id;
  menu.options![1]!.next = support.id;
  menu.options![2]!.next = voicemail.id;
  if (useHours) {
    const hours = makeNode("hours");
    const closed = makeNode("voicemail"); closed.label = "After-hours voicemail";
    welcome.next = hours.id;
    hours.openNext = menu.id;
    hours.closedNext = closed.id;
    nodes[hours.id] = hours;
    nodes[closed.id] = closed;
  } else welcome.next = menu.id;
  const ordered = Object.values(nodes);
  ordered.forEach((node, index) => { node.x = 80 + (index % 3) * 300; node.y = 60 + Math.floor(index / 3) * 210; });
  return { ...current, startId: welcome.id, nodes, published: false };
}

function speak(text?: string) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function routeRows(node: IvrNode): { key: string; label: string; targets: string[] }[] {
  let standard: { key: string; label: string; targets: string[] }[] = [];
  if (node.kind === "hours") standard = [
    { key: "open", label: "When open", targets: [node.openNext, ...(node.openTargets ?? [])].filter((target): target is string => !!target) },
    { key: "closed", label: "When closed", targets: [node.closedNext, ...(node.closedTargets ?? [])].filter((target): target is string => !!target) },
  ];
  else if (node.kind === "menu") standard = [
    ...(node.options ?? []).map((option) => ({ key: `option:${option.key}`, label: `Key ${option.key} · ${option.label}`, targets: [option.next, ...(option.targets ?? [])].filter((target): target is string => !!target) })),
    { key: "invalid", label: "Invalid input", targets: [node.invalidNext, ...(node.invalidTargets ?? [])].filter((target): target is string => !!target) },
    { key: "no-input", label: "No input / timeout", targets: [node.noInputNext, ...(node.noInputTargets ?? [])].filter((target): target is string => !!target) },
  ];
  else if (node.kind === "collectDigits") standard = (node.routes ?? []).map((route) => ({ key: `route:${route.id}`, label: route.label, targets: [route.next, ...(route.targets ?? [])].filter((target): target is string => !!target) }));
  else if (LINEAR_KINDS.includes(node.kind)) standard = [{ key: "next", label: "Next step", targets: [node.next, ...(node.nextTargets ?? [])].filter((target): target is string => !!target) }];
  return [...standard, ...(["collectDigits"].includes(node.kind) ? [] : (node.routes ?? []).map((route) => ({ key: `route:${route.id}`, label: route.label, targets: [route.next, ...(route.targets ?? [])].filter((target): target is string => !!target) })))];
}

export function FlowBuilder(props: { groupNames: string[]; numbers: string[]; initialFlowId?: string; initialFlows?: IvrFlow[]; testTrigger?: number; onSave?: (flow: IvrFlow) => void }) {
  return <ReactFlowProvider><FlowBuilderInner {...props} /></ReactFlowProvider>;
}

function FlowTestPreview({ flow, nodes, edges }: { flow: IvrFlow; nodes: FlowCanvasNode[]; edges: Edge[] }) {
  type Scenario = "manual" | "billing" | "swahili" | "after-hours" | "invalid-key" | "no-response";
  const [context, setContext] = useState<SimulationContext>({ callerNumber: "+255 700 000 000", language: "English", isBusinessOpen: true });
  const [scenario, setScenario] = useState<Scenario>("manual");
  const [simulation, setSimulation] = useState<IvrSimulation | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<IvrSimulation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const current = simulation?.currentNodeId ? flow.nodes[simulation.currentNodeId] : null;

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(SIMULATION_HISTORY_STORE) ?? "[]") as IvrSimulation[];
      setHistory(saved.filter((item) => item.flowId === flow.id).slice(0, 20));
    } catch { /* ignore invalid browser-local history */ }
  }, [flow.id]);
  const start = () => { setSelectedRunId(null); setSimulation(createIvrSimulation(flow, context)); setAutomatic(true); };
  const stop = () => { setAutomatic(false); setSimulation((run) => run ? stopIvrSimulation(run) : run); };
  const restart = () => { setSelectedRunId(null); setSimulation(createIvrSimulation(flow, context)); setAutomatic(true); };
  const executeInput = (input?: SimulationInput) => {
    setSimulation((run) => run ? executeIvrSimulationStep(flow, run, input) : createIvrSimulation(flow, context));
  };

  useEffect(() => {
    if (!automatic || simulation?.status !== "running") return;
    const timer = window.setTimeout(() => setSimulation((run) => run ? executeIvrSimulationStep(flow, run) : run), 700);
    return () => window.clearTimeout(timer);
  }, [automatic, flow, simulation]);

  useEffect(() => {
    if (!automatic || simulation?.status !== "waiting" || !current || scenario === "manual") return;
    const input: SimulationInput | undefined = scenario === "billing" && current.kind === "menu"
      ? { type: "dtmf", digit: "1" }
      : scenario === "invalid-key" && current.kind === "menu"
        ? { type: "invalid-dtmf", digit: "X" }
        : scenario === "no-response" && current.kind === "menu"
          ? { type: "no-input" }
          : undefined;
    if (!input) return;
    const timer = window.setTimeout(() => setSimulation((run) => run ? executeIvrSimulationStep(flow, run, input) : run), 500);
    return () => window.clearTimeout(timer);
  }, [automatic, current, flow, scenario, simulation]);

  useEffect(() => {
    if (!simulation || !["completed", "failed", "stopped"].includes(simulation.status)) return;
    setAutomatic(false);
    const maskedNumber = simulation.context.callerNumber.length > 4 ? `••••${simulation.context.callerNumber.slice(-4)}` : "••••";
    const safeRecord = { ...simulation, context: { ...simulation.context, callerNumber: maskedNumber } };
    setHistory((items) => {
      const next = items.some((item) => item.id === safeRecord.id) ? items : [safeRecord, ...items].slice(0, 20);
      try { window.sessionStorage.setItem(SIMULATION_HISTORY_STORE, JSON.stringify([...next.filter((item) => item.flowId !== flow.id), ...next.filter((item) => item.flowId === flow.id)].slice(0, 20))); } catch { /* history remains in memory for this test window */ }
      return next;
    });
  }, [flow.id, simulation]);

  const latestByNode = new Map<string, IvrSimulation["nodeRuns"][number]>();
  simulation?.nodeRuns.forEach((run) => latestByNode.set(run.nodeId, run));
  const previewNodes = nodes.map((item) => {
    const nodeRun = latestByNode.get(item.id);
    const isCurrent = simulation?.currentNodeId === item.id && (simulation.status === "running" || simulation.status === "waiting");
    const executionStatus = isCurrent ? simulation.status === "waiting" ? "waiting" : "running" : nodeRun?.status ?? "pending";
    return { ...item, data: { ...item.data, isActive: isCurrent, executionStatus, onEdit: () => undefined, onDelete: () => undefined } };
  });
  const latestEdge = [...(simulation?.nodeRuns ?? [])].reverse().find((run) => run.selectedEdgeId)?.selectedEdgeId;
  const completedEdges = new Set((simulation?.nodeRuns ?? []).map((run) => run.selectedEdgeId).filter((id): id is string => !!id));
  const previewEdges = edges.map((edge) => {
    const followed = completedEdges.has(edge.id);
    return { ...edge, animated: followed && edge.id === latestEdge && automatic, style: { stroke: followed ? "#16a34a" : "#64748b", strokeWidth: followed ? 3 : 2, opacity: followed ? 1 : 0.65 }, markerEnd: { type: MarkerType.ArrowClosed, color: followed ? "#16a34a" : "#64748b" } };
  });
  const menuWaiting = simulation?.status === "waiting" && current?.kind === "menu";
  const routeWaiting = simulation?.status === "waiting" && !!current?.routes?.length && current.kind !== "collectDigits";
  const selectedRun = simulation?.nodeRuns.find((run) => run.id === selectedRunId) ?? simulation?.nodeRuns.at(-1);
  const duration = simulation ? Math.max(0, (simulation.endedAt ?? Date.now()) - simulation.startedAt) : 0;
  const resultNodes = new Set((simulation?.nodeRuns ?? []).map((run) => run.nodeId));
  const successfulCount = simulation?.nodeRuns.filter((run) => run.status === "success").length ?? 0;
  const failedCount = simulation?.nodeRuns.filter((run) => run.status === "failed").length ?? 0;
  const pendingCount = Math.max(0, nodes.length - resultNodes.size);
  const statusLabel = simulation?.status === "waiting" ? "Waiting for caller input" : simulation?.status === "running" ? (automatic ? "Running simulation" : "Paused") : simulation?.status === "completed" ? "Completed" : simulation?.status === "failed" ? "Failed" : simulation?.status === "stopped" ? "Stopped" : "Ready to simulate";

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div className="soft-card flex flex-wrap items-center gap-2 rounded-[18px] p-2">
      {!simulation && <Button size="sm" onClick={start}><Play className="h-4 w-4" />Start simulation</Button>}
      {simulation?.status === "running" && automatic && <Button size="sm" variant="outline" onClick={() => setAutomatic(false)}><Pause className="h-4 w-4" />Pause</Button>}
      {simulation?.status === "running" && !automatic && <Button size="sm" variant="outline" onClick={() => setAutomatic(true)}><Play className="h-4 w-4" />Resume</Button>}
      {(!simulation || simulation.status === "running") && <Button size="sm" variant="outline" onClick={() => { setAutomatic(false); setSimulation((run) => run ? executeIvrSimulationStep(flow, run) : executeIvrSimulationStep(flow, createIvrSimulation(flow, context))); }} disabled={simulation?.status === "waiting"}><SkipForward className="h-4 w-4" />Step</Button>}
      {simulation && <Button size="sm" variant="outline" onClick={restart}><Play className="h-4 w-4" />Restart</Button>}
      {simulation && !["completed", "failed", "stopped"].includes(simulation.status) && <Button size="sm" variant="outline" onClick={stop}><Square className="h-4 w-4" />Stop</Button>}
      <Button size="sm" variant="ghost" onClick={() => setShowHistory((value) => !value)}>Execution history ({history.length})</Button>
      <span className="ml-auto inline-flex items-center gap-2 text-sm" aria-live="polite">{simulation?.status === "failed" ? <AlertCircle className="h-4 w-4 text-destructive" /> : simulation?.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-success" /> : simulation?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-warning" /> : <Clock className="h-4 w-4 text-muted-foreground" />}{statusLabel}</span>
    </div>
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_310px]">
      <div className="surface-recessed min-h-[300px] overflow-hidden rounded-[18px]">
        <ReactFlowProvider><ReactFlow nodes={previewNodes} edges={previewEdges} nodeTypes={nodeTypes} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} fitView onInit={(instance) => { window.requestAnimationFrame(() => instance.fitView({ padding: 0.2 })); }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls /><MiniMap />
        </ReactFlow></ReactFlowProvider>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto soft-card rounded-[18px] p-3">
        <div><p className="font-semibold">Simulated caller</p><p className="text-xs text-muted-foreground">Local-only execution. No real calls, transfers, or external actions.</p></div>
        <div className="space-y-1"><Label className="text-xs">Test scenario</Label><Select value={scenario} onValueChange={(value: Scenario) => { setScenario(value); setContext((old) => ({ ...old, isBusinessOpen: value !== "after-hours", ...(value === "swahili" && { language: "Kiswahili" as const }) })); }} disabled={!!simulation && !["completed", "failed", "stopped"].includes(simulation.status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual caller input</SelectItem><SelectItem value="billing">Open · press 1 (Billing)</SelectItem><SelectItem value="swahili">Open · Kiswahili</SelectItem><SelectItem value="after-hours">After hours</SelectItem><SelectItem value="invalid-key">Invalid keypad input</SelectItem><SelectItem value="no-response">No response</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="sim-caller" className="text-xs">Caller number</Label><Input id="sim-caller" value={context.callerNumber} onChange={(event) => setContext((value) => ({ ...value, callerNumber: event.target.value }))} disabled={!!simulation && !["completed", "failed", "stopped"].includes(simulation.status)} /></div>
        <div className="space-y-1"><Label className="text-xs">Language</Label><Select value={context.language} onValueChange={(value: SimulationContext["language"]) => setContext((old) => ({ ...old, language: value }))} disabled={!!simulation && !["completed", "failed", "stopped"].includes(simulation.status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="English">English</SelectItem><SelectItem value="Kiswahili">Kiswahili</SelectItem></SelectContent></Select></div>
        <div className="space-y-1"><Label className="text-xs">Business hours scenario</Label><Select value={context.isBusinessOpen ? "open" : "closed"} onValueChange={(value) => setContext((old) => ({ ...old, isBusinessOpen: value === "open" }))} disabled={!!simulation && !["completed", "failed", "stopped"].includes(simulation.status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">During business hours</SelectItem><SelectItem value="closed">After hours</SelectItem></SelectContent></Select></div>
        {menuWaiting && current && <div className="space-y-2 surface-recessed rounded-[16px] p-2"><p className="text-xs font-semibold">{current.text || "Enter a keypad choice"}</p><div className="grid grid-cols-3 gap-1.5">{MENU_KEYS.map((digit) => <Button key={digit} size="sm" variant="outline" className="h-9" onClick={() => executeInput({ type: "dtmf", digit })}>{digit}</Button>)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => executeInput({ type: "invalid-dtmf", digit: "X" })}>Simulate invalid key</Button><Button size="sm" variant="outline" onClick={() => executeInput({ type: "no-input" })}>Simulate no response</Button>{current.routes?.map((route) => <Button key={route.id} size="sm" variant="secondary" onClick={() => executeInput({ type: "route", routeId: route.id })}>{route.label}</Button>)}</div><p className="text-[11px] text-muted-foreground">DTMF input is applied to the current menu node only.</p></div>}
        {simulation?.status === "waiting" && current?.kind === "collectDigits" && <div className="space-y-2 surface-recessed rounded-[16px] p-2"><p className="text-xs font-semibold">{current.text || "Enter digits"} · exactly {current.digitsLength ?? 4} digits</p><Input inputMode="numeric" maxLength={12} aria-label="Simulated collected digits" value={simulation.context.simulatedDigits ?? ""} onChange={(event) => setSimulation((old) => old ? { ...old, context: { ...old.context, simulatedDigits: event.target.value.replace(/\\D/g, "") } } : old)} /><div className="flex gap-2"><Button size="sm" onClick={() => executeInput({ type: "dtmf", digit: simulation.context.simulatedDigits ?? "" })}>Submit digits</Button><Button size="sm" variant="outline" onClick={() => executeInput({ type: "no-input" })}>Simulate no response</Button></div><p className="text-[11px] text-muted-foreground">Digits stay in the local simulation and are not sent anywhere.</p></div>}
        {routeWaiting && !menuWaiting && current && <div className="space-y-2 surface-recessed rounded-[16px] p-2"><p className="text-xs font-semibold">Choose the simulated branch</p><p className="text-[11px] text-muted-foreground">The simulator evaluates the configured context and lets you confirm the branch to follow.</p>{current.routes?.map((route) => <Button key={route.id} size="sm" variant="outline" className="w-full justify-start" onClick={() => executeInput({ type: "route", routeId: route.id })}>{route.label}</Button>)}</div>}
        {simulation?.message && <p className={`surface-flat rounded-xl p-2 text-xs ${simulation.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{simulation.message}</p>}
        <div><div className="mb-1 flex items-center justify-between"><p className="text-xs font-semibold">Execution summary</p><span className="text-[11px] text-muted-foreground">{(duration / 1000).toFixed(1)}s total</span></div><p className="text-xs text-muted-foreground">{simulation?.nodeRuns.length ?? 0} executions · {successfulCount} successful · {failedCount} failed · {pendingCount} pending</p><p className="text-[11px] text-muted-foreground">Result: {simulation?.status ?? "not started"} · {simulation?.path.length ?? 0} connections followed</p></div>
        <div className="space-y-1"><p className="text-xs font-semibold">Execution log</p>{!simulation?.nodeRuns.length ? <p className="text-xs text-muted-foreground">Start a simulation to inspect node execution details.</p> : simulation.nodeRuns.map((run) => <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`w-full rounded-md border p-2 text-left text-xs ${selectedRunId === run.id ? "border-primary bg-accent/60" : "border-border"}`}><span className="font-medium">{flow.nodes[run.nodeId]?.label ?? run.nodeId}</span><span className="float-right capitalize">{run.status}</span>{(run.input || run.output) && <span className="mt-1 block truncate text-muted-foreground">{run.input && `Input: ${run.input}`} {run.output}</span>}</button>)}</div>
        {selectedRun && <div className="surface-recessed rounded-[16px] p-2 text-xs"><p className="font-semibold">Node inspection · {flow.nodes[selectedRun.nodeId]?.label}</p><p>Status: <span className="capitalize">{selectedRun.status}</span></p><p>Node ID: {selectedRun.nodeId}</p><p>Started: {new Date(selectedRun.startedAt).toLocaleTimeString()}</p><p>Duration: {selectedRun.durationMs ?? 0} ms</p>{selectedRun.input && <p>Input: {selectedRun.input}</p>}{selectedRun.output && <p>Output: {selectedRun.output}</p>}{selectedRun.selectedEdgeId && <p className="break-all">Selected connection: {selectedRun.selectedEdgeId}</p>}{selectedRun.error && <p className="text-destructive">Error: {selectedRun.error}</p>}</div>}
        {showHistory && <div className="space-y-1 surface-recessed rounded-[16px] p-2"><p className="text-xs font-semibold">Browser-session execution history</p><p className="text-[10px] text-muted-foreground">Caller number is masked. History is stored in this browser tab only.</p>{history.length ? history.map((item) => <button key={item.id} type="button" onClick={() => { setAutomatic(false); setSimulation(item); setSelectedRunId(item.nodeRuns.at(-1)?.id ?? null); }} className="flex w-full justify-between gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted"><span>{new Date(item.startedAt).toLocaleString()} · {item.nodeRuns.length} nodes</span><span className="capitalize">{item.status}</span></button>) : <p className="text-xs text-muted-foreground">No completed simulations in this session.</p>}</div>}
      </div>
    </div>
  </div>;
}

function FlowBuilderInner({ groupNames, numbers, initialFlowId, initialFlows, testTrigger, onSave }: { groupNames: string[]; numbers: string[]; initialFlowId?: string; initialFlows?: IvrFlow[]; testTrigger?: number; onSave?: (flow: IvrFlow) => void }) {
  const reactFlow = useReactFlow();
  const { open: softphoneOpen } = usePhone();
  const [flows, setFlows] = useState<IvrFlow[]>(initialFlows?.length ? initialFlows : defaultFlows);
  const [flowId, setFlowId] = useState("f-main");
  const [sel, setSel] = useState("welcome");
  const [canvasNodes, setCanvasNodes] = useState<FlowCanvasNode[]>([]);
  const [canvasEdges, setCanvasEdges] = useState<Edge[]>([]);
  const [testOpen, setTestOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [suggestedFlow, setSuggestedFlow] = useState<IvrFlow | null>(null);
  const [nodeSearch, setNodeSearch] = useState("");
  const [canvasSearch, setCanvasSearch] = useState("");
  const [undoStack, setUndoStack] = useState<IvrFlow[][]>([]);
  const [redoStack, setRedoStack] = useState<IvrFlow[][]>([]);

  useEffect(() => { if (testTrigger) setTestOpen(true); }, [testTrigger]);

  useEffect(() => {
    if (!initialFlows?.length) return;
    setFlows(initialFlows);
    const initial = initialFlows.find((item) => item.id === initialFlowId) ?? initialFlows[0]!;
    setFlowId(initial.id);
    setSel(initial.startId);
  }, [initialFlowId, initialFlows]);

  const persist = (next: IvrFlow[]) => {
    setUndoStack((stack) => [...stack.slice(-39), flows]);
    setRedoStack([]);
    setFlows(next);
    const saved = next.find((item) => item.id === flowId);
    if (saved) onSave?.(saved);
  };
  const restoreHistory = (next: IvrFlow[]) => {
    setFlows(next);
    const saved = next.find((item) => item.id === flowId);
    if (saved) onSave?.(saved);
  };
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, flows]);
    restoreHistory(previous);
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, flows]);
    restoreHistory(next);
  };
  const flow = flows.find((item) => item.id === flowId) ?? flows[0]!;
  const node = flow.nodes[sel] ?? flow.nodes[flow.startId]!;
  const nodes = Object.values(flow.nodes);
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const validationReport = useMemo(() => validateFlowReport(flow), [flow]);
  useEffect(() => {
    const positioned = nodes.map((item, index) => ({
      id: item.id,
      type: "ivrNode" as const,
      position: { x: item.x ?? 80 + (index % 3) * 310, y: item.y ?? 50 + Math.floor(index / 3) * 190 },
      data: { node: item, isStart: item.id === flow.startId, routes: routeRows(item).map(({ key, label }) => ({ key, label })), onEdit: setSel, onDelete: deleteStep, onDuplicate: duplicateNode },
    }));
    const edges = nodes.flatMap((source) => routeRows(source).flatMap((route) => route.targets.flatMap((target) => flow.nodes[target] ? [{
      id: `${source.id}-${route.key}-${target}`,
      source: source.id,
      sourceHandle: route.key,
      target,
      targetHandle: "in",
      label: route.label,
      type: "smoothstep" as const,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
    }] : [])));
    setCanvasNodes(positioned);
    setCanvasEdges(edges);
  }, [flow]);

  const handleNodesChange = (changes: NodeChange[]) => setCanvasNodes((current) => applyNodeChanges(changes, current) as FlowCanvasNode[]);
  const handleEdgesChange = (changes: EdgeChange[]) => {
    setCanvasEdges((current) => applyEdgeChanges(changes, current));
    for (const change of changes) {
      if (change.type !== "remove") continue;
      const edge = canvasEdges.find((item) => item.id === change.id);
      if (edge?.source && edge.sourceHandle && edge.target) disconnect(edge.source, edge.sourceHandle, edge.target);
    }
  };
  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || !flow.nodes[connection.source] || !flow.nodes[connection.target]) return;
    const source = flow.nodes[connection.source]!;
    const routeKey = connection.sourceHandle ?? routeRows(source).at(0)?.key;
    if (!routeKey) {
      toast.error(`Add an output branch to “${source.label}” before connecting it`);
      return;
    }
    connect(connection.source, routeKey, connection.target);
  };
  const handleNodeDragStop = (_event: MouseEvent | TouchEvent, dragged: FlowCanvasNode) => {
    patchNode(dragged.id, { x: dragged.position.x, y: dragged.position.y });
  };
  const patchFlow = (fn: (current: IvrFlow) => IvrFlow) => persist(flows.map((item) => item.id === flow.id ? { ...fn(item), published: false } : item));
  const patchNode = (id: string, patch: Partial<IvrNode>) => patchFlow((current) => ({ ...current, nodes: { ...current.nodes, [id]: { ...current.nodes[id]!, ...patch } } }));

  const connect = (sourceId: string, routeKey: string, targetId: string | null) => {
    if (!targetId) return;
    if (targetId === sourceId) {
      toast.error("A step cannot connect to itself");
      return;
    }
    if (subtree(flow, targetId).has(sourceId)) {
      toast.warning("Loop connection added", { description: "Intentional loops can support retries and repeated menus. Simulation stops safely after 100 transitions." });
    }
    const source = flow.nodes[sourceId]!;
    const add = (primary: string | null | undefined, extras: string[] | undefined) => ({
      primary: primary || targetId,
      extras: primary ? Array.from(new Set([...(extras ?? []), targetId])) : (extras ?? []),
    });
    if (routeKey === "open") { const path = add(source.openNext, source.openTargets); patchNode(sourceId, { openNext: path.primary, openTargets: path.extras }); }
    else if (routeKey === "closed") { const path = add(source.closedNext, source.closedTargets); patchNode(sourceId, { closedNext: path.primary, closedTargets: path.extras }); }
    else if (routeKey === "invalid") { const path = add(source.invalidNext, source.invalidTargets); patchNode(sourceId, { invalidNext: path.primary, invalidTargets: path.extras }); }
    else if (routeKey === "no-input") { const path = add(source.noInputNext, source.noInputTargets); patchNode(sourceId, { noInputNext: path.primary, noInputTargets: path.extras }); }
    else if (routeKey.startsWith("option:")) {
      const key = routeKey.slice("option:".length);
      patchNode(sourceId, { options: (source.options ?? []).map((option) => { if (option.key !== key) return option; const path = add(option.next, option.targets); return { ...option, next: path.primary, targets: path.extras }; }) });
    } else if (routeKey.startsWith("route:")) {
      const id = routeKey.slice("route:".length);
      patchNode(sourceId, { routes: (source.routes ?? []).map((route) => { if (route.id !== id) return route; const path = add(route.next, route.targets); return { ...route, next: path.primary, targets: path.extras }; }) });
    } else { const path = add(source.next, source.nextTargets); patchNode(sourceId, { next: path.primary, nextTargets: path.extras }); }
  };

  const disconnect = (sourceId: string, routeKey: string, targetId: string) => {
    const source = flow.nodes[sourceId];
    if (!source) return;
    const remove = (primary: string | null | undefined, extras: string[] | undefined) => {
      const remaining = [primary, ...(extras ?? [])].filter((target): target is string => !!target && target !== targetId);
      return { primary: remaining[0] ?? null, extras: remaining.slice(1) };
    };
    if (routeKey === "open") { const path = remove(source.openNext, source.openTargets); patchNode(sourceId, { openNext: path.primary, openTargets: path.extras }); }
    else if (routeKey === "closed") { const path = remove(source.closedNext, source.closedTargets); patchNode(sourceId, { closedNext: path.primary, closedTargets: path.extras }); }
    else if (routeKey === "invalid") { const path = remove(source.invalidNext, source.invalidTargets); patchNode(sourceId, { invalidNext: path.primary, invalidTargets: path.extras }); }
    else if (routeKey === "no-input") { const path = remove(source.noInputNext, source.noInputTargets); patchNode(sourceId, { noInputNext: path.primary, noInputTargets: path.extras }); }
    else if (routeKey.startsWith("option:")) { const key = routeKey.slice("option:".length); patchNode(sourceId, { options: (source.options ?? []).map((option) => { if (option.key !== key) return option; const path = remove(option.next, option.targets); return { ...option, next: path.primary, targets: path.extras }; }) }); }
    else if (routeKey.startsWith("route:")) { const id = routeKey.slice("route:".length); patchNode(sourceId, { routes: (source.routes ?? []).map((route) => { if (route.id !== id) return route; const path = remove(route.next, route.targets); return { ...route, next: path.primary, targets: path.extras }; }) }); }
    else { const path = remove(source.next, source.nextTargets); patchNode(sourceId, { next: path.primary, nextTargets: path.extras }); }
  };

  const addRoute = () => {
    const routes = node.routes ?? [];
    patchNode(node.id, { routes: [...routes, { id: `route-${Date.now().toString(36)}`, label: `Path ${routes.length + 1}`, next: null }] });
  };

  const addStep = (kind: NodeKind) => {
    const added = makeNode(kind);
    const index = Object.keys(flow.nodes).length;
    added.x = 80 + (index % 3) * 310;
    added.y = 80 + Math.floor(index / 3) * 190;
    patchFlow((current) => ({ ...current, nodes: { ...current.nodes, [added.id]: added } }));
    setSel(added.id);
  };

  const deleteStep = (id: string) => {
    if (id === flow.startId) return;
    patchFlow((current) => removeNode(current, id));
    setSel(flow.startId);
    toast("Step removed");
  };

  const duplicateNode = (id: string) => {
    const original = flow.nodes[id];
    if (!original) return;
    const copy = structuredClone(original);
    copy.id = nodeId();
    copy.label = `${original.label} copy`;
    copy.x = (original.x ?? 80) + 40;
    copy.y = (original.y ?? 80) + 40;
    copy.next = null; copy.nextTargets = [];
    copy.openNext = null; copy.openTargets = [];
    copy.closedNext = null; copy.closedTargets = [];
    copy.invalidNext = null; copy.invalidTargets = [];
    copy.noInputNext = null; copy.noInputTargets = [];
    if (copy.options) copy.options = copy.options.map((option) => ({ ...option, next: null, targets: [] }));
    if (copy.routes) copy.routes = copy.routes.map((route) => ({ ...route, next: null, targets: [] }));
    patchFlow((current) => ({ ...current, nodes: { ...current.nodes, [copy.id]: copy } }));
    setSel(copy.id);
  };

  const addMenuOption = () => {
    const used = new Set(node.options?.map((option) => option.key));
    const key = MENU_KEYS.find((candidate) => !used.has(candidate));
    if (!key) { toast.error("Every keypad key is already used"); return; }
    patchNode(node.id, { options: [...(node.options ?? []), { key, label: `Option ${key}`, next: null }] });
  };

  const duplicateFlow = () => {
    const copy = structuredClone(flow);
    copy.id = `f-${Date.now().toString(36)}`;
    copy.name = `${flow.name} (copy)`;
    copy.published = false;
    persist([...flows, copy]);
    setFlowId(copy.id);
    setSel(copy.startId);
  };

  const newFlow = () => {
    const start = makeNode("greeting");
    const fresh: IvrFlow = { id: `f-${Date.now().toString(36)}`, name: `New flow ${flows.length + 1}`, number: numbers[0] ?? "", startId: start.id, nodes: { [start.id]: start }, published: false };
    persist([...flows, fresh]);
    setFlowId(fresh.id);
    setSel(start.id);
  };

  const publish = () => {
    if (issues.length) { toast.error("Fix the flow before publishing", { description: issues[0] }); return; }
    persist(flows.map((item) => item.id === flow.id ? { ...item, published: true } : item));
    toast.info(`"${flow.name}" publish request sent; verify the provider response before routing calls`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      else if (modifier && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateNode(sel); }
      else if ((event.key === "Backspace" || event.key === "Delete") && sel !== flow.startId) { event.preventDefault(); deleteStep(sel); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flow.startId, redo, undo, duplicateNode, deleteStep, sel]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 soft-card rounded-[18px] p-4">
        <div className="space-y-1"><Label className="text-xs">Flow</Label><Select value={flow.id} onValueChange={(id) => { const next = flows.find((item) => item.id === id)!; setFlowId(id); setSel(next.startId); }}><SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger><SelectContent>{flows.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="flow-name" className="text-xs">Name</Label><Input id="flow-name" value={flow.name} onChange={(event) => patchFlow((current) => ({ ...current, name: event.target.value }))} className="h-9 w-48" /></div>
        <div className="space-y-1"><Label className="text-xs">Preview number</Label><Select value={flow.number || "none"} onValueChange={(value) => patchFlow((current) => ({ ...current, number: value === "none" ? "" : value }))}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No number selected</SelectItem>{numbers.map((number) => <SelectItem key={number} value={number}>{number}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="canvas-search" className="text-xs">Find a node</Label><div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input id="canvas-search" placeholder="Name or ID…" value={canvasSearch} onChange={(event) => setCanvasSearch(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const found = nodes.find((item) => `${item.label} ${item.id}`.toLowerCase().includes(canvasSearch.trim().toLowerCase())); if (found) { setSel(found.id); const position = reactFlow.getNode(found.id)?.position; if (position) reactFlow.setCenter(position.x + 110, position.y + 70, { zoom: 1, duration: 350 }); } else toast.info("No matching node"); }} className="h-9 w-36 pl-8" /></div></div>
        <StatusBadge status={flow.published ? "local preview published" : "draft"} />
        <div className="ml-auto flex gap-2"><Button size="icon" variant="outline" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled={!undoStack.length} onClick={undo}><Undo2 className="h-4 w-4" /></Button><Button size="icon" variant="outline" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled={!redoStack.length} onClick={redo}><Redo2 className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={newFlow}><Plus className="h-4 w-4" />New flow</Button><Button size="sm" variant="outline" onClick={duplicateFlow}><Copy className="h-4 w-4" />Copy</Button><Button size="sm" variant="outline" onClick={() => setValidationOpen(true)}><CheckCircle2 className="h-4 w-4" />Validate</Button><Button size="sm" variant="secondary" onClick={() => setTestOpen(true)}><Play className="h-4 w-4" />Test</Button><Button size="sm" onClick={publish}><Rocket className="h-4 w-4" />Publish preview</Button></div>
      </div>

      <Dialog open={validationOpen} onOpenChange={setValidationOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Flow validation</DialogTitle><DialogDescription>Local structural checks only. This does not validate live telephony, queues, or provider configuration.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {!validationReport.length && <p className="rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success">No structural issues found.</p>}
            {validationReport.map((issue, index) => <button key={`${issue.nodeId}-${index}`} type="button" onClick={() => { if (issue.nodeId) setSel(issue.nodeId); setValidationOpen(false); }} className={`flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm ${issue.severity === "error" ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning-soft"}`}>
              {issue.severity === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
              <span><span className="font-semibold capitalize">{issue.severity}</span><span className="ml-2">{issue.message}</span>{issue.nodeId && <span className="mt-1 block text-xs text-muted-foreground">Click to select this node</span>}</span>
            </button>)}
          </div>
        </DialogContent>
      </Dialog>

      {!softphoneOpen && <Button type="button" className="fixed bottom-24 right-4 z-40 h-14 rounded-full px-5 shadow-xl sm:bottom-6 sm:right-44" onClick={() => setAssistantOpen(true)} aria-label="Open AI flow assistant">
        <Sparkles className="h-5 w-5" />Build with AI
      </Button>}

      <Dialog open={assistantOpen} onOpenChange={(open) => { setAssistantOpen(open); if (!open) setSuggestedFlow(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />Describe the IVR flow you need</DialogTitle>
            <DialogDescription>Describe the caller journey in plain language. The assistant will draft editable nodes on this canvas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea rows={4} value={assistantPrompt} onChange={(event) => { setAssistantPrompt(event.target.value); setSuggestedFlow(null); }} placeholder="Example: Welcome callers, check business hours, route billing calls to Billing, technical calls to Support, and send after-hours callers to voicemail." />
            <p className="text-xs text-muted-foreground">Frontend preview: this uses local flow patterns and does not send your description to an AI service.</p>
            {suggestedFlow && <div className="surface-recessed rounded-[16px] p-3"><p className="text-sm font-medium">Draft ready · {Object.keys(suggestedFlow.nodes).length} nodes</p><p className="mt-1 text-xs text-muted-foreground">Welcome → {Object.values(suggestedFlow.nodes).some((item) => item.kind === "hours") ? "Business hours → " : ""}Keypad menu → Billing queue, Support queue, or voicemail. Review and edit the connections after applying.</p></div>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setAssistantOpen(false); setSuggestedFlow(null); }}>Cancel</Button>
            {!suggestedFlow ? <Button type="button" disabled={!assistantPrompt.trim()} onClick={() => setSuggestedFlow(buildSuggestedFlow(assistantPrompt, flow))}><Sparkles className="h-4 w-4" />Generate draft</Button> : <Button type="button" onClick={() => { persist(flows.map((item) => item.id === flow.id ? suggestedFlow : item)); setSel(suggestedFlow.startId); setAssistantOpen(false); setSuggestedFlow(null); toast.success("Generated flow added to the canvas", { description: "Review the draft and test it before publishing." }); }}><Send className="h-4 w-4" />Use this draft</Button>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="flex h-[90vh] max-w-[min(96vw,1500px)] flex-col">
          <DialogHeader>
            <DialogTitle>Test flow · {flow.name}</DialogTitle>
            <DialogDescription>Local simulation executes this flow using simulated caller inputs. It never places real calls or triggers external actions.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden surface-recessed rounded-[18px]">
            <FlowTestPreview key={flow.id} flow={flow} nodes={canvasNodes} edges={canvasEdges} />
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <Panel className="min-w-0" title="IVR flow canvas" action={<DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-8 w-8" aria-label="Add a flow node" title="Add a flow node"><Plus className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[75vh] w-80 overflow-y-auto">
            <DropdownMenuLabel>Node library</DropdownMenuLabel>
            <div className="relative px-2 pb-2"><Search className="absolute left-4 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input aria-label="Search nodes" placeholder="Search all nodes…" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="h-9 pl-8" /></div>
            {NODE_CATEGORIES.map((category) => {
              const query = nodeSearch.trim().toLowerCase();
              const supported = category.supported.filter((item) => !query || item.label.toLowerCase().includes(query) || category.title.toLowerCase().includes(query));
              const unavailable = category.unavailable.filter((label) => !query || label.toLowerCase().includes(query) || category.title.toLowerCase().includes(query));
              if (!supported.length && !unavailable.length) return null;
              return <div key={category.title}><DropdownMenuSeparator /><DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{category.title}</DropdownMenuLabel>
                {supported.map(({ kind, label }) => { const Icon = NODE_ICON[kind]; return <DropdownMenuItem key={kind} onSelect={() => addStep(kind)}><Icon className="mr-2 h-4 w-4" /><span className="flex-1">{label}</span><span className="text-[9px] text-muted-foreground">Local simulation</span></DropdownMenuItem>; })}
                {unavailable.map((label) => <DropdownMenuItem key={label} disabled title="Unavailable in this frontend-only build"><LockKeyhole className="mr-2 h-3.5 w-3.5" /><span className="flex-1">{label}</span><span className="text-[9px] text-muted-foreground">Unavailable</span></DropdownMenuItem>)}
              </div>;
            })}
          </DropdownMenuContent>
        </DropdownMenu>}>
          <div className="h-[min(70vh,720px)] min-h-[520px] min-w-0 w-full overflow-hidden surface-recessed rounded-[18px]">
    <ReactFlow nodes={canvasNodes} edges={canvasEdges} nodeTypes={nodeTypes} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={handleConnect} onNodeClick={(_, item) => setSel(item.id)} onNodeDragStop={handleNodeDragStop} nodesConnectable nodesDraggable edgesReconnectable fitView defaultEdgeOptions={{ type: "smoothstep", animated: true, markerEnd: { type: MarkerType.ArrowClosed } }} proOptions={{ hideAttribution: true }}>
              <Background gap={20} size={1} />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Edit step" action={<span className="text-[11px] text-muted-foreground">{KIND_LABEL[node.kind]}</span>}>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="node-label" className="text-xs">Step name</Label><Input id="node-label" value={node.label} onChange={(event) => patchNode(node.id, { label: event.target.value })} className="h-9" /></div>
              {["greeting", "message", "menu", "voicemail", "hangup"].includes(node.kind) && <div className="space-y-1.5"><div className="flex items-center justify-between"><Label htmlFor="node-text" className="text-xs">What the caller hears</Label><button type="button" onClick={() => speak(node.text)} className="inline-flex items-center gap-1 text-[11px] text-primary"><Volume2 className="h-3 w-3" />Listen</button></div><Textarea id="node-text" rows={3} value={node.text ?? ""} onChange={(event) => patchNode(node.id, { text: event.target.value })} /></div>}
              {node.kind === "queue" && <div className="space-y-1.5"><Label className="text-xs">Queue</Label><Select value={node.target ?? "General"} onValueChange={(value) => patchNode(node.id, { target: value })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{QUEUES.map((queue) => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}</SelectContent></Select></div>}
              {node.kind === "ringgroup" && <div className="space-y-1.5"><Label className="text-xs">Phone group</Label><Select value={node.target ?? ""} onValueChange={(value) => patchNode(node.id, { target: value })}><SelectTrigger className="h-9"><SelectValue placeholder="Choose a group" /></SelectTrigger><SelectContent>{groupNames.map((group) => <SelectItem key={group} value={group}>{group}</SelectItem>)}</SelectContent></Select></div>}
              {node.kind === "transfer" && <div className="space-y-1.5"><Label htmlFor="node-target" className="text-xs">Phone number</Label><Input id="node-target" inputMode="tel" value={node.target ?? ""} onChange={(event) => patchNode(node.id, { target: event.target.value })} className="h-9 font-mono" /></div>}
              {node.kind === "collectDigits" && <div className="space-y-2"><div className="space-y-1"><Label className="text-xs">Required digit count</Label><Input type="number" min={1} max={12} value={node.digitsLength ?? 4} onChange={(event) => patchNode(node.id, { digitsLength: Math.max(1, Math.min(12, Number(event.target.value))) })} /></div><p className="text-[11px] text-muted-foreground">Connect the “Digits collected” and “Invalid or timed out” ports. Input is stored only in this simulation.</p></div>}
              {["setVariable", "getCallerNumber"].includes(node.kind) && <div className="space-y-2"><div className="space-y-1"><Label className="text-xs">Variable name</Label><Input value={node.variableName ?? ""} onChange={(event) => patchNode(node.id, { variableName: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} placeholder="callerType" /></div>{node.kind === "setVariable" && <div className="space-y-1"><Label className="text-xs">Value</Label><Input value={node.variableValue ?? ""} onChange={(event) => patchNode(node.id, { variableValue: event.target.value })} placeholder="standard" /></div>}<p className="text-[11px] text-muted-foreground">Values exist only inside the local test run.</p></div>}
              {["ifElse", "switch"].includes(node.kind) && <div className="space-y-2"><div className="space-y-1"><Label className="text-xs">Variable to inspect</Label><Input value={node.variableName ?? ""} onChange={(event) => patchNode(node.id, { variableName: event.target.value })} placeholder="callerType" /></div>{node.kind === "ifElse" && <div className="space-y-1"><Label className="text-xs">Expected value</Label><Input value={node.expectedValue ?? ""} onChange={(event) => patchNode(node.id, { expectedValue: event.target.value })} /></div>}<p className="text-[11px] text-muted-foreground">Configure and connect the named branch ports on the node.</p></div>}
              {node.kind === "callerIdCondition" && <div className="space-y-1"><Label className="text-xs">Number contains</Label><Input value={node.expectedValue ?? ""} onChange={(event) => patchNode(node.id, { expectedValue: event.target.value })} placeholder="+255" /><p className="text-[11px] text-muted-foreground">This checks only the simulated caller number.</p></div>}
              {node.kind === "wait" && <div className="space-y-1"><Label className="text-xs">Wait seconds (preview label only)</Label><Input type="number" min={0} max={300} value={node.waitSeconds ?? 1} onChange={(event) => patchNode(node.id, { waitSeconds: Math.max(0, Math.min(300, Number(event.target.value))) })} /><p className="text-[11px] text-muted-foreground">The local simulator advances immediately; it does not pause for real time.</p></div>}
              {node.kind === "retry" && <div className="space-y-1"><Label className="text-xs">Retry limit (preview metadata)</Label><Input type="number" min={0} max={10} value={node.retryLimit ?? 1} onChange={(event) => patchNode(node.id, { retryLimit: Math.max(0, Math.min(10, Number(event.target.value))) })} /><p className="text-[11px] text-muted-foreground">Retry policy is displayed in the execution trace; no external action is repeated.</p></div>}
              {node.kind === "menu" && <div className="space-y-2"><div className="flex items-center justify-between"><Label className="text-xs">Keypad options</Label><Button size="sm" variant="outline" onClick={addMenuOption}><Plus className="h-3.5 w-3.5" />Add key</Button></div>{node.options?.map((option, index) => <div key={option.key} className="flex gap-2"><Select value={option.key} onValueChange={(key) => { if (node.options?.some((existing, i) => i !== index && existing.key === key)) { toast.error(`Key ${key} is already used`); return; } patchNode(node.id, { options: node.options!.map((existing, i) => i === index ? { ...existing, key } : existing) }); }}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{MENU_KEYS.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent></Select><Input value={option.label} onChange={(event) => patchNode(node.id, { options: node.options!.map((existing, i) => i === index ? { ...existing, label: event.target.value } : existing) })} className="h-8" aria-label={`Label for key ${option.key}`} /><Button size="icon" variant="ghost" aria-label={`Remove key ${option.key}`} onClick={() => patchNode(node.id, { options: node.options!.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button></div>)}<div className="grid grid-cols-2 gap-2 border-t border-border pt-2"><div className="space-y-1"><Label htmlFor="menu-retries" className="text-xs">Maximum retries</Label><Input id="menu-retries" type="number" min={0} max={10} value={node.maxRetries ?? 3} onChange={(event) => patchNode(node.id, { maxRetries: Math.max(0, Math.min(10, Number(event.target.value))) })} /></div><div className="space-y-1"><Label htmlFor="menu-timeout" className="text-xs">No-input timeout (sec)</Label><Input id="menu-timeout" type="number" min={1} max={60} value={node.noInputTimeoutSec ?? 5} onChange={(event) => patchNode(node.id, { noInputTimeoutSec: Math.max(1, Math.min(60, Number(event.target.value))) })} /></div></div><p className="text-[11px] text-muted-foreground">Connect the Invalid input and No input / timeout outlets on the node when you want a fallback route.</p></div>}
              {!END_KINDS.includes(node.kind) && !!node.routes?.length && <div className="space-y-2 surface-recessed rounded-[16px] p-2"><div className="flex items-center justify-between"><Label className="text-xs">{["ifElse", "switch", "dayOfWeek", "languageCondition", "callerIdCondition", "collectDigits"].includes(node.kind) ? "Condition branches" : "Additional routes"}</Label>{["ifElse", "switch"].includes(node.kind) && <Button size="sm" variant="outline" onClick={addRoute}><Plus className="h-3.5 w-3.5" />Add route</Button>}</div>{node.routes.map((route) => <div key={route.id} className="space-y-1 surface-recessed rounded-xl p-2"><div className="flex gap-2"><Input value={route.label} onChange={(event) => patchNode(node.id, { routes: node.routes!.map((item) => item.id === route.id ? { ...item, label: event.target.value } : item) })} className="h-8" aria-label="Route name" />{["ifElse", "switch"].includes(node.kind) && !["yes", "no", "default"].includes(route.id) && <Button size="icon" variant="ghost" aria-label={`Remove ${route.label}`} onClick={() => patchNode(node.id, { routes: node.routes!.filter((item) => item.id !== route.id) })}><Trash2 className="h-4 w-4" /></Button>}</div>{["switch", "languageCondition", "dayOfWeek", "callerIdCondition"].includes(node.kind) && <Input value={route.value ?? ""} onChange={(event) => patchNode(node.id, { routes: node.routes!.map((item) => item.id === route.id ? { ...item, value: event.target.value } : item) })} className="h-8" aria-label={`${route.label} match value`} placeholder="Match value" />}<p className="text-[10px] text-muted-foreground">Connect the “{route.label}” outlet on the canvas to its destination.</p></div>)}</div>}
              {END_KINDS.includes(node.kind) && <p className="surface-flat rounded-xl p-2 text-xs text-muted-foreground">This is an ending step. Calls stop here.</p>}
              {issues.length > 0 && <div className="rounded-md border border-warning/40 bg-warning-soft p-2 text-xs text-foreground">{issues.slice(0, 3).map((issue) => <p key={issue}>{issue}</p>)}</div>}
            </div>
          </Panel>
          <Button variant="outline" className="w-full" disabled={node.id === flow.startId} onClick={() => { patchFlow((current) => removeNode(current, node.id)); setSel(flow.startId); toast("Step removed"); }}><Trash2 className="h-4 w-4" />Remove selected step</Button>
        </div>
      </div>
    </div>
  );
}
