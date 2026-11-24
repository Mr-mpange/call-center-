import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Play, Plus, Rocket } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { PageHeader, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlowBuilder } from "@/components/ivr/FlowBuilder";
import { makeNode, type IvrFlow, validateFlow } from "@/lib/ivr";
import { pageHead } from "@/lib/seo";
import { apiPost, apiPut, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/admin/ivr")({
  head: () => pageHead("Phone & IVR", "Manage phone numbers and build caller menus for your organization."),
  component: IvrPage,
});

function IvrPage() {
  const [flow, setFlow] = useState<IvrFlow | null>(null);
  const [draftFlow, setDraftFlow] = useState<IvrFlow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [flowName, setFlowName] = useState("");
  const [testTrigger, setTestTrigger] = useState(0);
  const { items: flows, setItems: setFlows } = useApiCollection<IvrFlow>("ivr/flows", [], "flows");
  const { items: numbers } = useApiCollection<{ number: string; type?: string }>("phone-numbers", [], "phoneNumbers");
  const { items: groups } = useApiCollection<{ name: string }>("ivr/forwarding-groups", [], "groups");
  useEffect(() => { if (!flow && flows[0]) setFlow(flows[0]); }, [flow, flows]);
  useEffect(() => {
    if (flow || draftFlow) return;
    const welcome = makeNode("greeting");
    setDraftFlow({ id: "draft-flow", name: "New IVR flow", number: numbers.find((entry) => entry.type !== "Short code")?.number ?? "", startId: welcome.id, nodes: { [welcome.id]: welcome }, published: false });
  }, [draftFlow, flow, numbers]);

  const createFlow = async () => {
    const welcome = makeNode("greeting");
    const next: IvrFlow = { id: `f-${Date.now().toString(36)}`, name: flowName.trim() || "New flow", number: "", startId: welcome.id, nodes: { [welcome.id]: welcome }, published: false };
    try { const response = await apiPost<{ data?: IvrFlow; flow?: IvrFlow }>("ivr/flows", next); const saved = response.flow ?? response.data ?? next; setFlows((current) => [saved, ...current]); setFlow(saved); }
    catch (error) { toast.error(error instanceof Error ? error.message : "IVR flow was not saved"); return; }
    setCreateOpen(false);
    setFlowName("");
    toast.success("New IVR flow created");
  };

  const testFlow = () => flow ? setTestTrigger((value) => value + 1) : toast("Create a flow before testing");
  const publishFlow = async () => {
    if (!flow) { toast.error("Create a flow before publishing"); return; }
    const errors = validateFlow(flow);
    if (errors.length) { toast.error("Complete the flow before publishing", { description: errors[0] }); return; }
    try { const response = await apiPost<{ data?: IvrFlow; flow?: IvrFlow }>(`ivr/flows/${flow.id}/publish`); const published = response.flow ?? response.data ?? { ...flow, published: true }; setFlow(published); setFlows((current) => current.map((item) => item.id === published.id ? published : item)); toast.success(`“${flow.name}” published`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "IVR flow was not published"); }
  };

  async function saveFlow(updated: IvrFlow) {
    try { const response = await apiPut<{ data?: IvrFlow; flow?: IvrFlow }>(`ivr/flows/${updated.id}`, updated); const saved = response.flow ?? response.data ?? updated; setFlow(saved); setFlows((current) => current.map((item) => item.id === saved.id ? saved : item)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "IVR flow changes were not saved"); }
  }

  async function saveDraftFlow(updated: IvrFlow) {
    try {
      const { id: _draftId, ...payload } = updated;
      const response = await apiPost<{ data?: IvrFlow; flow?: IvrFlow }>("ivr/flows", payload);
      const saved = response.flow ?? response.data;
      if (!saved) throw new Error("The server did not return the saved IVR flow");
      setFlows((current) => [saved, ...current]);
      setFlow(saved);
      setDraftFlow(null);
      toast.success("IVR flow saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "IVR flow was not saved"); }
  }

  return (
    <AdminShell>
      <PageHeader title="Phone & IVR" actions={<>
        <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />Create flow</Button>
        <Button variant="secondary" onClick={testFlow}><Play className="h-4 w-4" />Test</Button>
        <Button onClick={publishFlow}><Rocket className="h-4 w-4" />Publish preview</Button>
      </>} />
      {flow ? <FlowBuilder key={flow.id} initialFlowId={flow.id} initialFlows={[flow]} onSave={saveFlow} testTrigger={testTrigger} groupNames={groups.map((group) => group.name)} numbers={numbers.filter((entry) => entry.type !== "Short code").map((entry) => entry.number)} /> : draftFlow ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Create and edit the IVR flow first. A phone number can be selected later from the canvas.</p><FlowBuilder key={draftFlow.id} initialFlowId={draftFlow.id} initialFlows={[draftFlow]} onSave={saveDraftFlow} testTrigger={testTrigger} groupNames={groups.map((group) => group.name)} numbers={numbers.filter((entry) => entry.type !== "Short code").map((entry) => entry.number)} /></div> : <Panel title="IVR canvas"><p className="text-sm text-muted-foreground">The IVR canvas is ready. Create a flow to start configuring it.</p></Panel>}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create an IVR flow</DialogTitle>
            <DialogDescription>Give your new call flow a name. You can add and connect steps after creating it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-flow-name">Flow name</Label>
            <Input id="new-flow-name" autoFocus placeholder="For example, Main support line" value={flowName} onChange={(event) => setFlowName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createFlow(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createFlow}><Plus className="h-4 w-4" />Create flow</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
