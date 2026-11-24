import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { BookOpen, Mail, Plus, Search } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { PageHeader, Panel, StatusBadge } from "@/components/kit";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiPost, extractData, useApiCollection, useApiResource } from "@/lib/api";

const emptyHelp = { articles: [] as Array<{ id: string; title: string; category: string; minutes: number }>, faqs: [] as Array<[string, string]> };

export const Route = createFileRoute("/admin/help")({
  head: () => pageHead("Knowledge Base", "Guides, answers and support for MPANGE AI Call Center."),
  component: HelpPage,
});

function HelpPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [articleOpen, setArticleOpen] = useState(false);
  const { items: articles, setItems: setArticles } = useApiCollection("help-articles", [], "helpArticles");
  const { value: help } = useApiResource("help", emptyHelp);
  const { items: tickets } = useApiCollection<{ id: string; subject: string; status: string; opened: string }>("support", [], "support");
  const [articleForm, setArticleForm] = useState({ title: "", category: "General", content: "", minutes: "3" });
  const cats = ["All", ...new Set(articles.map((a) => a.category))];
  const filteredArticles = articles.filter((a) => (cat === "All" || a.category === cat) && `${a.title} ${a.category}`.toLowerCase().includes(q.toLowerCase()));

  async function addArticle() {
    if (!articleForm.title.trim()) { toast.error("Add a title for this knowledge-base article"); return; }
    const minutes = Number(articleForm.minutes);
    const article = {
      id: `custom-${Date.now()}`,
      title: articleForm.title.trim(),
      category: articleForm.category.trim() || "General",
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 3,
    };
    try { const response = await apiPost<{ data?: typeof article; article?: typeof article }>("help-articles", article); setArticles((current) => [extractData(response, "article", article), ...current]); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Article was not saved"); return; }
    setArticleForm({ title: "", category: "General", content: "", minutes: "3" });
    setArticleOpen(false);
    toast.success("Knowledge-base article added");
  }

  return (
    <AdminShell>
      <PageHeader title="Knowledge Base" description="Short guides and common answers for MPANGE AI Call Center."
        actions={<>
          <Button variant="outline" size="icon" onClick={() => setArticleOpen(true)} aria-label="Add knowledge base article" title="Add knowledge base article"><Plus className="h-4 w-4" /></Button>
        </>} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides… e.g. transfer, IVR, campaign" className="h-11 pl-9" aria-label="Search guides" />
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)}>{c}</Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filteredArticles.map((a) => (
          <button key={a.id} onClick={() => toast(a.title, { description: `${a.category} guide · ${a.minutes} min read` })}
            className="soft-card group flex items-start gap-3 rounded-xl p-4 text-left">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><BookOpen className="h-4 w-4" aria-hidden /></span>
            <span><span className="block font-medium group-hover:text-primary">{a.title}</span><span className="text-xs text-muted-foreground">{a.category} · {a.minutes} min read</span></span>
          </button>
        ))}
        {filteredArticles.length === 0 && <p className="text-sm text-muted-foreground">No guides match “{q}”.</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Common questions" className="lg:col-span-2">
          <Accordion type="single" collapsible>
            {help.faqs.map(([question, answer]) => (
              <AccordionItem key={question} value={question!}>
                <AccordionTrigger className="text-left text-sm">{question}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {help.faqs.length === 0 && <p className="text-sm text-muted-foreground">No frequently asked questions are configured.</p>}
        </Panel>
        <Panel title="Your support requests">
          <ul className="space-y-3">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                <span><span className="block text-sm font-medium">{t.subject}</span><span className="font-mono text-[11px] text-muted-foreground">{t.id} · {fmtTime(t.opened)}</span></span>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" />support@mpange.co.tz</p>
        </Panel>
      </div>

      <Dialog open={articleOpen} onOpenChange={setArticleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Knowledge Base</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="kb-title">Article title</Label>
              <Input id="kb-title" value={articleForm.title} onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })} placeholder="e.g. Setting up a new queue" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kb-category">Category</Label>
              <Input id="kb-category" value={articleForm.category} onChange={(e) => setArticleForm({ ...articleForm, category: e.target.value })} placeholder="e.g. Queues" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kb-content">Article content</Label>
              <Textarea id="kb-content" rows={4} value={articleForm.content} onChange={(e) => setArticleForm({ ...articleForm, content: e.target.value })} placeholder="Add the guide or answer for your team." />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kb-minutes">Estimated read time (minutes)</Label>
              <Input id="kb-minutes" type="number" min="1" value={articleForm.minutes} onChange={(e) => setArticleForm({ ...articleForm, minutes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArticleOpen(false)}>Cancel</Button>
            <Button onClick={addArticle}><Plus className="h-4 w-4" />Add article</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
