//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

export const PLATFORM_DEFS = {
  replay: {
    key: "replay",
    label: "Replay",
    accentColor: "#64748b",
    surfaceColor: "#0f172a"
  },
  twitch: {
    key: "twitch",
    label: "Twitch",
    accentColor: "#9146ff",
    surfaceColor: "#23103f"
  },
  youtube: {
    key: "youtube",
    label: "YouTube",
    accentColor: "#ff3131",
    surfaceColor: "#3d0d0d"
  },
  kick: {
    key: "kick",
    label: "Kick",
    accentColor: "#53fc18",
    surfaceColor: "#13300b"
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    accentColor: "#ff0050",
    surfaceColor: "#3a0b1f"
  }
};

export const PLATFORM_KEYS = Object.keys(PLATFORM_DEFS);

export function getPlatformDef(source) {
  return PLATFORM_DEFS[source] || {
    key: source || "unknown",
    label: source || "Unknown",
    accentColor: "#94a3b8",
    surfaceColor: "#1e293b"
  };
}

export function buildConnectionId({ source, channel, streamId }) {
  const sourcePart = source || "unknown";
  const channelPart = channel || "default";
  const streamPart = streamId || "session";
  return `${sourcePart}:${channelPart}:${streamPart}`;
}
