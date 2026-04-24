//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeImageSrc(value = "") {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) {
    return "";
  }
  if (rawUrl.startsWith("//")) {
    return `https:${rawUrl}`;
  }
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  return "";
}

function buildKickEmoteUrl(id = "") {
  const safeId = String(id || "").trim();
  if (!/^\d+$/.test(safeId)) {
    return "";
  }
  return `https://files.kick.com/emotes/${safeId}/fullsize`;
}

function normalizeShortcodeLabel(value = "", id = "") {
  const label = String(value || "").replace(/^:+|:+$/g, "").trim();
  return label || (id ? `emote ${id}` : "emote");
}

function splitKnownEmoteShortcodes(value = "") {
  const text = String(value ?? "");
  if (!text) {
    return [];
  }

  const pattern = /\[emote:(\d+):([^\]\r\n]+)\]|\[emotes?(\d+)\]/gi;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, match.index) });
    }

    const id = match[1] || match[3] || "";
    const alt = normalizeShortcodeLabel(match[2] || "", id);
    const src = buildKickEmoteUrl(id);
    if (src) {
      parts.push({
        type: "emote",
        value: alt,
        alt,
        provider: "kick",
        id,
        src
      });
    } else {
      parts.push({ type: "text", value: match[0] });
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function splitTikTokShortcodes(value = "") {
  const text = String(value ?? "");
  if (!text) {
    return [];
  }

  const pattern = /\[([A-Za-z][A-Za-z0-9_-]{1,48})\]/g;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, match.index) });
    }

    const alt = match[1].trim();
    parts.push({
      type: "emote",
      value: alt,
      alt,
      provider: "tiktok",
      src: ""
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function splitTextEmoteShortcodes(value = "", options = {}) {
  const kickParts = splitKnownEmoteShortcodes(value);
  if (options.source !== "tiktok" && !options.parseTikTokShortcodes) {
    return kickParts;
  }

  return kickParts.flatMap((part) => (
    part.type === "text" ? splitTikTokShortcodes(part.value) : [part]
  ));
}

export function normalizeMessageParts(parts = [], fallbackText = "", options = {}) {
  const sourceParts = Array.isArray(parts) && parts.length > 0
    ? parts
    : fallbackText
      ? [{ type: "text", value: fallbackText }]
      : [];
  const normalized = [];

  for (const part of sourceParts) {
    const type = part?.type === "emote" ? "emote" : part?.type === "link" ? "link" : "text";
    const value = String(part?.value ?? part?.alt ?? "");

    if (type === "text") {
      normalized.push(...splitTextEmoteShortcodes(value, options));
      continue;
    }

    normalized.push({
      type,
      value,
      alt: String(part?.alt ?? part?.value ?? ""),
      src: normalizeImageSrc(part?.src),
      provider: String(part?.provider ?? ""),
      id: String(part?.id ?? "")
    });
  }

  return normalized.filter((part) => part.value || part.src);
}

export function messagePartsToPlainText(parts = [], fallbackText = "") {
  return normalizeMessageParts(parts, fallbackText)
    .map((part) => part.value || part.alt)
    .join("");
}

export function messagePartsToHtml(parts = [], fallbackText = "", options = {}) {
  const className = options.emoteClassName || "message-emote";
  return normalizeMessageParts(parts, fallbackText, options).map((part) => {
    if (part.type === "emote") {
      if (part.src) {
        const alt = part.alt || part.value || "emote";
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(part.src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" loading="lazy" decoding="async" data-emote-fallback="${escapeHtml(alt)}">`;
      }
      return `<span class="message-emote-fallback">${escapeHtml(part.value || part.alt)}</span>`;
    }

    return escapeHtml(part.value);
  }).join("");
}

export function renderMessageParts(container, parts = [], fallbackText = "", options = {}) {
  if (!container) {
    return;
  }

  container.innerHTML = messagePartsToHtml(parts, fallbackText, options);
}

export function installMessagePartImageFallback(root = document) {
  root.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.emoteFallback) {
      return;
    }

    const fallback = document.createElement("span");
    fallback.className = "message-emote-fallback";
    fallback.textContent = image.dataset.emoteFallback;
    image.replaceWith(fallback);
  }, true);
}
