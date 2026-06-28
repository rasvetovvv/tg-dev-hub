let authToken = "";

export function setAuthToken(token) {
  authToken = token || "";
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const init = {
    ...options,
    headers
  };

  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload?.error
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}
