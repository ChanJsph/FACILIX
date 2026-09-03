import { Database } from "@db/sqlite";
import bcrypt from "bcryptjs";

const DB_PATH = Deno.env.get("DB_PATH") ?? "./data/facilix.db";

// Ensure data dir exists
try {
  await Deno.mkdir("./data", { recursive: true });
} catch { /* exists */ }

export const db = new Database(DB_PATH);

// Enable WAL for better concurrency
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fullname TEXT NOT NULL,
    username TEXT UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('superadmin','admin','technician','complainant')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

// Migration: add username column if DB was created before this field
// Note: SQLite cannot ADD COLUMN with UNIQUE directly, so add column then index
try {
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const hasUsername = cols.some((c) => c.name === "username");
  if (!hasUsername) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);");
    console.log("  🔧 migrated: added username column");
  } else {
    // ensure index exists even if column already exists (for DBs created with column but no index)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);");
  }
} catch (e) {
  console.warn("  ⚠️ migration check failed", e);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_users_updated
  AFTER UPDATE ON users FOR EACH ROW
  BEGIN
    UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  END;
`);

// === Requests table (facility complaints) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','in-progress','completed','rejected')) DEFAULT 'pending',
    type TEXT,
    category TEXT NOT NULL,
    other_service_desc TEXT,
    location TEXT,
    priority TEXT NOT NULL CHECK(priority IN ('Low','Medium','High','Urgent')) DEFAULT 'Medium',
    created_date TEXT NOT NULL,
    due_date TEXT,
    assigned_to TEXT NOT NULL DEFAULT 'Pending Assignment',
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    owner_email TEXT NOT NULL,
    owner_name TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_requests_owner ON requests(owner_id);
  CREATE INDEX IF NOT EXISTS idx_requests_owner_email ON requests(owner_email);
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
  CREATE INDEX IF NOT EXISTS idx_requests_public ON requests(public_id);
  CREATE INDEX IF NOT EXISTS idx_requests_category ON requests(category);
`);

db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_requests_updated
  AFTER UPDATE ON requests FOR EACH ROW
  BEGIN
    UPDATE requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  END;
`);

// Migration: add admin confirmation columns if missing (confirmed, confirmed_by, confirmed_at)
try {
  const rcols = db.prepare("PRAGMA table_info(requests)").all() as { name: string }[];
  const hasConfirmed = rcols.some((c) => c.name === "confirmed");
  const hasConfirmedBy = rcols.some((c) => c.name === "confirmed_by");
  const hasConfirmedAt = rcols.some((c) => c.name === "confirmed_at");
  if (!hasConfirmed) {
    db.exec("ALTER TABLE requests ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;");
    console.log("  🔧 migrated: added requests.confirmed");
  }
  if (!hasConfirmedBy) {
    db.exec("ALTER TABLE requests ADD COLUMN confirmed_by TEXT;");
    console.log("  🔧 migrated: added requests.confirmed_by");
  }
  if (!hasConfirmedAt) {
    db.exec("ALTER TABLE requests ADD COLUMN confirmed_at TEXT;");
    console.log("  🔧 migrated: added requests.confirmed_at");
  }
} catch (e) {
  console.warn("  ⚠️ requests confirmation migration failed", e);
}

// Migration: technician evidence + required materials (JSON arrays)
try {
  const rcols2 = db.prepare("PRAGMA table_info(requests)").all() as { name: string }[];
  const hasEvidence = rcols2.some((c) => c.name === "evidence_json");
  const hasMaterials = rcols2.some((c) => c.name === "materials_json");
  if (!hasEvidence) {
    db.exec("ALTER TABLE requests ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';");
    console.log("  🔧 migrated: added requests.evidence_json");
  }
  if (!hasMaterials) {
    db.exec("ALTER TABLE requests ADD COLUMN materials_json TEXT NOT NULL DEFAULT '[]';");
    console.log("  🔧 migrated: added requests.materials_json");
  }
} catch (e) {
  console.warn("  ⚠️ requests evidence/materials migration failed", e);
}

// Seed helpers
function userExists(email: string): boolean {
  const row = db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email.toLowerCase());
  return !!row;
}
function userExistsUsername(username: string): boolean {
  if (!username) return false;
  const row = db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username);
  return !!row;
}

async function seedUser(
  fullname: string,
  email: string,
  phone: string,
  password: string,
  role: "superadmin" | "admin" | "technician" | "complainant",
  username?: string,
) {
  if (userExists(email)) return;
  if (username && userExistsUsername(username)) return;
  const hash = await bcrypt.hash(password, 10);
  db.prepare(
    "INSERT INTO users (fullname, username, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(fullname, username ?? null, email.toLowerCase(), phone, hash, role);
  console.log(`  🌱 seeded ${role}: ${email} / ${password}${username ? ` (username:${username})` : ""}`);
}

// Seed default accounts (only if missing) — establish superadmin first
await seedUser("Overlord", "lanachristianjosephd@gmail.com", "+1-000-000-0001", "admin123", "superadmin", "overlord");
await seedUser("Super Admin", "superadmin@facilix.com", "+1-000-000-0000", "SuperAdmin123!", "superadmin", "superadmin");
await seedUser("Admin", "admin@facilix.com", "+1-111-111-1111", "Admin123!", "admin", "admin");
await seedUser("Alex Technician", "technician@facilix.com", "+1-222-222-2222", "Tech123!", "technician", "technician");
await seedUser("John Complainant", "complainant@facilix.com", "+1-333-333-3333", "User123!", "complainant", "complainant");

// Seed mock requests if empty (so admin has data to fetch)
try {
  const rc = db.prepare("SELECT COUNT(*) as c FROM requests").get() as { c: number };
  if (rc.c === 0) {
    const adminUser = findUserByEmail("admin@facilix.com");
    const techUser = findUserByEmail("technician@facilix.com");
    const mocks: Array<any> = [
      ["REQ-001","HVAC System Maintenance","Regular maintenance and filter replacement for the main HVAC system","in-progress","Maintenance","Air Conditioning","","Building A - HVAC Room","High","2026-08-15","2026-08-20", adminUser?.id ?? 3, adminUser?.email ?? "admin@facilix.com"],
      ["REQ-002","Conference Room Lighting Issue","Lights in Conference Room B are flickering and need inspection","pending","Repair","Electrical","","Building B - Conference Room","Medium","2026-08-17","2026-08-22", adminUser?.id ?? 3, adminUser?.email ?? "admin@facilix.com"],
      ["REQ-003","Hallway Deep Cleaning - Floor 3","Deep cleaning and mopping for entire 3rd floor hallway and common areas","completed","Cleaning","Physical Structures","","Building A - Floor 3","Low","2026-08-10","2026-08-16", techUser?.id ?? 4, techUser?.email ?? "technician@facilix.com"],
      ["REQ-004","Security System Update","Software update for security system and camera installation check","pending","Installation","Fire Protection / DAS","","Building C - Security Room","High","2026-08-16","2026-08-25", adminUser?.id ?? 3, adminUser?.email ?? "admin@facilix.com"],
      ["REQ-005","Plumbing Inspection","Routine plumbing inspection and maintenance for all bathrooms","in-progress","Maintenance","Water / Sanitary / Fixtures","","Building A - All Floors","Medium","2026-08-12","2026-08-19", techUser?.id ?? 4, techUser?.email ?? "technician@facilix.com"],
    ];
    const ins = db.prepare(`INSERT INTO requests (public_id, title, description, status, type, category, other_service_desc, location, priority, created_date, due_date, owner_id, owner_email, owner_name, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const assignedMap: Record<string,string> = { "REQ-001":"John Smith","REQ-002":"Pending Assignment","REQ-003":"Maria Garcia","REQ-004":"Pending Assignment","REQ-005":"Robert Johnson" };
    for (const m of mocks) {
      const [pid, title, desc, status, type, cat, other, loc, prio, cdate, ddate, oid, oemail] = m as [string,string,string,string,string,string,string,string,string,string,string,number,string];
      const ownerRow = findUserById(oid as unknown as number);
      ins.run(pid, title, desc, status, type, cat, other, loc, prio, cdate, ddate, oid, oemail, ownerRow?.fullname ?? oemail, assignedMap[pid] ?? "Pending Assignment");
    }
    console.log("  🌱 seeded requests:", mocks.length);
  }
} catch (e) { console.warn("  ⚠️ request seed failed", e); }

// Log counts
const counts = db.prepare("SELECT role, COUNT(*) as c FROM users GROUP BY role").all() as { role: string; c: number }[];
console.log("  📦 users:", counts.map((r) => `${r.role}:${r.c}`).join(" "));
try { const rc2 = db.prepare("SELECT COUNT(*) as c FROM requests").get() as { c: number }; console.log("  📦 requests:", rc2.c); } catch {}

export type UserRow = {
  id: number;
  fullname: string;
  username: string | null;
  email: string;
  phone: string | null;
  password_hash: string;
  role: "superadmin" | "admin" | "technician" | "complainant";
  is_active: number;
  created_at: string;
  updated_at: string;
};

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email.toLowerCase()) as UserRow | undefined;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | undefined;
}

export function findUserByIdentifier(identifier: string): UserRow | undefined {
  const id = identifier.trim();
  // Try email first if contains @, else username, else try both
  if (id.includes("@")) {
    const byEmail = findUserByEmail(id);
    if (byEmail) return byEmail;
    return findUserByUsername(id);
  }
  const byUsername = findUserByUsername(id);
  if (byUsername) return byUsername;
  return findUserByEmail(id);
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function listUsersSafe() {
  return db.prepare("SELECT id, fullname, username, email, phone, role, is_active, created_at, updated_at FROM users ORDER BY id").all();
}

export function updateUserRole(id: number, role: string) {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

export function setUserActive(id: number, active: boolean) {
  db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

export function deleteUser(id: number) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

// === Requests helpers ===
export type RequestRow = {
  id: number;
  public_id: string;
  title: string;
  description: string;
  status: "pending" | "in-progress" | "completed" | "rejected";
  type: string | null;
  category: string;
  other_service_desc: string | null;
  location: string | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
  created_date: string;
  due_date: string | null;
  assigned_to: string;
  owner_id: number | null;
  owner_email: string;
  owner_name: string | null;
  confirmed: number; // 0/1 — admin confirmation of work
  confirmed_by: string | null;
  confirmed_at: string | null;
  evidence_json: string; // JSON array of {id,name,dataUrl,size,uploadedAt,uploadedBy}
  materials_json: string; // JSON array of {id,name,qty,unit,note,addedAt,addedBy}
  created_at: string;
  updated_at: string;
};

function safeParseJsonArray(s: string | null): unknown[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function toFrontendRequest(r: RequestRow & { owner_role?: string; owner_fullname?: string }) {
  return {
    id: r.public_id,
    dbId: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    type: r.type ?? "",
    category: r.category,
    otherServiceDesc: r.other_service_desc ?? "",
    location: r.location ?? "",
    priority: r.priority,
    createdDate: r.created_date,
    dueDate: r.due_date ?? "",
    assignedTo: r.assigned_to,
    owner: r.owner_email,
    ownerName: r.owner_name ?? r.owner_fullname ?? r.owner_email,
    owner_role: (r as unknown as { owner_role?: string }).owner_role ?? null,
    confirmed: !!(r.confirmed ?? 0),
    confirmedBy: r.confirmed_by ?? null,
    confirmedAt: r.confirmed_at ?? null,
    evidence: safeParseJsonArray((r as unknown as { evidence_json?: string }).evidence_json ?? null),
    materials: safeParseJsonArray((r as unknown as { materials_json?: string }).materials_json ?? null),
  };
}

export function findRequestByPublicId(publicId: string): RequestRow | undefined {
  return db.prepare("SELECT * FROM requests WHERE public_id = ?").get(publicId) as RequestRow | undefined;
}
export function listAllRequests(): RequestRow[] {
  return db.prepare("SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r LEFT JOIN users u ON u.id = r.owner_id ORDER BY r.id DESC").all() as unknown as RequestRow[];
}
export function listRequestsByEmail(email: string): RequestRow[] {
  return db.prepare("SELECT * FROM requests WHERE owner_email = ? COLLATE NOCASE ORDER BY id DESC").get(email) as unknown as RequestRow[] || [] as unknown as RequestRow[];
}
export function listComplainantRequests(): RequestRow[] {
  return db.prepare(`
    SELECT r.*, u.role as owner_role, u.fullname as owner_fullname FROM requests r
    LEFT JOIN users u ON u.id = r.owner_id
    WHERE u.role = 'complainant' OR r.owner_email IN (SELECT email FROM users WHERE role='complainant')
    ORDER BY r.id DESC
  `).all() as unknown as RequestRow[];
}
