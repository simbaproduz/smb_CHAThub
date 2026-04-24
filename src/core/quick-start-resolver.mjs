//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

function ensureUrl(value) {
  if (!value || String(value).trim().length === 0) {
    throw new Error("Informe uma URL valida para resolver.");
  }

  try {
    return new URL(String(value).trim());
  } catch {
    throw new Error("Nao consegui interpretar essa URL.");
  }
}

function parseYouTubeAuthor(payload) {
  const authorName = payload.author_name || "";
  const authorUrl = payload.author_url || "";
  let channel = authorName;
  let channelId = "";

  if (!authorUrl) {
    return {
      channel,
      channel_id: channelId,
      display_label: authorName || payload.title || "YouTube"
    };
  }

  const url = new URL(authorUrl);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0]?.startsWith("@")) {
    channel = segments[0];
  } else if (segments[0] === "channel" && segments[1]) {
    channelId = segments[1];
    channel = authorName || segments[1];
  } else if ((segments[0] === "user" || segments[0] === "c") && segments[1]) {
    channel = authorName || segments[1];
  }

  return {
    channel,
    channel_id: channelId,
    display_label: channel || authorName || payload.title || "YouTube"
  };
}

export async function resolveQuickStartInput(rawInput) {
  const url = ensureUrl(rawInput);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (!host.includes("youtube.com") && !host.includes("youtu.be")) {
    return null;
  }

  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`);
  if (!response.ok) {
    throw new Error("Nao consegui resolver os metadados publicos dessa live do YouTube.");
  }

  const payload = await response.json();
  return {
    provider_key: "youtube",
    ...parseYouTubeAuthor(payload),
    title: payload.title || "",
    author_name: payload.author_name || "",
    author_url: payload.author_url || ""
  };
}
