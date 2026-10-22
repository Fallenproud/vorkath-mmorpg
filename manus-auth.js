// scripts/game-auth-browser-entry.mjs
import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import superjson from "superjson";

// starters/web-db-user-v1/shared/const.ts
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var encodeOAuthState = (state) => btoa(JSON.stringify(state));

// starters/web-db-user-v1/client/src/const.ts
var startLogin = () => {
  const oauthPortalUrl = window.__MANUS_CONFIG__?.oauthPortalUrl;
  const appId = window.__MANUS_CONFIG__?.projectId;
  if (!oauthPortalUrl || !appId) throw new Error("Manus login is not configured");
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce });
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("responseType", "code");
  window.location.href = url.toString();
};

// scripts/game-auth-browser-entry.mjs
var root = window;
var pathname = new URL(root.location.href).pathname;
var marker = pathname.indexOf("/__manus__/game-preview/");
var prefix = marker < 0 ? "" : pathname.slice(0, marker);
var client = createTRPCUntypedClient({ links: [httpLink({
  url: prefix + "/api/trpc",
  transformer: superjson,
  async fetch(url, options) {
    const response = await root.fetch(url, { ...options, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(35e3) });
    if (response.status === 503 && (await response.clone().json().catch(() => null))?.error === "online_preview_requires_checkpoint") {
      throw new Error("online_preview_requires_checkpoint");
    }
    return response;
  }
})] });
var current = null;
var pending = null;
function publish(user, status = user ? "authenticated" : "logged_out") {
  current = { status, user: user ? { id: user.id, name: user.name } : null };
  root.dispatchEvent(new root.CustomEvent("manus-auth-change", { detail: current }));
  return current;
}
function requireOnline() {
  if (current?.status === "offline") throw new Error("online_preview_requires_checkpoint");
}
function standaloneUrl(login2 = false) {
  const url = new URL(root.location.origin + root.location.pathname);
  if (login2) url.searchParams.set("manus_login", "1");
  return url.href;
}
async function login() {
  requireOnline();
  if (root.self !== root.top) {
    root.open(standaloneUrl(true), "_blank", "noopener");
    return;
  }
  const response = await root.fetch(prefix + "/api/auth/config", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(35e3) });
  if (!response.ok) throw new Error("auth_unavailable");
  root.__MANUS_CONFIG__ = await response.json();
  startLogin();
}
async function call(kind, procedure, input) {
  requireOnline();
  try {
    return await client[kind](procedure, input);
  } catch (error) {
    if (error.data?.code === "UNAUTHORIZED") publish(null);
    throw error;
  }
}
async function prepare() {
  const url = new URL(root.location.href);
  if (url.searchParams.has("code") || url.searchParams.has("state")) throw new Error("oauth_callback_route_invalid");
  if (!pending) pending = client.query("webdev.auth.me").then(publish).catch((error) => {
    if (error.message === "online_preview_requires_checkpoint") return publish(null, "offline");
    throw error;
  }).then(async (state) => {
    if (url.searchParams.get("manus_login") === "1" && root.self === root.top) {
      url.searchParams.delete("manus_login");
      root.history.replaceState(null, "", url.href);
      if (state.status === "logged_out") await login();
    }
    return state;
  }).finally(() => {
    pending = null;
  });
  return pending;
}
var ManusAuth = Object.freeze({
  prepare,
  login,
  async startGame(start) {
    const state = await prepare();
    await start(state);
    return state;
  },
  invoke(operation, done) {
    if (!["login", "logout"].includes(operation)) {
      done("auth_operation_invalid");
      return;
    }
    ManusAuth[operation]().then(() => done(""), (error) => done(error.message));
  },
  async logout() {
    await call("mutation", "webdev.auth.logout");
    return publish(null);
  },
  get_session: () => current,
  query: (procedure, input) => call("query", `game.${procedure}`, input),
  mutate: (procedure, input) => call("mutation", `game.${procedure}`, input),
  open_standalone: () => {
    root.open(standaloneUrl(), "_blank", "noopener");
  }
});
root.ManusAuth = ManusAuth;
export {
  ManusAuth
};
