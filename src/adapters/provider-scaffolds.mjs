//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { getPlatformDef } from "../core/platforms.mjs";

const PROVIDER_REQUIREMENTS = {
  twitch: [
    { key: "channel", label: "canal" },
    { key: "broadcaster_user_id", label: "broadcaster_user_id" },
    { key: "client_id", label: "client_id" },
    { key: "client_secret", label: "client_secret" },
    { key: "redirect_uri", label: "redirect_uri" },
    { key: "access_token", label: "access_token" }
  ],
  youtube: [
    { key: "quick_input", label: "link da live" },
    { key: "channel", label: "canal" },
    { key: "channel_id", label: "channel_id" },
    { key: "api_key", label: "api_key" },
    { key: "access_token", label: "access_token" }
  ],
  kick: [
    { key: "channel", label: "canal" },
    { key: "broadcaster_user_id", label: "broadcaster_user_id" },
    { key: "client_id", label: "client_id" },
    { key: "client_secret", label: "client_secret" },
    { key: "access_token", label: "access_token" },
    { key: "webhook_public_url", label: "webhook_public_url" }
  ],
  tiktok: [
    { key: "unique_id", label: "@handle" }
  ]
};

const PROVIDER_PRODUCT = {
  twitch: {
    recommended_method: "compatibility",
    official_status: "preview",
    support_label: "Melhor caminho funcional hoje: Compatibilidade com chat real. Login Twitch oficial fica como preview/bootstrap na v1."
  },
  youtube: {
    recommended_method: "compatibility",
    official_status: "available",
    support_label: "Melhor caminho funcional hoje: compatibilidade real por URL, live, @handle ou channel ID. O oficial fica como fallback avancado."
  },
  kick: {
    recommended_method: "compatibility",
    official_status: "preparing",
    support_label: "Melhor caminho hoje: compatibilidade real por canal publico. Fluxo oficial ainda depende de preparo extra."
  },
  tiktok: {
    recommended_method: "compatibility",
    official_status: "available",
    support_label: "Melhor caminho hoje: leitura real minima por @handle ou URL da live, usando conector local read-only."
  }
};

const METHOD_LABELS = {
  official: "Oficial",
  compatibility: "Compatibilidade",
  advanced: "Avancado",
  quick_start: "Quick start"
};

const HUMAN_STATUS_LABELS = {
  not_configured: "Nao configurado",
  disconnected: "Desconectado",
  missing_credentials: "Falta credencial",
  missing_target: "Falta alvo",
  compatibility_active: "Compatibilidade configurada",
  official_connected: "Login oficial salvo",
  in_preparation: "Em preparacao",
  official_ready: "Fallback oficial pronto"
};

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function getCompatibilityTarget(providerKey, config) {
  if (providerKey === "youtube") {
    return config.channel || config.channel_id || config.quick_input || "";
  }

  if (providerKey === "tiktok") {
    return config.unique_id || config.channel || config.quick_input || "";
  }

  return config.channel || config.broadcaster_user_id || config.quick_input || "";
}

function hasCompatibilityConfig(providerKey, config) {
  return hasValue(getCompatibilityTarget(providerKey, config));
}

function hasAdvancedConfig(providerKey, config) {
  if (providerKey === "twitch") {
    const hasAppCredentials = ["client_id", "client_secret"].some((key) => hasValue(config[key]));
    const hasCustomRedirect = hasValue(config.redirect_uri)
      && config.redirect_uri !== "http://localhost:4310/auth/twitch/callback";
    return hasAppCredentials || hasCustomRedirect;
  }

  if (providerKey === "youtube") {
    return ["api_key", "access_token", "client_id", "client_secret", "channel_id"].some((key) => hasValue(config[key]));
  }

  if (providerKey === "kick") {
    return ["client_id", "client_secret", "webhook_public_url"].some((key) => hasValue(config[key]));
  }

  if (providerKey === "tiktok") {
    return false;
  }

  return false;
}

function hasYouTubeOfficialConfig(config) {
  return hasValue(config.api_key) || hasValue(config.access_token);
}

function hasYouTubeQuickStartConfig(config) {
  return hasValue(config.quick_input) || hasValue(config.channel) || hasValue(config.channel_id);
}

function inferSetupMode(providerKey, config) {
  if (providerKey === "youtube") {
    if (config.setup_mode === "official" && hasYouTubeOfficialConfig(config)) {
      return "official";
    }

    if (config.setup_mode === "compatibility" && hasYouTubeQuickStartConfig(config)) {
      return "compatibility";
    }

    if (hasYouTubeQuickStartConfig(config)) {
      return "compatibility";
    }

    if (hasYouTubeOfficialConfig(config)) {
      return "official";
    }

    if (hasAdvancedConfig(providerKey, config)) {
      return "advanced";
    }

    return "";
  }

  const compatibilityIsActive = hasCompatibilityConfig(providerKey, config)
    && (Boolean(config.enabled) || hasValue(config.quick_input));

  if (providerKey === "twitch" && config.auth_status === "authenticated") {
    return "official";
  }

  if (config.setup_mode === "official") {
    return "official";
  }

  if (config.setup_mode === "compatibility" && compatibilityIsActive) {
    return "compatibility";
  }

  if (compatibilityIsActive) {
    return "compatibility";
  }

  if (config.setup_mode === "advanced" && hasAdvancedConfig(providerKey, config)) {
    return "advanced";
  }

  if (hasAdvancedConfig(providerKey, config)) {
    return "advanced";
  }

  return "";
}

function getHumanStatus(providerKey, config, setupMode) {
  if (providerKey === "youtube") {
    if (setupMode === "official" && config.enabled && hasYouTubeOfficialConfig(config) && hasYouTubeQuickStartConfig(config)) {
      return "official_ready";
    }

    if (setupMode === "compatibility" && config.enabled && hasYouTubeQuickStartConfig(config)) {
      return "compatibility_active";
    }

    if (setupMode === "advanced" && hasAdvancedConfig(providerKey, config)) {
      return "in_preparation";
    }

    return "not_configured";
  }

  if (providerKey === "twitch" && config.auth_status === "authenticated") {
    return "official_connected";
  }

  if (setupMode === "compatibility" && config.enabled && hasCompatibilityConfig(providerKey, config)) {
    return "compatibility_active";
  }

  if (setupMode === "advanced" && providerKey !== "twitch" && hasAdvancedConfig(providerKey, config)) {
    return "in_preparation";
  }

  return "not_configured";
}

function getMethodKey(providerKey, config, setupMode) {
  if (providerKey === "youtube") {
    if (setupMode === "official" && hasYouTubeOfficialConfig(config)) {
      return "official";
    }

    if (setupMode === "compatibility" && hasYouTubeQuickStartConfig(config)) {
      return "compatibility";
    }

    if (setupMode === "advanced" && hasAdvancedConfig(providerKey, config)) {
      return "advanced";
    }

    return PROVIDER_PRODUCT.youtube.recommended_method;
  }

  if (providerKey === "twitch" && config.auth_status === "authenticated") {
    return "official";
  }

  if (setupMode === "compatibility" && hasCompatibilityConfig(providerKey, config)) {
    return "compatibility";
  }

  if (setupMode === "advanced" && hasAdvancedConfig(providerKey, config)) {
    return "advanced";
  }

  return PROVIDER_PRODUCT[providerKey]?.recommended_method || "compatibility";
}

function getTargetLabel(providerKey, config, setupMode) {
  if (providerKey === "twitch" && config.display_name) {
    return `Conta ${config.display_name} @${config.login_name || config.channel}`;
  }

  if (providerKey === "tiktok") {
    const uniqueId = config.unique_id || config.channel || "";
    if (hasValue(uniqueId)) {
      return `@${String(uniqueId).replace(/^@/, "")}`;
    }
  }

  if (hasValue(config.channel)) {
    if (providerKey === "youtube" && String(config.channel).startsWith("@")) {
      return `Canal ${config.channel}`;
    }
    return `Canal ${config.channel}`;
  }

  if (providerKey === "youtube" && hasValue(config.channel_id)) {
    return `Channel ID ${config.channel_id}`;
  }

  if (providerKey === "kick" && hasValue(config.broadcaster_user_id)) {
    return `Broadcaster ${config.broadcaster_user_id}`;
  }

  if (setupMode === "compatibility" && hasValue(config.quick_input)) {
    return "Link salvo";
  }

  if (hasValue(config.quick_input)) {
    return "Link salvo";
  }

  return "Nada conectado ainda.";
}

function getNotes(providerKey, config, setupMode, humanStatus) {
  if (providerKey === "twitch" && humanStatus === "official_connected") {
    return [
      "OAuth local concluido para a conta configurada.",
      "O login oficial esta salvo, mas a ingestao real do monitor ainda usa o caminho de compatibilidade."
    ];
  }

  if (humanStatus === "compatibility_active") {
    if (providerKey === "twitch") {
      return [
        "Entrada salva em modo compatibilidade.",
        "Neste build, esse caminho ja liga ingestao real de chat Twitch ao vivo."
      ];
    }

    if (providerKey === "youtube") {
      return [
        "Entrada salva em modo compatibilidade.",
        "Esse e o caminho principal do produto para live publica do YouTube sem credencial obrigatoria.",
        "Se a live for restrita, offline ou vier sem chat, o monitor mostra isso com clareza.",
        hasValue(config.api_key) || hasValue(config.access_token)
          ? "Credencial oficial local pode entrar como fallback avancado."
          : "O fallback oficial fica disponivel so se o usuario salvar API key ou access token local."
      ];
    }

    return [
      "Entrada salva em modo compatibilidade.",
      providerKey === "kick"
        ? "Neste build, esse caminho liga o adapter real minimo da Kick por chat publico."
        : providerKey === "tiktok"
          ? "Neste build, esse caminho tenta ligar a leitura real do TikTok por @handle ou URL da live."
          : "Hoje isso ainda nao liga ingestao real de chat; apenas prepara o alvo de configuracao."
    ];
  }

  if (providerKey === "youtube" && humanStatus === "official_ready") {
    return [
      "Integracao oficial local ja foi configurada.",
      "Esse caminho fica como fallback avancado quando a compatibilidade nao for suficiente.",
      "Credenciais do YouTube ficam no arquivo local privado do usuario, nunca no repositorio."
    ];
  }

  if (setupMode === "advanced" && providerKey !== "twitch") {
    if (providerKey === "youtube") {
      return [
        "Campos avancados ja foram preenchidos.",
        "Use esta camada so para channel ID, credenciais alternativas ou troubleshooting."
      ];
    }

    return [
      "Campos avancados ja foram preenchidos.",
      "O fluxo oficial completo desta plataforma ainda esta em preparacao."
    ];
  }

  if (providerKey === "twitch") {
    return [
      "Hoje o caminho realmente funcional da Twitch e URL ou canal.",
      "O login oficial ainda existe, mas segue como bootstrap e nao como adapter real do monitor."
    ];
  }

  if (providerKey === "youtube") {
    return [
      "Modo principal: compatibilidade real por live URL, channel URL, @handle ou channel ID.",
      "Modo avancado: fallback oficial com API key ou access token local do proprio usuario."
    ];
  }

  if (providerKey === "kick") {
    return [
      "Use URL ou nome do canal para onboarding rapido.",
      "O caminho de compatibilidade agora resolve o canal publico e conecta o chat Kick pelo runtime."
    ];
  }

  if (providerKey === "tiktok") {
    return [
      "Use URL da live ou @handle para onboarding rapido.",
      "O caminho de compatibilidade tenta leitura read-only do chat TikTok pelo conector local do runtime."
    ];
  }

  return [];
}

export function getProviderSummary(providerKey, config = {}) {
  const platform = getPlatformDef(providerKey);
  const requirements = PROVIDER_REQUIREMENTS[providerKey] || [];
  const missing = requirements.filter((item) => !hasValue(config[item.key]));
  const setupMode = inferSetupMode(providerKey, config);
  const humanStatusKey = getHumanStatus(providerKey, config, setupMode);
  const methodKey = getMethodKey(providerKey, config, setupMode);

  let readiness = "disabled";
  if (providerKey === "youtube" && config.enabled) {
    if (setupMode === "compatibility") {
      readiness = "configured";
    } else if (setupMode === "official") {
      readiness = hasYouTubeOfficialConfig(config) && hasYouTubeQuickStartConfig(config)
        ? "configured"
        : "needs_config";
    } else if (setupMode === "advanced") {
      readiness = "needs_config";
    } else {
      readiness = "configured";
    }
  } else if (providerKey === "tiktok" && config.enabled) {
    readiness = setupMode === "compatibility" ? "configured" : "needs_config";
  } else if (config.enabled) {
    readiness = setupMode === "compatibility"
      ? "configured"
      : missing.length === 0
        ? "configured"
        : "needs_config";
  }
  if (config.auth_status === "authenticated" && providerKey === "twitch") {
    readiness = "authenticated";
  }

  return {
    provider: providerKey,
    label: platform.label,
    accent_color: platform.accentColor,
    enabled: Boolean(config.enabled),
    readiness,
    missing: missing.map((item) => item.label),
    display_name: config.display_name || "",
    login_name: config.login_name || "",
    auth_status: config.auth_status || "idle",
    auth_error: config.auth_error || "",
    token_last_validated_at: config.token_last_validated_at || "",
    scopes: config.scopes || [],
    notes: getNotes(providerKey, config, setupMode, humanStatusKey),
    setup_mode: setupMode,
    human_status_key: humanStatusKey,
    human_status_label: HUMAN_STATUS_LABELS[humanStatusKey],
    method_key: methodKey,
    method_label: METHOD_LABELS[methodKey],
    support_label: PROVIDER_PRODUCT[providerKey]?.support_label || "",
    target_label: getTargetLabel(providerKey, config, setupMode),
    recommended_method_key: PROVIDER_PRODUCT[providerKey]?.recommended_method || "compatibility",
    recommended_method_label: METHOD_LABELS[PROVIDER_PRODUCT[providerKey]?.recommended_method || "compatibility"],
    official_status: PROVIDER_PRODUCT[providerKey]?.official_status || "preparing"
  };
}
