//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import crypto from "node:crypto";

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";

const DEFAULT_SCOPES = ["user:read:chat", "user:write:chat"];

function assertValue(value, label) {
  if (!value || String(value).trim().length === 0) {
    throw new Error(`Twitch config ausente: ${label}`);
  }
}

export class TwitchAuthManager {
  constructor() {
    this.pendingStates = new Map();
  }

  createAuthorizationUrl(config) {
    assertValue(config.client_id, "client_id");
    assertValue(config.client_secret, "client_secret");
    assertValue(config.redirect_uri, "redirect_uri");

    const state = crypto.randomBytes(24).toString("hex");
    const scopes = config.scopes?.length > 0 ? config.scopes : DEFAULT_SCOPES;
    const url = new URL(TWITCH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.client_id);
    url.searchParams.set("redirect_uri", config.redirect_uri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("force_verify", "true");

    this.pendingStates.set(state, {
      created_at: new Date().toISOString(),
      client_id: config.client_id,
      redirect_uri: config.redirect_uri
    });

    return {
      url: url.toString(),
      state,
      scopes
    };
  }

  consumeState(state) {
    const snapshot = this.pendingStates.get(state);
    if (!snapshot) {
      throw new Error("State Twitch invalido ou expirado.");
    }
    this.pendingStates.delete(state);
    return snapshot;
  }

  async exchangeCodeForToken(config, code) {
    assertValue(config.client_id, "client_id");
    assertValue(config.client_secret, "client_secret");
    assertValue(config.redirect_uri, "redirect_uri");
    assertValue(code, "code");

    const body = new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirect_uri
    });

    const response = await fetch(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Falha ao trocar code por token na Twitch.");
    }

    return payload;
  }

  async validateUserToken(config, accessToken) {
    assertValue(config.client_id, "client_id");
    assertValue(accessToken, "access_token");

    const validationResponse = await fetch(TWITCH_VALIDATE_URL, {
      headers: {
        Authorization: `OAuth ${accessToken}`
      }
    });
    const validationPayload = await validationResponse.json();

    if (!validationResponse.ok) {
      throw new Error(validationPayload.message || "Token Twitch invalido.");
    }

    const userResponse = await fetch(TWITCH_USERS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": config.client_id
      }
    });
    const userPayload = await userResponse.json();

    if (!userResponse.ok || !userPayload.data?.[0]) {
      throw new Error(userPayload.message || "Nao foi possivel ler a conta Twitch autenticada.");
    }

    const user = userPayload.data[0];
    return {
      validation: validationPayload,
      user
    };
  }

  buildProviderPatchFromAuth(config, tokenPayload, validationPayload, user) {
    const expiresIn = Number(tokenPayload.expires_in || 0);
    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : "";

    return {
      enabled: true,
      channel: user.login,
      broadcaster_user_id: user.id,
      setup_mode: "official",
      quick_input: "",
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token || "",
      scopes: validationPayload.scopes || tokenPayload.scope || DEFAULT_SCOPES,
      display_name: user.display_name || user.login,
      login_name: user.login,
      token_expires_at: expiresAt,
      token_last_validated_at: new Date().toISOString(),
      auth_status: "authenticated",
      auth_error: ""
    };
  }
}
