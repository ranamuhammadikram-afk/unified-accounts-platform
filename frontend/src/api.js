const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function getToken() {
  return localStorage.getItem("uap_token");
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }

  // A session that is no longer valid (expired, or signed out because the password was changed
  // elsewhere): clear it and go back to the sign-in page instead of showing errors everywhere.
  if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
    localStorage.removeItem("uap_token");
    localStorage.removeItem("uap_user");
    if (window.location.pathname !== "/login") window.location.assign("/login");
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Sends a file (photo or PDF) as the raw request body, or fetches a file back as a Blob.
async function fileRequest(method, path, file) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (file) headers["Content-Type"] = file.type || "application/octet-stream";
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: file || undefined });
  if (res.status === 401 && token) {
    localStorage.removeItem("uap_token");
    localStorage.removeItem("uap_user");
    if (window.location.pathname !== "/login") window.location.assign("/login");
  }
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  if (!res.ok) {
    const data = isJson ? await res.json().catch(() => null) : null;
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return isJson ? res.json() : res.blob();
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
  upload: (path, file) => fileRequest("POST", path, file),
  blob: (path) => fileRequest("GET", path),
};

export { API_URL };
