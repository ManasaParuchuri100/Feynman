import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { initializeApp, getApps, getApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export interface RequestUser {
  userId: string;
  isAuthenticated: boolean;
}

let cachedProjectId: string | null = null;
let adminApp: App | null = null;

function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  cachedProjectId = parsed.projectId || "feynman-43651";
  return cachedProjectId!;
}

function getFirebaseAdminApp(): App {
  if (adminApp) return adminApp;
  const projectId = getFirebaseProjectId();
  adminApp = getApps().length > 0 ? getApp() : initializeApp({ projectId });
  return adminApp;
}

/**
 * Resolves the authoritative user namespace from either a verified Firebase ID token
 * (when signed in) or a scoped browser guest ID header (when in guest mode).
 * Never trusts client-supplied userId fields in request bodies.
 */
export async function resolveRequestUser(req: Request): Promise<RequestUser> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.slice("Bearer ".length).trim();
    if (!idToken) {
      throw new AuthError("Empty authorization token.", 401);
    }
    try {
      const app = getFirebaseAdminApp();
      const decoded = await getAuth(app).verifyIdToken(idToken);
      if (!decoded?.uid) {
        throw new AuthError("Token missing user identity.", 401);
      }
      return { userId: decoded.uid, isAuthenticated: true };
    } catch (err: any) {
      throw new AuthError(
        `Invalid or expired authentication token: ${err?.message || "Unauthorized"}`,
        401
      );
    }
  }

  const rawGuestId = req.headers["x-feynman-guest-id"];
  const guestId =
    typeof rawGuestId === "string" && /^guest_[a-zA-Z0-9_-]{8,64}$/.test(rawGuestId)
      ? rawGuestId
      : "guest_anonymous";

  return { userId: guestId, isAuthenticated: false };
}
