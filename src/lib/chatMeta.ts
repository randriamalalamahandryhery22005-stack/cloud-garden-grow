// Métadonnées d'édition et de pièces jointes des messages du chat global.
// Le contenu modifié embarque le message d'origine et l'horodatage de la
// modification dans un bloc invisible, afin de rester compatible avec le
// schéma existant de `global_chat_messages`.
// Les pièces jointes supplémentaires (jusqu'à 5 images par message) sont
// stockées de la même manière : la première reste dans `image_url`.

const MARK = "\u2063#JHEDIT:";
const ATT_MARK = "\u2063#JHATT:";

export type ParsedMessage = {
  text: string;
  original: string | null;
  editedAt: string | null;
  /** Pièces jointes additionnelles (au-delà de `image_url`). */
  attachments: string[];
};

const encode = (value: unknown) => {
  const json = JSON.stringify(value);
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  } catch {
    return encodeURIComponent(json);
  }
};

const decode = <T,>(raw: string): T | null => {
  try {
    const bin = atob(raw);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    try {
      return JSON.parse(decodeURIComponent(raw)) as T;
    } catch {
      return null;
    }
  }
};

/** Ajoute (ou remplace) le bloc de pièces jointes additionnelles. */
export function withAttachments(content: string, attachments: string[]) {
  const base = content.split(ATT_MARK)[0];
  if (!attachments.length) return base;
  return `${base}${ATT_MARK}${encode(attachments)}`;
}

/** Construit le contenu à enregistrer pour un message modifié. */
export function buildEditedContent(newText: string, original: string, editedAt = new Date().toISOString()) {
  return `${newText}${MARK}${encode({ o: original, t: editedAt })}`;
}

/** Sépare le texte affichable des métadonnées (édition + pièces jointes). */
export function parseMessage(content: string | null | undefined): ParsedMessage {
  let raw = content ?? "";
  let attachments: string[] = [];

  const attIdx = raw.indexOf(ATT_MARK);
  if (attIdx !== -1) {
    const list = decode<string[]>(raw.slice(attIdx + ATT_MARK.length));
    attachments = Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
    raw = raw.slice(0, attIdx);
  }

  const idx = raw.indexOf(MARK);
  if (idx === -1) return { text: raw, original: null, editedAt: null, attachments };
  const text = raw.slice(0, idx);
  const meta = decode<{ o?: string; t?: string }>(raw.slice(idx + MARK.length));
  return { text, original: meta?.o ?? null, editedAt: meta?.t ?? null, attachments };
}

/** Texte brut affichable (sans métadonnées). */
export const plainText = (content: string | null | undefined) => parseMessage(content).text;
