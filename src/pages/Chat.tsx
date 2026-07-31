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
import { useGlobalChat, type ChatRow, type Profile } from "@/hooks/useGlobalChat";
import { buildEditedContent, parseMessage } from "@/lib/chatMeta";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
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
  WifiOff,
  ChevronDown,
} from "lucide-react";

const AUDIO_RX = /\.(webm|ogg|mp3|m4a|wav|aac|flac|opus)(\?|$)/i;
const IMAGE_RX = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)(\?|$)/i;
const VIDEO_RX = /\.(mp4|mov|webm|mkv|m4v|3gp|avi)(\?|$)/i;
const isAudioPath = (p?: string | null) => !!p && AUDIO_RX.test(p) && /voice-|\.(ogg|m4a|mp3|wav|aac|flac|opus)/i.test(p);
const isImagePath = (p?: string | null) => !!p && IMAGE_RX.test(p);
const isVideoPath = (p?: string | null) => !!p && VIDEO_RX.test(p) && !isAudioPath(p);

/** Nom d'origine encodé dans le chemin : `<uid>/<ts>-<rand>-<nom.ext>`. */
const fileNameFromPath = (p: string) => {
  const raw = decodeURIComponent(p.split("/").pop() || p);
  const stripped = raw.replace(/^\d{10,}-[a-z0-9]{4,10}-?/i, "");
  return stripped || raw;
};
const humanSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const sanitizeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-60) || "fichier";

const MAX_FILE_MB = 100;
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "🙏"];

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString();
}

export default function Chat() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { admins, premium } = useAccountBadges();

  const {
    messages,
    profiles,
    reactions,
    reads,
    onlineIds,
    signedUrls,
    loading,
    connected,
    ingest,
    onNewMessage,
  } = useGlobalChat(user?.id ?? null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatRow | null>(null);
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);
  const [viewersFor, setViewersFor] = useState<ChatRow | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [originalFor, setOriginalFor] = useState<ChatRow | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const { openPanel: openCallPanel } = useCall();
  const setCallOpen = (v: boolean) => {
    if (v) openCallPanel();
  };

  useEffect(() => {
    if (searchParams.get("call") === "1") {
      openCallPanel();
      const next = new URLSearchParams(searchParams);
      next.delete("call");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openCallPanel]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Arrivée d'un message : suivre le fil ou signaler les non-lus.
  useEffect(() => {
    onNewMessage.current = (row: ChatRow) => {
      if (row.user_id === user?.id || atBottomRef.current) {
        window.setTimeout(() => scrollToBottom(true), 40);
      } else {
        setUnreadCount((c) => c + 1);
      }
    };
    return () => {
      onNewMessage.current = null;
    };
  }, [onNewMessage, scrollToBottom, user?.id]);

  const firstPaint = useRef(true);
  useEffect(() => {
    if (!loading && firstPaint.current && messages.length > 0) {
      firstPaint.current = false;
      window.setTimeout(() => scrollToBottom(false), 60);
    }
  }, [loading, messages.length, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    setAtBottom(near);
    if (near) setUnreadCount(0);
  };

  const handleImagePick = (f: File | null) => {
    if (!f) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Fichier trop volumineux (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setImageFile(f);
    setImagePreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const send = async () => {
    if (!user || sending) return;
    const text = input.trim();
    if (!text && !imageFile) return;
    setSending(true);
    try {
      let storagePath: string | null = null;
      if (imageFile) {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${stamp}-${sanitizeName(imageFile.name)}`;
        setUploadPct(0);
        await uploadWithProgress("chat-files", path, imageFile, {
          contentType: imageFile.type || "application/octet-stream",
          onProgress: setUploadPct,
        });
        storagePath = path;
      }
      const { data, error } = await supabase
        .from("global_chat_messages")
        .insert({
          user_id: user.id,
          content: text,
          image_url: storagePath,
          reply_to_id: replyTo?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) ingest([data as ChatRow]);
      setInput("");
      setImageFile(null);
      setImagePreview(null);
      setReplyTo(null);
      window.setTimeout(() => scrollToBottom(true), 40);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg ? `Échec de l'envoi : ${msg}` : "Échec de l'envoi");
      console.error(e);
    } finally {
      setSending(false);
      setUploadPct(null);
    }
  };

  const sendVoice = async (blob: Blob, durationMs: number) => {
    if (!user) return;
    try {
      const path = `${user.id}/voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;
      setUploadPct(0);
      await uploadWithProgress("chat-files", path, blob, {
        contentType: blob.type || "audio/webm",
        onProgress: setUploadPct,
      });
      const { data, error } = await supabase
        .from("global_chat_messages")
        .insert({
          user_id: user.id,
          content: `🎤 Message vocal · ${Math.max(1, Math.round(durationMs / 1000))}s`,
          image_url: path,
          reply_to_id: replyTo?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      if (data) ingest([data as ChatRow]);
      setReplyTo(null);
      window.setTimeout(() => scrollToBottom(true), 40);
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'envoi vocal");
    } finally {
      setUploadPct(null);
    }
  };

  const deleteMessage = async (id: string) => {
    const { error } = await supabase.from("global_chat_messages").delete().eq("id", id);
    if (error) toast.error("Suppression impossible");
  };

  const startEdit = (m: ChatRow) => {
    setEditingId(m.id);
    setEditText(parseMessage(m.content).text);
  };

  const saveEdit = async (m: ChatRow) => {
    const next = editText.trim();
    const parsed = parseMessage(m.content);
    if (!next || next === parsed.text) {
      setEditingId(null);
      return;
    }
    const content = buildEditedContent(next, parsed.original ?? parsed.text);
    const { data, error } = await supabase
      .from("global_chat_messages")
      .update({ content })
      .eq("id", m.id)
      .select()
      .single();
    if (error) {
      toast.error("Modification impossible");
      return;
    }
    if (data) ingest([data as ChatRow]);
    setEditingId(null);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const existing = reactions.find(
      (r) => r.message_id === messageId && r.user_id === user.id && r.emoji === emoji,
    );
    if (existing) {
      const { error } = await supabase.from("chat_message_reactions").delete().eq("id", existing.id);
      if (error) toast.error("Impossible de retirer la réaction");
    } else {
      const { error } = await supabase
        .from("chat_message_reactions")
        .insert({ message_id: messageId, user_id: user.id, emoji });
      if (error) toast.error("Impossible d'ajouter la réaction");
    }
    setEmojiPickerFor(null);
  };

  /* --------------------------- Dérivés d'affichage --------------------------- */

  const filtered = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(
      (m) =>
        parseMessage(m.content).text.toLowerCase().includes(q) ||
        (m.image_url ? fileNameFromPath(m.image_url).toLowerCase().includes(q) : false),
    );
  }, [messages, search]);

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
    const m: Record<string, Record<string, typeof reactions>> = {};
    for (const r of reactions) {
      m[r.message_id] ??= {};
      m[r.message_id][r.emoji] ??= [];
      m[r.message_id][r.emoji].push(r);
    }
    return m;
  }, [reactions]);

  const readsByMsg = useMemo(() => {
    const m: Record<string, typeof reads> = {};
    for (const r of reads) {
      m[r.message_id] ??= [];
      m[r.message_id].push(r);
    }
    return m;
  }, [reads]);

  const viewers = viewersFor ? readsByMsg[viewersFor.id] || [] : [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col">
      <header
        className="sticky top-0 z-30 backdrop-blur-xl border-b border-white/10"
        style={{ background: "linear-gradient(180deg, rgba(15,23,42,0.9), rgba(15,23,42,0.75))" }}
      >
        <div className="max-w-2xl mx-auto px-3 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"
            aria-label="Retour"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-emerald-500 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold leading-tight">J&amp;H Chats</h1>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              {connected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Temps réel · {onlineIds.size} en ligne
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-amber-400" /> Reconnexion…
                </>
              )}
              <span className="text-slate-600">·</span>
              <span>{messages.length} messages</span>
            </p>
          </div>
          <button
            onClick={() => setHistoryOpen(true)}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"
            title="Historique des appels"
            aria-label="Historique des appels"
          >
            <PhoneCall className="w-4 h-4 text-emerald-300" />
          </button>
        </div>

        <div className="max-w-2xl mx-auto px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un message ou un fichier..."
              className="w-full pl-9 pr-3 h-9 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto" style={{ paddingBottom: "180px" }}>
        <div className="max-w-2xl mx-auto px-3 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              {search.trim()
                ? "Aucun message ne correspond à votre recherche."
                : "Aucun message pour l'instant. Soyez le premier à écrire !"}
            </div>
          ) : (
            grouped.map((g) => (
              <div key={g.day} className="space-y-2">
                <div className="flex justify-center">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 bg-white/5 px-3 py-1 rounded-full">
                    {g.day}
                  </span>
                </div>
                {g.items.map((m) => {
                  const mine = m.user_id === user?.id;
                  const p = profiles[m.user_id];
                  const online = onlineIds.has(m.user_id);
                  const reply = m.reply_to_id ? msgById[m.reply_to_id] : null;
                  const replyAuthor = reply ? profiles[reply.user_id] : null;
                  const imgUrl = m.image_url ? signedUrls[m.image_url] : null;
                  const msgReactions = reactionsByMsg[m.id] || {};
                  const msgReads = readsByMsg[m.id] || [];
                  const readCount = msgReads.filter((r) => r.user_id !== m.user_id).length;
                  const parsed = parseMessage(m.content);
                  const pendingAttachment = !!m.image_url && !imgUrl;

                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2 group ${mine ? "flex-row-reverse" : ""}`}
                      style={{ animation: "chat-in 0.25s ease-out" }}
                    >
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setProfileFor(m.user_id)}
                          className="w-8 h-8 rounded-full overflow-hidden bg-slate-800 ring-1 ring-white/10 flex items-center justify-center"
                          title="Voir le profil"
                        >
                          {p?.avatar_url ? (
                            <img
                              src={p.avatar_url}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                            />
                          ) : (
                            <span className="text-[11px] font-bold uppercase">{initials(displayName(p))}</span>
                          )}
                        </button>
                        {online && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
                        )}
                      </div>
                      <div className={`max-w-[78%] flex flex-col ${mine ? "items-end" : "items-start"}`}>
                        <div className={`flex items-center gap-2 text-[11px] mb-1 ${mine ? "flex-row-reverse" : ""}`}>
                          <button
                            onClick={() => setProfileFor(m.user_id)}
                            className="font-semibold text-slate-200 truncate max-w-[150px] hover:underline"
                          >
                            {mine ? "Vous" : displayName(p)}
                          </button>
                          <AccountBadges userId={m.user_id} admins={admins} premium={premium} compact />
                          <span className="text-slate-500">{formatTime(m.created_at)}</span>
                        </div>

                        <div
                          className={`relative px-3 py-2 rounded-2xl text-[14px] leading-snug break-words shadow ${
                            mine
                              ? "bg-gradient-to-br from-amber-600 to-emerald-600 text-white rounded-tr-sm"
                              : "bg-white/[0.06] border border-white/10 text-slate-100 rounded-tl-sm"
                          }`}
                        >
                          {reply && (
                            <div
                              className={`mb-1.5 px-2 py-1 rounded-lg text-[11px] border-l-2 ${
                                mine ? "bg-white/10 border-white/40" : "bg-black/20 border-amber-400"
                              }`}
                            >
                              <div className="font-semibold opacity-80 truncate">
                                {reply.user_id === user?.id ? "Vous" : displayName(replyAuthor ?? undefined)}
                              </div>
                              <div className="opacity-70 truncate">
                                {parseMessage(reply.content).text || (reply.image_url ? "📎 Pièce jointe" : "")}
                              </div>
                            </div>
                          )}

                          {pendingAttachment && (
                            <div className="flex items-center gap-2 mb-1 px-2.5 py-2 rounded-xl bg-black/20 border border-white/10 text-[12px]">
                              <Loader2 className="w-4 h-4 animate-spin opacity-80" />
                              Chargement de la pièce jointe…
                            </div>
                          )}
                          {imgUrl && isAudioPath(m.image_url) && (
                            <VoiceMessagePlayer src={imgUrl} variant={mine ? "me" : "them"} cacheKey={m.id} />
                          )}
                          {imgUrl && isImagePath(m.image_url) && (
                            <a href={imgUrl} target="_blank" rel="noreferrer" className="block mb-1">
                              <img
                                src={imgUrl}
                                alt="pièce jointe"
                                loading="lazy"
                                className="rounded-xl max-h-64 object-cover"
                              />
                            </a>
                          )}
                          {imgUrl && isVideoPath(m.image_url) && (
                            <video
                              src={imgUrl}
                              controls
                              playsInline
                              preload="metadata"
                              className="rounded-xl max-h-64 mb-1 bg-black"
                            />
                          )}
                          {imgUrl &&
                            !isAudioPath(m.image_url) &&
                            !isImagePath(m.image_url) &&
                            !isVideoPath(m.image_url) && (
                              <a
                                href={imgUrl}
                                target="_blank"
                                rel="noreferrer"
                                download={fileNameFromPath(m.image_url!)}
                                className={`flex items-center gap-2 mb-1 px-2.5 py-2 rounded-xl border ${
                                  mine ? "bg-white/15 border-white/25" : "bg-black/20 border-white/10"
                                }`}
                              >
                                <FileText className="w-5 h-5 shrink-0 opacity-80" />
                                <span className="flex-1 min-w-0 text-[12px] font-medium truncate">
                                  {fileNameFromPath(m.image_url!)}
                                </span>
                                <Download className="w-4 h-4 shrink-0 opacity-80" />
                              </a>
                            )}

                          {editingId === m.id ? (
                            <div className="space-y-1.5">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={2}
                                className="w-full min-w-[200px] resize-none rounded-xl bg-black/30 border border-white/20 px-2 py-1.5 text-[13px] text-white focus:outline-none"
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="text-[11px] px-2 py-1 rounded-lg bg-white/10"
                                >
                                  Annuler
                                </button>
                                <button
                                  onClick={() => saveEdit(m)}
                                  className="text-[11px] px-2 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                                >
                                  Enregistrer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {parsed.text && !isAudioPath(m.image_url) && (
                                <div className="whitespace-pre-wrap">{parsed.text}</div>
                              )}
                              {parsed.text && isAudioPath(m.image_url) && (
                                <div className="text-[11px] opacity-70 mt-0.5">{parsed.text}</div>
                              )}
                              {parsed.editedAt && (
                                <button
                                  onClick={() => setOriginalFor(m)}
                                  className="mt-1 text-[10px] italic opacity-70 underline underline-offset-2"
                                  title="Voir le message original"
                                >
                                  modifié · {new Date(parsed.editedAt).toLocaleString()}
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
                                    active
                                      ? "bg-amber-500/30 border-amber-400/60 text-white"
                                      : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span className="font-semibold">{list.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className={`flex items-center gap-1 mt-1 flex-wrap ${mine ? "flex-row-reverse" : ""}`}>
                          <div className="relative">
                            <button
                              onClick={() => setEmojiPickerFor(emojiPickerFor === m.id ? null : m.id)}
                              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                            >
                              <Smile className="w-3 h-3" /> Réagir
                            </button>
                            {emojiPickerFor === m.id && (
                              <div className="absolute z-40 mt-1 p-1.5 rounded-xl bg-slate-800 border border-white/10 shadow-xl flex gap-1">
                                {EMOJIS.map((e) => (
                                  <button
                                    key={e}
                                    onClick={() => toggleReaction(m.id, e)}
                                    className="w-7 h-7 rounded-lg hover:bg-white/10 text-base"
                                  >
                                    {e}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => setReplyTo(m)}
                            className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                          >
                            <Reply className="w-3 h-3" /> Répondre
                          </button>
                          {mine && !isAudioPath(m.image_url) && (
                            <button
                              onClick={() => startEdit(m)}
                              className="text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3 h-3" /> Modifier
                            </button>
                          )}
                          {mine && (
                            <button
                              onClick={() => setViewersFor(m)}
                              className="text-[10px] text-slate-300 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                            >
                              {readCount > 0 ? (
                                <CheckCheck className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Vu · {readCount}
                            </button>
                          )}
                          {!mine && (
                            <button
                              onClick={() => setViewersFor(m)}
                              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" /> {readCount}
                            </button>
                          )}
                          {(mine || isAdmin) && (
                            <button
                              onClick={() => deleteMessage(m.id)}
                              className="text-[10px] text-amber-300 hover:text-white px-2 py-0.5 rounded-full bg-amber-500/10 hover:bg-amber-500/20 inline-flex items-center gap-1"
                            >
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

      {(unreadCount > 0 || !atBottom) && (
        <button
          onClick={() => {
            scrollToBottom(true);
            setUnreadCount(0);
          }}
          className="fixed left-1/2 -translate-x-1/2 z-40"
          style={{ bottom: "180px" }}
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-600 text-white text-xs font-semibold shadow-lg">
            {unreadCount > 0
              ? `${unreadCount} nouveau${unreadCount > 1 ? "x" : ""} message${unreadCount > 1 ? "s" : ""}`
              : "Revenir en bas"}
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
        </button>
      )}

      <div
        className="fixed left-0 right-0 z-30 border-t border-white/10 backdrop-blur-xl"
        style={{ bottom: "72px", background: "linear-gradient(180deg, rgba(15,23,42,0.85), rgba(15,23,42,0.98))" }}
      >
        <div className="max-w-2xl mx-auto px-3 py-2.5 space-y-2">
          {replyTo && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs">
              <Reply className="w-3.5 h-3.5 text-amber-300" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-200 truncate">
                  Réponse à {replyTo.user_id === user?.id ? "vous" : displayName(profiles[replyTo.user_id])}
                </div>
                <div className="text-slate-400 truncate">
                  {parseMessage(replyTo.content).text || (replyTo.image_url ? "📎 Pièce jointe" : "")}
                </div>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {imageFile && (
            <div className="flex items-center gap-2">
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="aperçu" className="max-h-24 rounded-xl border border-white/10" />
                  <button
                    onClick={() => handleImagePick(null)}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="relative inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 pr-8 max-w-full">
                  {imageFile.type.startsWith("video/") ? (
                    <Play className="w-4 h-4 text-amber-300 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-amber-300 shrink-0" />
                  )}
                  <span className="text-xs text-slate-200 truncate max-w-[220px]">{imageFile.name}</span>
                  <span className="text-[10px] text-slate-500">{humanSize(imageFile.size)}</span>
                  <button
                    onClick={() => handleImagePick(null)}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
          {uploadPct !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span className="truncate">Envoi du fichier…</span>
                <span className="font-semibold text-amber-300 tabular-nums">{uploadPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-end gap-2">
            {!voiceActive && (
              <>
                <label
                  className="w-10 h-10 shrink-0 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center cursor-pointer transition"
                  title="Envoyer une image ou une vidéo"
                >
                  <ImagePlus className="w-4 h-4 text-amber-300" />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      handleImagePick(e.target.files?.[0] || null);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <label
                  className="w-10 h-10 shrink-0 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center cursor-pointer transition"
                  title="Envoyer un fichier (PDF, APK, musique, archive…)"
                >
                  <Paperclip className="w-4 h-4 text-amber-300" />
                  <input
                    type="file"
                    accept="*/*"
                    className="hidden"
                    onChange={(e) => {
                      handleImagePick(e.target.files?.[0] || null);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={() => user && setCallOpen(true)}
                  disabled={!user}
                  className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/20 hover:from-emerald-500/30 hover:to-emerald-500/30 border border-emerald-400/30 flex items-center justify-center transition disabled:opacity-40 active:scale-95"
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={user ? "Écrire un message..." : "Connectez-vous pour discuter"}
                  disabled={!user || sending}
                  className="flex-1 min-w-0 max-h-32 resize-none rounded-2xl bg-white/[0.06] border border-white/10 px-3 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
                <button
                  onClick={send}
                  disabled={sending || !user || (!input.trim() && !imageFile)}
                  className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-amber-600 to-emerald-600 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition"
                  aria-label="Envoyer"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Viewers dialog */}
      <Dialog open={!!viewersFor} onOpenChange={(o) => !o && setViewersFor(null)}>
        <DialogContent className="max-w-sm bg-slate-900 border-white/10 text-white">
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
                  <div key={v.user_id} className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5">
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
        <DialogContent className="max-w-sm bg-slate-900 border-white/10 text-white">
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
                Modifié le{" "}
                {new Date(parseMessage(originalFor.content).editedAt || originalFor.created_at).toLocaleString()}
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
        <CallHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} userId={user.id} profiles={profiles} />
      )}

      {/* Global VoiceCallPanel is rendered by GlobalCallRoot to persist across navigation */}

      <BottomNav />
      <style>{`
        @keyframes chat-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
