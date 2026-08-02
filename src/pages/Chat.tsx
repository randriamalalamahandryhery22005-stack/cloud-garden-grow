import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import BottomNav from "@/components/BottomNav";
import { useCall } from "@/contexts/CallContext";
import VoiceRecorder from "@/components/VoiceRecorder";
import VoiceMessagePlayer from "@/components/VoiceMessagePlayer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AccountBadges from "@/components/AccountBadges";
import UserProfileDialog from "@/components/UserProfileDialog";
import CallHistoryDialog from "@/components/CallHistoryDialog";
import { useAccountBadges } from "@/hooks/useAccountBadges";
import { buildEditedContent, parseMessage, withAttachments } from "@/lib/chatMeta";
import {
  ArrowLeft,
  Send,
  ImagePlus,
  Paperclip,
  X,
  Search,
  Reply,
  Trash2,
  Loader2,
  MessageCircle,
  Smile,
  Eye,
  Check,
  CheckCheck,
  Phone,
  FileText,
  Download,
  Play,
  Pencil,
  History,
  PhoneCall,
} from "lucide-react";

const AUDIO_RX = /\.(webm|ogg|mp3|m4a|wav|aac)(\?|$)/i;
const IMAGE_RX = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)(\?|$)/i;
const VIDEO_RX = /\.(mp4|mov|webm|mkv|m4v|3gp|avi)(\?|$)/i;
const isAudioPath = (p?: string | null) => !!p && AUDIO_RX.test(p);
const isImagePath = (p?: string | null) => !!p && IMAGE_RX.test(p);
const isVideoPath = (p?: string | null) => !!p && VIDEO_RX.test(p);
const fileNameFromPath = (p: string) => {
  const raw = p.split("/").pop() || p;
  return raw.replace(/^\d+-[a-z0-9]+\./i, (m) => m.split(".").slice(1).join("."));
};
const MAX_FILE_MB = 100;
/** Jusqu'à 5 images par message, ou un seul fichier d'un autre type. */
const MAX_IMAGES = 5;

type ChatRow = {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  reply_to_id: string | null;
  created_at: string;
};

type Profile = {
  user_id: string;
  name: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type Reaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
};

type ReadRow = {
  message_id: string;
  user_id: string;
  read_at: string;
};

type Draft = { file: File; preview: string | null; isImage: boolean };

const SIGNED_TTL = 60 * 60 * 24 * 365;
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "🙏"];

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}
function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const isYest = d.toDateString() === y.toDateString();
  if (isToday) return "Aujourd'hui";
  if (isYest) return "Hier";
  return d.toLocaleDateString();
}

export default function Chat() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [replyTo, setReplyTo] = useState<ChatRow | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);
  const [viewersFor, setViewersFor] = useState<ChatRow | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [originalFor, setOriginalFor] = useState<ChatRow | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const { admins, premium } = useAccountBadges();

  const { openPanel: openCallPanel } = useCall();
  const setCallOpen = (v: boolean) => { if (v) openCallPanel(); };

  // Auto-open call panel when arriving with ?call=1 (from incoming call accept)
  useEffect(() => {
    if (searchParams.get("call") === "1") {
      openCallPanel();
      const next = new URLSearchParams(searchParams);
      next.delete("call");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openCallPanel]);

  const [voiceActive, setVoiceActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  const profilesRef = useRef(profiles);
  useEffect(() => { profilesRef.current = profiles; }, [profiles]);

  const loadProfiles = useCallback(async (ids: string[]) => {
    const missing = Array.from(new Set(ids)).filter((id) => !profilesRef.current[id]);
    if (missing.length === 0) return;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, name, full_name, avatar_url")
      .in("user_id", missing);
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data as Profile[]) next[p.user_id] = p;
        return next;
      });
    }
  }, []);

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const signedRef = useRef(signedUrls);
  useEffect(() => { signedRef.current = signedUrls; }, [signedUrls]);

  const resolveImage = useCallback(async (path: string) => {
    if (!path || signedRef.current[path]) return;
    if (path.startsWith("http")) {
      setSignedUrls((s) => ({ ...s, [path]: path }));
      return;
    }
    const { data } = await supabase.storage.from("chat-files").createSignedUrl(path, SIGNED_TTL);
    if (data?.signedUrl) setSignedUrls((s) => ({ ...s, [path]: data.signedUrl }));
  }, []);

  /** Toutes les pièces jointes d'un message (image_url + pièces additionnelles). */
  const pathsOf = useCallback((m: ChatRow) => {
    const extra = parseMessage(m.content).attachments;
    return [m.image_url, ...extra].filter((p): p is string => !!p);
  }, []);

  const resolveAll = useCallback((rows: ChatRow[]) => {
    for (const m of rows) for (const p of pathsOf(m)) void resolveImage(p);
  }, [pathsOf, resolveImage]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [msgRes, reactRes, readRes] = await Promise.all([
        supabase.from("global_chat_messages").select("*").order("created_at", { ascending: true }).limit(300),
        supabase.from("chat_message_reactions").select("*"),
        supabase.from("chat_message_reads").select("message_id,user_id,read_at"),
      ]);
      if (cancelled) return;
      if (msgRes.error) {
        toast.error("Impossible de charger le chat");
        setLoading(false);
        return;
      }
      const rows = (msgRes.data || []) as ChatRow[];
      setMessages(rows);
      setReactions((reactRes.data || []) as Reaction[]);
      setReads((readRes.data || []) as ReadRow[]);
      await loadProfiles(rows.map((m) => m.user_id));
      resolveAll(rows);
      setLoading(false);
      setTimeout(() => scrollToBottom(false), 50);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime
  const atBottomRef = useRef(atBottom);
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);

  useEffect(() => {
    const channel = supabase
      .channel("global_chat_v3")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "global_chat_messages" }, (payload) => {
        const row = payload.new as ChatRow;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        void loadProfiles([row.user_id]);
        resolveAll([row]);
        if (!atBottomRef.current && row.user_id !== user?.id) setUnreadCount((c) => c + 1);
        else setTimeout(() => scrollToBottom(true), 30);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "global_chat_messages" }, (payload) => {
        const row = payload.new as ChatRow;
        setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        resolveAll([row]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "global_chat_messages" }, (payload) => {
        const oldRow = payload.old as { id: string };
        setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_message_reactions" }, (payload) => {
        const r = payload.new as Reaction;
        setReactions((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_message_reactions" }, (payload) => {
        const r = payload.old as { id: string };
        setReactions((prev) => prev.filter((x) => x.id !== r.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_message_reads" }, (payload) => {
        const r = payload.new as ReadRow;
        setReads((prev) =>
          prev.some((x) => x.message_id === r.message_id && x.user_id === r.user_id) ? prev : [...prev, r]
        );
        void loadProfiles([r.user_id]);
      })
      .subscribe();

    async function fetchOnline() {
      const { data } = await supabase.from("online_users").select("user_id");
      if (data) setOnlineIds(new Set((data as { user_id: string }[]).map((u) => u.user_id)));
    }
    const onlineChannel = supabase
      .channel("chat_online_v3")
      .on("postgres_changes", { event: "*", schema: "public", table: "online_users" }, fetchOnline)
      .subscribe();
    void fetchOnline();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(onlineChannel);
    };
  }, [user?.id, loadProfiles, resolveAll, scrollToBottom]);

  // Auto-mark messages as read (visible + not own)
  useEffect(() => {
    if (!user) return;
    const toMark = messages.filter(
      (m) =>
        m.user_id !== user.id &&
        !reads.some((r) => r.message_id === m.id && r.user_id === user.id)
    );
    if (toMark.length === 0) return;
    const rowsToInsert = toMark.map((m) => ({ message_id: m.id, user_id: user.id }));
    supabase.from("chat_message_reads").insert(rowsToInsert).then(({ error }) => {
      if (!error) {
        setReads((prev) => [
          ...prev,
          ...toMark.map((m) => ({ message_id: m.id, user_id: user.id, read_at: new Date().toISOString() })),
        ]);
      }
    });
  }, [messages, user, reads]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setAtBottom(near);
    if (near) setUnreadCount(0);
  };

  /** Sélection de fichiers : 5 images max, ou un seul autre fichier. */
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const accepted: Draft[] = [];
    let current = [...drafts];

    for (const f of files) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`« ${f.name} » dépasse ${MAX_FILE_MB} Mo`);
        continue;
      }
      const isImage = f.type.startsWith("image/");
      if (!isImage) {
        if (current.length > 0 || accepted.length > 0) {
          toast.error("Un seul fichier (vidéo, PDF, APK, document…) par message.");
          break;
        }
        accepted.push({ file: f, preview: null, isImage: false });
        break;
      }
      if (current.some((d) => !d.isImage)) {
        toast.error("Un seul fichier par message : retirez le fichier joint pour ajouter des images.");
        break;
      }
      if (current.length + accepted.length >= MAX_IMAGES) {
        toast.error(`Maximum ${MAX_IMAGES} images par message.`);
        break;
      }
      accepted.push({ file: f, preview: URL.createObjectURL(f), isImage: true });
    }
    if (!accepted.length) return;
    current = [...current, ...accepted];
    setDrafts(current);
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => {
      const d = prev[index];
      if (d?.preview) URL.revokeObjectURL(d.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadDraft = async (file: File, userId: string) => {
    const rawName = file.name || "fichier";
    const hasExt = /\.[a-z0-9]{1,8}$/i.test(rawName);
    const ext = hasExt ? rawName.split(".").pop()! : (file.type.split("/")[1] || "bin");
    const safeName = rawName.replace(/[^\w.\-]+/g, "_");
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}${hasExt ? "" : `.${ext}`}`;
    const { error } = await supabase.storage
      .from("chat-files")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    return path;
  };

  const send = async () => {
    if (!user) return;
    const text = input.trim();
    if (!text && drafts.length === 0) return;
    setSending(true);
    try {
      const paths: string[] = [];
      for (const d of drafts) paths.push(await uploadDraft(d.file, user.id));

      const content = withAttachments(text, paths.slice(1));
      const { error } = await supabase.from("global_chat_messages").insert({
        user_id: user.id,
        content,
        image_url: paths[0] ?? null,
        reply_to_id: replyTo?.id ?? null,
      });
      if (error) throw error;
      setInput("");
      drafts.forEach((d) => d.preview && URL.revokeObjectURL(d.preview));
      setDrafts([]);
      setReplyTo(null);
      paths.forEach((p) => void resolveImage(p));
      setTimeout(() => scrollToBottom(true), 30);
    } catch (e) {
      toast.error("Échec de l'envoi");
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: string) => {
    const previous = messages;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const { error } = await supabase.from("global_chat_messages").delete().eq("id", id);
    if (error) {
      setMessages(previous);
      toast.error("Suppression impossible");
    }
  };

  const startEdit = (m: ChatRow) => {
    setEditingId(m.id);
    setEditText(parseMessage(m.content).text);
  };

  const saveEdit = async (m: ChatRow) => {
    const next = editText.trim();
    const parsed = parseMessage(m.content);
    if (!next || next === parsed.text) { setEditingId(null); return; }
    const original = parsed.original ?? parsed.text;
    const content = withAttachments(buildEditedContent(next, original), parsed.attachments);
    // Mise à jour optimiste : l'édition est instantanée à l'écran.
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content } : x)));
    setEditingId(null);
    setSavingEdit(true);
    const { error } = await supabase.from("global_chat_messages").update({ content }).eq("id", m.id);
    setSavingEdit(false);
    if (error) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content: m.content } : x)));
      toast.error("Modification impossible");
    }
  };

  const sendVoice = async (blob: Blob, durationMs: number) => {
    if (!user) return;
    try {
      const mime = blob.type || "audio/webm";
      const ext = /mp4|m4a|aac/i.test(mime) ? "m4a" : /ogg/i.test(mime) ? "ogg" : /mpeg|mp3/i.test(mime) ? "mp3" : "webm";
      const path = `${user.id}/voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-files")
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;

      const { error } = await supabase.from("global_chat_messages").insert({
        user_id: user.id,
        content: `🎤 Message vocal · ${Math.max(1, Math.round(durationMs / 1000))}s`,
        image_url: path,
        reply_to_id: replyTo?.id ?? null,
      });
      if (error) throw error;
      setReplyTo(null);
      void resolveImage(path);
      setTimeout(() => scrollToBottom(true), 30);
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'envoi vocal");
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      const { error } = await supabase.from("chat_message_reactions").delete().eq("id", existing.id);
      if (error) toast.error("Impossible de retirer la réaction");
    } else {
      const { error } = await supabase.from("chat_message_reactions").insert({
        message_id: messageId,
        user_id: user.id,
        emoji,
      });
      if (error) toast.error("Impossible d'ajouter la réaction");
    }
    setEmojiPickerFor(null);
  };

  const visible = messages;

  const filtered = useMemo(() => {
    if (!search.trim()) return visible;
    const q = search.toLowerCase();
    return visible.filter((m) => parseMessage(m.content).text.toLowerCase().includes(q));
  }, [visible, search]);

  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ChatRow[] }> = [];
    for (const m of filtered) {
      const day = formatDay(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [filtered]);

  const msgById = useMemo(() => {
    const m: Record<string, ChatRow> = {};
    for (const x of messages) m[x.id] = x;
    return m;
  }, [messages]);

  const displayName = (p?: Profile) => p?.full_name || p?.name || "Joueur";

  const reactionsByMsg = useMemo(() => {
    const m: Record<string, Record<string, Reaction[]>> = {};
    for (const r of reactions) {
      m[r.message_id] ??= {};
      m[r.message_id][r.emoji] ??= [];
      m[r.message_id][r.emoji].push(r);
    }
    return m;
  }, [reactions]);

  const readsByMsg = useMemo(() => {
    const m: Record<string, ReadRow[]> = {};
    for (const r of reads) {
      m[r.message_id] ??= [];
      m[r.message_id].push(r);
    }
    return m;
  }, [reads]);

  const viewers = viewersFor ? readsByMsg[viewersFor.id] || [] : [];
  const imageDraftCount = drafts.filter((d) => d.isImage).length;
  const hasOtherFile = drafts.some((d) => !d.isImage);

  return (
    <div className="min-h-screen text-white flex flex-col bg-[#070b12]">
      {/* Décor premium */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 520px at 12% -8%, rgba(212,175,55,0.14), transparent 60%), radial-gradient(900px 480px at 92% 8%, rgba(16,185,129,0.12), transparent 62%), linear-gradient(180deg,#070b12 0%,#0a1018 55%,#070b12 100%)",
        }}
      />

      <header className="sticky top-0 z-30 backdrop-blur-2xl border-b border-amber-400/10 bg-[#070b12]/80">
        <div className="max-w-2xl mx-auto px-3 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2.5 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/10 flex items-center justify-center active:scale-95 transition"
            aria-label="Retour"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="relative w-10 h-10 rounded-2xl flex items-center justify-center bg-gradient-to-br from-amber-400/90 via-amber-500 to-emerald-500 shadow-[0_8px_22px_-10px_rgba(212,175,55,0.9)]">
            <MessageCircle className="w-4.5 h-4.5 text-[#0b1220]" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-black tracking-tight leading-tight bg-gradient-to-r from-amber-200 via-amber-100 to-emerald-200 bg-clip-text text-transparent">
              J&amp;H Chats
            </h1>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {onlineIds.size} en ligne
            </p>
          </div>
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className={`w-9 h-9 rounded-2xl border flex items-center justify-center active:scale-95 transition ${
              searchOpen ? "bg-amber-500/20 border-amber-400/40 text-amber-200" : "bg-white/[0.04] border-white/10 hover:bg-white/10"
            }`}
            aria-label="Rechercher"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="w-9 h-9 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/10 flex items-center justify-center active:scale-95 transition"
            title="Historique des appels"
            aria-label="Historique des appels"
          >
            <PhoneCall className="w-4 h-4 text-emerald-300" />
          </button>
        </div>

        {searchOpen && (
          <div className="max-w-2xl mx-auto px-3 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un message..."
                className="w-full pl-9 pr-9 h-10 rounded-2xl bg-white/[0.05] border border-white/10 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center"
                  aria-label="Effacer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "190px" }}>
        <div className="max-w-2xl mx-auto px-3 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              {search.trim() ? "Aucun message ne correspond à votre recherche." : "Aucun message pour l'instant. Soyez le premier à écrire !"}
            </div>
          ) : (
            grouped.map((g) => (
              <div key={g.day} className="space-y-2.5">
                <div className="flex justify-center sticky top-1 z-10">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-amber-200/70 bg-[#0b1220]/80 backdrop-blur px-3 py-1 rounded-full border border-amber-400/15">
                    {g.day}
                  </span>
                </div>
                {g.items.map((m) => {
                  const mine = m.user_id === user?.id;
                  const p = profiles[m.user_id];
                  const online = onlineIds.has(m.user_id);
                  const reply = m.reply_to_id ? msgById[m.reply_to_id] : null;
                  const replyAuthor = reply ? profiles[reply.user_id] : null;
                  const parsed = parseMessage(m.content);
                  const allPaths = pathsOf(m);
                  const imagePaths = allPaths.filter((x) => isImagePath(x));
                  const primary = m.image_url;
                  const primaryUrl = primary ? signedUrls[primary] : null;
                  const msgReactions = reactionsByMsg[m.id] || {};
                  const msgReads = readsByMsg[m.id] || [];
                  const readCount = msgReads.filter((r) => r.user_id !== m.user_id).length;

                  return (
                    <div key={m.id} className={`flex gap-2 group ${mine ? "flex-row-reverse" : ""}`} style={{ animation: "chat-in 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
                      <div className="relative shrink-0 self-end">
                        <button
                          onClick={() => setProfileFor(m.user_id)}
                          className="w-9 h-9 rounded-full overflow-hidden bg-slate-800 ring-1 ring-amber-300/20 flex items-center justify-center shadow-lg"
                          title="Voir le profil"
                        >
                          {p?.avatar_url ? (
                            <img src={p.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                          ) : (
                            <span className="text-[11px] font-bold uppercase">{initials(displayName(p))}</span>
                          )}
                        </button>
                        {online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#070b12]" />}
                      </div>

                      <div className={`max-w-[80%] sm:max-w-[72%] flex flex-col ${mine ? "items-end" : "items-start"}`}>
                        <div className={`flex items-center gap-2 text-[11px] mb-1 px-1 ${mine ? "flex-row-reverse" : ""}`}>
                          <button
                            onClick={() => setProfileFor(m.user_id)}
                            className="font-semibold text-slate-200/90 truncate max-w-[150px] hover:underline"
                          >
                            {mine ? "Vous" : displayName(p)}
                          </button>
                          <AccountBadges userId={m.user_id} admins={admins} premium={premium} compact />
                          <span className="text-slate-500">{formatTime(m.created_at)}</span>
                        </div>

                        <div
                          className={`relative px-3 py-2.5 text-[14px] leading-relaxed break-words shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)] ${
                            mine
                              ? "rounded-[20px] rounded-br-md bg-gradient-to-br from-amber-500/90 via-amber-600/90 to-emerald-600/90 text-white border border-amber-200/25"
                              : "rounded-[20px] rounded-bl-md bg-white/[0.055] border border-white/10 text-slate-100 backdrop-blur-xl"
                          }`}
                        >
                          {reply && (
                            <div className={`mb-2 px-2.5 py-1.5 rounded-xl text-[11px] border-l-2 ${mine ? "bg-black/15 border-white/60" : "bg-black/25 border-amber-300"}`}>
                              <div className="font-semibold opacity-85 truncate">
                                {reply.user_id === user?.id ? "Vous" : displayName(replyAuthor ?? undefined)}
                              </div>
                              <div className="opacity-70 truncate">{parseMessage(reply.content).text || (reply.image_url ? "📷 Pièce jointe" : "")}</div>
                            </div>
                          )}

                          {primaryUrl && isAudioPath(primary) && (
                            <VoiceMessagePlayer src={primaryUrl} variant={mine ? "me" : "them"} cacheKey={m.id} />
                          )}

                          {imagePaths.length > 0 && (
                            <div
                              className={`mb-1.5 grid gap-1.5 ${
                                imagePaths.length === 1 ? "grid-cols-1" : imagePaths.length === 2 ? "grid-cols-2" : "grid-cols-3"
                              }`}
                            >
                              {imagePaths.map((path) => {
                                const url = signedUrls[path];
                                return (
                                  <button
                                    key={path}
                                    onClick={() => url && setLightbox(url)}
                                    className={`relative overflow-hidden rounded-xl bg-black/30 ${imagePaths.length === 1 ? "max-h-72" : "aspect-square"}`}
                                  >
                                    {url ? (
                                      <img
                                        src={url}
                                        alt="pièce jointe"
                                        className={`w-full ${imagePaths.length === 1 ? "max-h-72 object-contain" : "h-full object-cover"}`}
                                      />
                                    ) : (
                                      <span className="flex items-center justify-center w-full h-full py-8">
                                        <Loader2 className="w-4 h-4 animate-spin opacity-60" />
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {primaryUrl && isVideoPath(primary) && (
                            <video src={primaryUrl} controls playsInline className="rounded-xl max-h-72 mb-1.5 bg-black w-full" />
                          )}

                          {primaryUrl && !isAudioPath(primary) && !isImagePath(primary) && !isVideoPath(primary) && (
                            <a
                              href={primaryUrl}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className={`flex items-center gap-2 mb-1.5 px-2.5 py-2 rounded-xl border ${mine ? "bg-black/15 border-white/25" : "bg-black/25 border-white/10"}`}
                            >
                              <FileText className="w-5 h-5 shrink-0 opacity-80" />
                              <span className="flex-1 min-w-0 text-[12px] font-medium truncate">{fileNameFromPath(primary!)}</span>
                              <Download className="w-4 h-4 shrink-0 opacity-80" />
                            </a>
                          )}

                          {editingId === m.id ? (
                            <div className="space-y-1.5">
                              <textarea
                                autoFocus
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(m); }
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                rows={2}
                                className="w-full min-w-[210px] resize-none rounded-xl bg-black/35 border border-white/20 px-2.5 py-2 text-[13px] text-white focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => setEditingId(null)} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/10">Annuler</button>
                                <button
                                  onClick={() => void saveEdit(m)}
                                  disabled={savingEdit}
                                  className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50"
                                >
                                  Enregistrer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {parsed.text && !isAudioPath(primary) && <div className="whitespace-pre-wrap">{parsed.text}</div>}
                              {parsed.text && isAudioPath(primary) && <div className="text-[11px] opacity-70 mt-0.5">{parsed.text}</div>}
                              {parsed.editedAt && (
                                <button
                                  onClick={() => setOriginalFor(m)}
                                  className="mt-1 text-[10px] italic opacity-70 underline underline-offset-2"
                                  title="Voir le message original"
                                >
                                  modifié · {new Date(parsed.editedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {Object.keys(msgReactions).length > 0 && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "justify-end" : ""}`}>
                            {Object.entries(msgReactions).map(([emoji, list]) => {
                              const active = user && list.some((r) => r.user_id === user.id);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(m.id, emoji)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition ${
                                    active ? "bg-amber-400/25 border-amber-300/60 text-white" : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-semibold">{list.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className={`flex items-center gap-1 mt-1 flex-wrap opacity-80 group-hover:opacity-100 transition ${mine ? "flex-row-reverse" : ""}`}>
                          <div className="relative">
                            <button
                              onClick={() => setEmojiPickerFor(emojiPickerFor === m.id ? null : m.id)}
                              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                            >
                              <Smile className="w-3 h-3" /> Réagir
                            </button>
                            {emojiPickerFor === m.id && (
                              <div className="absolute z-40 mt-1 p-1.5 rounded-2xl bg-[#0d1520] border border-white/10 shadow-2xl flex gap-1">
                                {EMOJIS.map((e) => (
                                  <button key={e} onClick={() => toggleReaction(m.id, e)} className="w-7 h-7 rounded-lg hover:bg-white/10 text-base">
                                    {e}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button onClick={() => setReplyTo(m)} className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1">
                            <Reply className="w-3 h-3" /> Répondre
                          </button>
                          {mine && !isAudioPath(primary) && (
                            <button onClick={() => startEdit(m)} className="text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1">
                              <Pencil className="w-3 h-3" /> Modifier
                            </button>
                          )}
                          {mine ? (
                            <button onClick={() => setViewersFor(m)} className="text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1">
                              {readCount > 0 ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Check className="w-3 h-3" />}
                              Vu · {readCount}
                            </button>
                          ) : (
                            <button onClick={() => setViewersFor(m)} className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1">
                              <Eye className="w-3 h-3" /> {readCount}
                            </button>
                          )}
                          {(mine || isAdmin) && (
                            <button onClick={() => deleteMessage(m.id)} className="text-[10px] text-amber-300 hover:text-white px-2 py-0.5 rounded-full bg-amber-500/10 hover:bg-amber-500/20 inline-flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> {isAdmin && !mine ? "Admin" : "Supprimer"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {unreadCount > 0 && (
        <button onClick={() => { scrollToBottom(true); setUnreadCount(0); }} className="fixed left-1/2 -translate-x-1/2 z-40" style={{ bottom: "190px" }}>
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 text-[#0b1220] text-xs font-black shadow-xl">
            {unreadCount} nouveau{unreadCount > 1 ? "x" : ""} message{unreadCount > 1 ? "s" : ""} ↓
          </span>
        </button>
      )}

      <div
        className="fixed left-0 right-0 z-30 border-t border-amber-400/10 backdrop-blur-2xl"
        style={{ bottom: "72px", background: "linear-gradient(180deg, rgba(7,11,18,0.75), rgba(7,11,18,0.97))" }}
      >
        <div className="max-w-2xl mx-auto px-3 py-2.5 space-y-2">
          {replyTo && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white/[0.05] border border-white/10 text-xs">
              <Reply className="w-3.5 h-3.5 text-amber-300" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-200 truncate">
                  Réponse à {replyTo.user_id === user?.id ? "vous" : displayName(profiles[replyTo.user_id])}
                </div>
                <div className="text-slate-400 truncate">{parseMessage(replyTo.content).text || (replyTo.image_url ? "📷 Pièce jointe" : "")}</div>
              </div>
              <button onClick={() => setReplyTo(null)} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {drafts.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {drafts.map((d, i) => (
                <div key={`${d.file.name}-${i}`} className="relative shrink-0">
                  {d.preview ? (
                    <img src={d.preview} alt="aperçu" className="w-16 h-16 object-cover rounded-xl border border-white/15" />
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 max-w-[240px]">
                      {d.file.type.startsWith("video/") ? <Play className="w-4 h-4 text-amber-300 shrink-0" /> : <FileText className="w-4 h-4 text-amber-300 shrink-0" />}
                      <span className="text-xs text-slate-200 truncate">{d.file.name}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{(d.file.size / (1024 * 1024)).toFixed(1)} Mo</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeDraft(i)}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#0b1220] border border-white/20 flex items-center justify-center"
                    aria-label="Retirer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <span className="text-[10px] text-slate-500 shrink-0 pl-1">
                {hasOtherFile ? "1 fichier" : `${imageDraftCount}/${MAX_IMAGES} images`}
              </span>
            </div>
          )}

          <div className="flex items-end gap-2">
            {!voiceActive && (
              <>
                <label className="w-10 h-10 shrink-0 rounded-2xl bg-white/[0.05] hover:bg-white/10 border border-white/10 flex items-center justify-center cursor-pointer transition active:scale-95" title={`Envoyer jusqu'à ${MAX_IMAGES} images`}>
                  <ImagePlus className="w-4 h-4 text-amber-300" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.currentTarget.value = ""; }}
                  />
                </label>
                <label className="w-10 h-10 shrink-0 rounded-2xl bg-white/[0.05] hover:bg-white/10 border border-white/10 flex items-center justify-center cursor-pointer transition active:scale-95" title="Envoyer un fichier (1 par message)">
                  <Paperclip className="w-4 h-4 text-amber-300" />
                  <input
                    type="file"
                    accept="*/*"
                    className="hidden"
                    onChange={(e) => { addFiles(Array.from(e.target.files || []).slice(0, 1)); e.currentTarget.value = ""; }}
                  />
                </label>
                <button
                  onClick={() => user && setCallOpen(true)}
                  disabled={!user}
                  className="w-10 h-10 shrink-0 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 flex items-center justify-center transition disabled:opacity-40 active:scale-95"
                  title="Appel vocal de groupe"
                  aria-label="Appel vocal"
                >
                  <Phone className="w-4 h-4 text-emerald-300" />
                </button>
              </>
            )}
            <VoiceRecorder onSend={sendVoice} disabled={!user} onActiveChange={setVoiceActive} />
            {!voiceActive && (
              <>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  rows={1}
                  placeholder={user ? "Écrire un message..." : "Connectez-vous pour discuter"}
                  disabled={!user || sending}
                  className="flex-1 min-w-0 max-h-32 resize-none rounded-2xl bg-white/[0.06] border border-white/10 px-3.5 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || !user || (!input.trim() && drafts.length === 0)}
                  className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-emerald-500 text-[#0b1220] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition active:scale-95 shadow-[0_10px_26px_-12px_rgba(212,175,55,0.9)]"
                  aria-label="Envoyer"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Visionneuse d'image plein écran */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="pièce jointe" className="max-w-full max-h-full rounded-2xl" />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Viewers dialog */}
      <Dialog open={!!viewersFor} onOpenChange={(o) => !o && setViewersFor(null)}>
        <DialogContent className="max-w-sm bg-[#0b1220] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Eye className="w-4 h-4" /> Vu par {viewers.filter((v) => v.user_id !== viewersFor?.user_id).length}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {viewers.filter((v) => v.user_id !== viewersFor?.user_id).length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center">Aucun utilisateur n'a encore vu ce message.</p>
            )}
            {viewers
              .filter((v) => v.user_id !== viewersFor?.user_id)
              .sort((a, b) => a.read_at.localeCompare(b.read_at))
              .map((v) => {
                const p = profiles[v.user_id];
                return (
                  <div key={v.user_id} className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/5">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-800 flex items-center justify-center">
                      {p?.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-[11px] font-bold uppercase">{initials(displayName(p))}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{displayName(p)}</p>
                      <p className="text-[11px] text-slate-400">{new Date(v.read_at).toLocaleString()}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Message original (après modification) */}
      <Dialog open={!!originalFor} onOpenChange={(o) => !o && setOriginalFor(null)}>
        <DialogContent className="max-w-sm bg-[#0b1220] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <History className="w-4 h-4" /> Message original
            </DialogTitle>
          </DialogHeader>
          {originalFor && (
            <div className="space-y-2 text-sm">
              <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 whitespace-pre-wrap">
                {parseMessage(originalFor.content).original}
              </div>
              <p className="text-[11px] text-slate-400">
                Modifié le {new Date(parseMessage(originalFor.content).editedAt || originalFor.created_at).toLocaleString()}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <UserProfileDialog
        userId={profileFor}
        open={!!profileFor}
        onClose={() => setProfileFor(null)}
        viewerIsAdmin={isAdmin}
        admins={admins}
        premium={premium}
      />

      {user && (
        <CallHistoryDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          userId={user.id}
          profiles={profiles}
        />
      )}

      <BottomNav />
      <style>{`
        @keyframes chat-in {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
