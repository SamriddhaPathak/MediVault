import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

function getStoredTokens() {
  const raw = localStorage.getItem("mv_tokens");
  return raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string }) : null;
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

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
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
