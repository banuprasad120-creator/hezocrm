import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, FolderPlus, Loader2, Trash2, Upload, Users2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImportLeadsWizard } from "@/components/crm/ImportLeadsWizard";
import { supabase } from "@/integrations/supabase/client";
import { useCrmSession } from "@/hooks/use-crm-session";
import { CONTACTED_STATUSES, todayISO } from "@/lib/crm";
import { deleteFolderServerFn } from "@/lib/crm.functions";

export const Route = createFileRoute("/_app/folders")({
  head: () => ({
    meta: [
      { title: "Daily Call Folders — Hezo CRM" },
      { name: "description", content: "Create date-wise lead folders, upload leads into them and assign to agents." },
      { property: "og:title", content: "Daily Call Folders — Hezo CRM" },
      { property: "og:description", content: "Create date-wise lead folders and upload leads in bulk." },
    ],
  }),
  component: FoldersPage,
});

const fmt = (d: string) => d.split("-").reverse().join("-");

function FoldersPage() {
  const { data: session, isLoading: sessionLoading } = useCrmSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const companyId = session?.companyId ?? null;
  const isAdmin = session?.isAdmin ?? false;

  const [newOpen, setNewOpen] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());
  const [importDate, setImportDate] = useState<string | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ date: string; count: number } | null>(null);

  const deleteFolderM = useMutation({
    mutationFn: async (date: string) => {
      return await deleteFolderServerFn({ data: { folderDate: date } });
    },
    onSuccess: (res, date) => {
      toast.success(`Deleted folder ${fmt(date)} and removed ${res.deletedCount} leads`);
      setFolderToDelete(null);
      qc.invalidateQueries({ queryKey: ["folder-overview"] });
      qc.invalidateQueries({ queryKey: ["lead-folders"] });
      qc.invalidateQueries({ queryKey: ["daily-lead-stats"] });
      qc.invalidateQueries({ queryKey: ["all-leads"] });
      qc.invalidateQueries({ queryKey: ["all-leads-stats"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder");
    },
  });

  const { data: folders = [], isLoading } = useQuery({
    queryKey: ["folder-overview", companyId],
    enabled: Boolean(companyId) && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_folder_counts")
        .select("folder_date, lead_count")
        .eq("company_id", companyId!)
        .order("folder_date", { ascending: false })
        .limit(24);
      if (error) throw error;
      const base = (data ?? []).map((r) => ({ date: r.folder_date as string, count: Number(r.lead_count) }));

      const detailed = await Promise.all(
        base.map(async (f) => {
          const head = () =>
            supabase.from("leads").select("id", { count: "exact", head: true })
              .eq("company_id", companyId!).eq("folder_date", f.date);
          const [{ count: assigned }, { count: called }] = await Promise.all([
            head().not("assigned_to", "is", null),
            head().in("status", [...CONTACTED_STATUSES]),
          ]);
          return { ...f, assigned: assigned ?? 0, called: called ?? 0 };
        }),
      );
      return detailed;
    },
  });

  const totals = useMemo(
    () => folders.reduce((a, f) => ({ leads: a.leads + f.count, assigned: a.assigned + f.assigned, called: a.called + f.called }), { leads: 0, assigned: 0, called: 0 }),
    [folders],
  );

  const openFolder = (date: string) => navigate({ to: "/daily-leads", search: { date } });

  const createFolder = () => {
    if (!newDate) return toast.error("Pick a date for the folder");
    setNewOpen(false);
    setImportDate(newDate);
  };

  if (!sessionLoading && session && !isAdmin) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center card-elevated">
        <p className="text-lg font-bold">Restricted area</p>
        <p className="mt-1 text-sm text-muted-foreground">Only company admins can manage daily call folders.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Daily Call Folders"
        description="Create a date-wise folder, upload leads into it, then assign them to your agents."
        actions={
          <Button size="sm" className="gradient-brand text-white" onClick={() => { setNewDate(todayISO()); setNewOpen(true); }}>
            <FolderPlus className="mr-1 h-4 w-4" /> New Folder
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-4">
        {([
          ["Folders", folders.length],
          ["Total Leads", totals.leads],
          ["Assigned", totals.assigned],
          ["Called", totals.called],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-card p-3.5 card-elevated sm:p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[11px]">{label}</p>
            <p className="mt-1 truncate text-xl font-extrabold sm:text-2xl">{value.toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="grid place-items-center rounded-2xl border bg-card p-16 card-elevated">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : folders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-16 text-center card-elevated">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border bg-elevated">
            <FolderKanban className="h-6 w-6 text-muted-foreground" />
          </span>
          <div>
            <p className="text-[15px] font-semibold">No folders yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a folder for a date and upload your lead file into it.</p>
          </div>
          <Button size="sm" className="gradient-brand text-white" onClick={() => { setNewDate(todayISO()); setNewOpen(true); }}>
            <FolderPlus className="mr-1 h-4 w-4" /> Create Folder
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {folders.map((f) => {
            const progress = f.count > 0 ? Math.round((f.called / f.count) * 100) : 0;
            return (
              <div key={f.date} className="group relative overflow-hidden rounded-2xl border bg-card p-5 card-elevated transition hover:-translate-y-1 hover:card-float">
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-brand/20 to-brand-2/10 opacity-40" />
                <div className="relative">
                  <div className="flex items-start justify-between">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand/25 to-brand-2/10 text-brand shadow-sm">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete this folder & its leads"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToDelete({ date: f.date, count: f.count });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <h3 className="mt-4 text-base font-bold">📁 {fmt(f.date)}</h3>
                  <p className="text-xs text-muted-foreground">
                    {f.count.toLocaleString("en-IN")} leads · {f.assigned.toLocaleString("en-IN")} assigned
                  </p>
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Called</span>
                      <span className="font-semibold">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-1.5" />
                  </div>
                  <div className="mt-4 flex items-center gap-1.5">
                    <Button size="sm" className="h-8 flex-1 gradient-brand text-xs text-white" onClick={() => openFolder(f.date)}>
                      <Users2 className="mr-1 h-3 w-3" /> Open & Assign
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => setImportDate(f.date)}>
                      <Upload className="mr-1 h-3 w-3" /> Upload
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
                      title="Delete folder & data"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToDelete({ date: f.date, count: f.count });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(folderToDelete)} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete Folder {folderToDelete ? fmt(folderToDelete.date) : ""}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete folder <strong>{folderToDelete ? fmt(folderToDelete.date) : ""}</strong>?
              <br /><br />
              This will permanently delete all <strong>{folderToDelete?.count.toLocaleString("en-IN")}</strong> uploaded leads and their call histories in this folder. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleteFolderM.isPending} onClick={() => setFolderToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteFolderM.isPending}
              onClick={() => {
                if (folderToDelete) deleteFolderM.mutate(folderToDelete.date);
              }}
            >
              {deleteFolderM.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Yes, Delete Entire Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New daily folder</DialogTitle>
            <DialogDescription>Pick the folder date, then upload your leads file into it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-date">Folder date</Label>
            <Input id="folder-date" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button className="gradient-brand text-white" onClick={createFolder}>
              <Upload className="mr-1 h-4 w-4" /> Upload leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportLeadsWizard
        open={Boolean(importDate)}
        onOpenChange={(v) => { if (!v) { setImportDate(null); qc.invalidateQueries({ queryKey: ["folder-overview"] }); } }}
        companyId={companyId}
        userId={session?.userId ?? null}
        folderDate={importDate ?? todayISO()}
        onViewImported={() => { if (importDate) openFolder(importDate); }}
      />
    </>
  );
}
