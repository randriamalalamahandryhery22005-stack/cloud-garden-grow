import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldAlert, ShieldCheck, Ban, Search, RefreshCw, UserX, Send } from "lucide-react";
import { missingProfileFields, type ProfileLike } from "@/lib/accountReview";

type Row = ProfileLike & {
  created_at?: string | null;
  region?: string | null;
  is_validated?: boolean | null;
};

const STATUS_LABEL: Record<string, string> = {
  restricted: "Restreint",
  blocked: "Bloqué",
  active: "Actif",
};

/** Console d'administration des comptes restreints et bloqués. */
export default function AdminRestrictedPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "restricted" | "blocked">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id,full_name,name,birth_date,gender,phone,country_code,region,avatar_url,status,is_validated,created_at")
      .in("status", ["restricted", "blocked"])
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) toast.error("Chargement impossible");
    setRows((data || []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`admin-restricted-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch { /* noop */ } };
  }, [load]);

  const setStatus = async (row: Row, status: "active" | "restricted" | "blocked") => {
    setBusy(row.user_id);
    const patch: Record<string, unknown> = { status };
    if (status === "active") patch.is_validated = true;
    const { error } = await supabase.from("profiles").update(patch as never).eq("user_id", row.user_id);
    if (error) toast.error("Action impossible");
    else {
      await supabase.from("notifications").insert({
        title:
          status === "active" ? "Compte réactivé ✅" : status === "blocked" ? "Compte bloqué" : "Compte restreint",
        message:
          status === "active"
            ? "Votre compte est de nouveau pleinement actif."
            : status === "blocked"
              ? "Votre compte a été bloqué par l'administration."
              : "Votre compte est restreint : complétez vos informations et envoyez une demande d'examen.",
        is_global: false,
        target_user_id: row.user_id,
        created_by: row.user_id,
      });
      toast.success(`Statut mis à jour : ${STATUS_LABEL[status]}`);
      void load();
    }
    setBusy(null);
  };

  const notify = async (row: Row) => {
    const message = window.prompt("Message à envoyer à cet utilisateur :");
    if (!message?.trim()) return;
    const { error } = await supabase.from("notifications").insert({
      title: "Message de l'administration",
      message: message.trim(),
      is_global: false,
      target_user_id: row.user_id,
      created_by: row.user_id,
    });
    if (error) toast.error("Envoi impossible");
    else toast.success("Message envoyé");
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "all" ? true : r.status === filter))
      .filter((r) =>
        !term
          ? true
          : `${r.full_name ?? ""} ${r.name ?? ""} ${r.phone ?? ""} ${r.user_id}`.toLowerCase().includes(term)
      );
  }, [rows, q, filter]);

  return (
    <div className="space-y-4" style={{ animation: "fade-up 0.4s ease forwards" }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black">Comptes restreints</h2>
            <p className="text-[11px] text-muted-foreground">{filtered.length} compte(s) concerné(s)</p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher..."
            className="pl-8 pr-3 h-9 text-xs rounded-xl bg-secondary/50 border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {(["all", "restricted", "blocked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-9 px-3 rounded-xl text-[11px] font-bold border transition ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border/50 text-muted-foreground"
            }`}
          >
            {f === "all" ? "Tous" : STATUS_LABEL[f]}
          </button>
        ))}
        <button onClick={() => void load()} className="h-9 w-9 rounded-xl bg-secondary/40 border border-border/50 flex items-center justify-center" aria-label="Rafraîchir">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14 text-muted-foreground text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 text-sm text-muted-foreground">Aucun compte restreint ou bloqué.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const missing = missingProfileFields(r);
            return (
              <div key={r.user_id} className="rounded-2xl border border-border/50 bg-card/60 p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-secondary flex items-center justify-center shrink-0">
                    {r.avatar_url ? (
                      <img src={r.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <UserX className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{r.full_name || r.name || "Sans nom"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{r.phone || r.user_id}</p>
                  </div>
                  <span
                    className={`text-[10px] font-black px-2 py-1 rounded-full border ${
                      r.status === "blocked"
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {STATUS_LABEL[r.status || ""] || r.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
                  <span>Pays : {r.country_code || "—"}</span>
                  <span>Région : {r.region || "—"}</span>
                  <span>Naissance : {r.birth_date || "—"}</span>
                  <span>Sexe : {r.gender || "—"}</span>
                </div>

                <div className="text-[10px]">
                  <span className="text-muted-foreground">Informations manquantes : </span>
                  {missing.length === 0 ? (
                    <span className="text-emerald-400 font-semibold">Aucune</span>
                  ) : (
                    <span className="text-amber-400 font-semibold">{missing.join(", ")}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    disabled={busy === r.user_id}
                    onClick={() => setStatus(r, "active")}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
                  >
                    <ShieldCheck className="w-3 h-3" /> Réactiver
                  </button>
                  {r.status !== "restricted" && (
                    <button
                      disabled={busy === r.user_id}
                      onClick={() => setStatus(r, "restricted")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 disabled:opacity-50"
                    >
                      <ShieldAlert className="w-3 h-3" /> Restreindre
                    </button>
                  )}
                  {r.status !== "blocked" && (
                    <button
                      disabled={busy === r.user_id}
                      onClick={() => setStatus(r, "blocked")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30 disabled:opacity-50"
                    >
                      <Ban className="w-3 h-3" /> Bloquer
                    </button>
                  )}
                  <button
                    onClick={() => notify(r)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-secondary/60 border border-border/50"
                  >
                    <Send className="w-3 h-3" /> Message
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
