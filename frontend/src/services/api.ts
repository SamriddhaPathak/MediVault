import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

function getStoredTokens() {
  const raw = localStorage.getItem("mv_tokens");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { accessToken: string; refreshToken: string };
  } catch {
    // Malformed stored value (corrupted write, manual tampering, a stale
    // shape from an older app version), treat it as "not signed in"
    // rather than letting JSON.parse throw synchronously inside the
    // request interceptor, which would break every API call for the rest
    // of the session.
    localStorage.removeItem("mv_tokens");
    return null;
  }
}

function storeTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  if (tokens) localStorage.setItem("mv_tokens", JSON.stringify(tokens));
  else localStorage.removeItem("mv_tokens");
}

api.interceptors.request.use((config) => {
  const tokens = getStoredTokens();
  if (tokens?.accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens?.refreshToken) return null;
  try {
    const res = await axios.post("/api/auth/refresh", { refreshToken: tokens.refreshToken });
    const newTokens = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
    storeTokens(newTokens);
    return newTokens.accessToken;
  } catch {
    storeTokens(null);
    return null;
  }
}

// Endpoints where a 401 is a normal, expected response carrying its own
// meaningful message (wrong password, unknown email) rather than a sign
// that a previously-valid session token has expired. These must never go
// through the refresh-then-redirect flow below; there is no session to
// refresh on a login attempt, and redirecting to /login?expired=1 would
// blow away the real error before the caller's own .catch ever sees it.
const AUTH_ENDPOINTS = ["/auth/login", "/auth/register", "/auth/refresh"];

function isAuthEndpoint(url?: string): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint(original?.url)) {
      original._retry = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
      const newAccessToken = await refreshPromise;
      if (newAccessToken) {
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(original);
      }
      window.location.href = "/login?expired=1";
    }
    return Promise.reject(error);
  }
);

export { storeTokens, getStoredTokens };

/**
 * Extracts a display message from a failed API call.
 *
 * In production this is identical to the old inline
 * `err?.response?.data?.error ?? fallback` used at every call site. The one
 * addition is `detail`: the backend's error handler includes it only
 * outside production, on unexpected (non-2xx-by-design) failures, carrying
 * the real underlying error message: a database schema mismatch, an
 * unhandled exception, whatever actually happened.
 *
 * Without this, that detail was visible only in the backend's own console
 * output, so debugging a local "Something went wrong" meant knowing to go
 * looking there. Appending it here means the same banner or toast that
 * already shows the friendly message also shows the real cause, with no
 * behavior change at all once the app is deployed with NODE_ENV=production
 * (the backend simply omits `detail` in that case, and this falls back to
 * exactly the old message).
 */
export function getErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  const message: string = data?.error ?? fallback;
  if (data?.detail && data.detail !== message) {
    return `${message} (${data.detail})`;
  }
  return message;
}
