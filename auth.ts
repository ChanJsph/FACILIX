import bcrypt from "bcryptjs";
import { db, findUserByEmail, findUserByUsername, findUserByIdentifier, findUserById, type UserRow, DEPARTMENTS } from "./db.ts";

export const ROLES = ["superadmin", "admin", "technician", "complainant"] as const;
export type Role = typeof ROLES[number];

const ROLE_RANK: Record<Role, number> = { complainant: 1, technician: 2, admin: 3, superadmin: 4 };

export function canManage(actorRole: Role, targetRole: Role): boolean {
  // superadmin can manage everyone except maybe themselves? allow
  // admin can manage technician & complainant
  // others cannot manage
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") return targetRole === "technician" || targetRole === "complainant";
  return false;
}

export function canAssignRole(actorRole: Role | null, newRole: Role): boolean {
  // Only superadmin can create technician, admin, superadmin
  // Anyone (including public) can create complainant
  if (newRole === "complainant") return true;
  // technician / admin / superadmin require superadmin
  return actorRole === "superadmin";
}

// Password helpers
export async function hashPassword(pw: string): Promise<string> {
  return await bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(pw, hash);
}

// Sessions (1 week expiry)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SafeUser = Omit<UserRow, "password_hash">;

export function toSafeUser(u: UserRow): SafeUser {
  const { password_hash: _p, ...safe } = u as unknown as { password_hash: string } & SafeUser;
  return safe;
}

export async function registerUser(
  data: { fullname: string; username?: string; email: string; phone?: string; password: string; role?: Role; department?: string | null },
  actor?: SafeUser | null,
): Promise<{ ok: true; user: SafeUser } | { ok: false; error: string; status?: number }> {
  const fullname = data.fullname?.trim();
  const username = data.username?.trim() || null;
  const email = data.email?.trim().toLowerCase();
  const phone = data.phone?.trim() ?? null;
  const password = data.password ?? "";
  let role: Role = (data.role as Role) ?? "complainant";
  const department = data.department?.trim() || null;

  if (!fullname || !email || !password) return { ok: false, error: "fullname, email, password required", status: 400 };
  if (!email.includes("@")) return { ok: false, error: "invalid email", status: 400 };
  if (username && !/^[a-zA-Z0-9._-]{3,20}$/.test(username)) return { ok: false, error: "username must be 3-20 chars (a-z,0-9,._-)", status: 400 };
  if (password.length < 6) return { ok: false, error: "password must be >=6 chars", status: 400 };
  if (!ROLES.includes(role)) return { ok: false, error: `invalid role, must be ${ROLES.join("|")}`, status: 400 };
  // Department validation — only meaningful for technician, but allow null for others
  if (department && !(DEPARTMENTS as readonly string[]).includes(department)) {
    return { ok: false, error: `invalid department, must be ${DEPARTMENTS.join(" | ")}`, status: 400 };
  }
  if (role === "technician" && !department) {
    return { ok: false, error: `technician requires department (${DEPARTMENTS.join(" | ")})`, status: 400 };
  }

  // Role assignment check — only superadmin can create technician/admin/superadmin
  const actorRole = (actor?.role as Role) ?? null;
  if (!canAssignRole(actorRole, role)) {
    return { ok: false, error: `only superadmin can create ${role} accounts`, status: 403 };
  }

  if (findUserByEmail(email)) return { ok: false, error: "email already exists", status: 409 };
  if (username && findUserByUsername(username)) return { ok: false, error: "username already exists", status: 409 };

  const hash = await hashPassword(password);
  const stmt = db.prepare(
    "INSERT INTO users (fullname, username, email, phone, password_hash, role, department) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(fullname, username, email, phone, hash, role, department);
  const newId = db.lastInsertRowId;
  const user = findUserById(newId)!;
  return { ok: true, user: toSafeUser(user) };
}

export async function loginUser(
  identifier: string,
  password: string,
): Promise<{ ok: true; user: SafeUser; token: string } | { ok: false; error: string; status?: number }> {
  const id = identifier?.trim();
  if (!id || !password) return { ok: false, error: "identifier and password required", status: 400 };
  const user = findUserByIdentifier(id);
  if (!user) return { ok: false, error: "invalid credentials", status: 401 };
  if (!user.is_active) return { ok: false, error: "account disabled", status: 403 };
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return { ok: false, error: "invalid credentials", status: 401 };

  const token = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    user.id,
    expires.toISOString(),
  );
  return { ok: true, user: toSafeUser(user), token };
}

export function verifyToken(token: string | null): SafeUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.expires_at, s.revoked, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(token) as (UserRow & { expires_at: string; revoked: number }) | undefined;
  if (!row) return null;
  if (row.revoked) return null;
  if (new Date(row.expires_at) < new Date()) {
    // expired — revoke
    db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(token);
    return null;
  }
  if (!row.is_active) return null;
  const { expires_at: _e, revoked: _r, password_hash: _p, ...safe } = row as unknown as Record<string, unknown>;
  return safe as unknown as SafeUser;
}

export function logoutToken(token: string | null): boolean {
  if (!token) return false;
  const info = db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(token);
  return info.changes > 0;
}

export function getTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  // also allow x-token or cookie
  const xt = req.headers.get("x-token");
  if (xt) return xt.trim();
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const m = cookie.match(/(?:^|; )token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  // query fallback ?token=
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("token");
    if (q) return q;
  } catch { /* ignore */ }
  return null;
}

export function requireAuth(req: Request): SafeUser | null {
  const tok = getTokenFromRequest(req);
  return verifyToken(tok);
}

export function requireRole(user: SafeUser | null, roles: Role[]): boolean {
  if (!user) return false;
  return roles.includes(user.role as Role);
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role] ?? 0;
}
