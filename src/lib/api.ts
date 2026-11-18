import { auth } from "./firebase";
import { UploadedFile } from "../types";

const GUEST_SESSION_KEY = "feynman_guest_session_id";

export function getOrCreateGuestSessionId(): string {
  try {
    let id = localStorage.getItem(GUEST_SESSION_KEY);
    if (!id || !/^guest_[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      const rand =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().replace(/-/g, "")
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      id = `guest_${rand.slice(0, 24)}`;
      localStorage.setItem(GUEST_SESSION_KEY, id);
    }
    return id;
  } catch {
    return "guest_anonymous";
  }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "x-feynman-guest-id": getOrCreateGuestSessionId(),
  };

  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (err) {
      console.warn("Could not retrieve Firebase ID token:", err);
    }
  }

  return headers;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const mergedHeaders = new Headers(init.headers || {});
  for (const [k, v] of Object.entries(authHeaders)) {
    if (!mergedHeaders.has(k)) {
      mergedHeaders.set(k, v);
    }
  }
  return fetch(input, {
    ...init,
    headers: mergedHeaders,
  });
}

/**
 * Persists uploaded file metadata to localStorage while stripping oversized binary
 * payloads (> 350 KB) that would hit browser localStorage quota limits on large PDFs.
 */
export function safeSaveFilesToLocalStorage(storageKey: string, files: UploadedFile[]): void {
  const compacted = files.map((f) => {
    if (f.content && f.content.length > 350_000) {
      return {
        ...f,
        content: `/api/rag/document/${encodeURIComponent(f.id)}/file`,
      };
    }
    return f;
  });

  try {
    localStorage.setItem(storageKey, JSON.stringify(compacted));
  } catch (err) {
    console.warn("localStorage quota reached; saving compact metadata only:", err);
    try {
      const minimal = compacted.map((f) => ({
        ...f,
        content:
          f.content.length > 50_000
            ? `/api/rag/document/${encodeURIComponent(f.id)}/file`
            : f.content,
      }));
      localStorage.setItem(storageKey, JSON.stringify(minimal));
    } catch {
      // ignore if browser storage is completely full
    }
  }
}
