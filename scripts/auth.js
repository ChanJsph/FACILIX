/**
 * FACILIX Auth helper — SQLite backend
 * Stores token + safe user in localStorage, mirrors server cookie.
 * Roles: superadmin > admin > technician > complainant
 */
(function () {
  const TOKEN_KEY = "facilix_token";
  const USER_KEY = "currentUser";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem("currentUser", JSON.stringify({
      userId: user.id,
      email: user.email,
      fullname: user.fullname,
      role: user.role,
      loginTime: new Date().toLocaleString(),
    }));
    if (user.role === "admin" || user.role === "superadmin") {
      localStorage.setItem("currentAdmin", JSON.stringify({ userId: user.id, email: user.email, role: user.role }));
    }
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("currentUser");
    localStorage.removeItem("currentAdmin");
  }
  function getCurrentUser() {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem("currentUser");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  function getRole() {
    const u = getCurrentUser();
    return u?.role ?? null;
  }
  function isLoggedIn() {
    return !!getToken() && !!getCurrentUser();
  }
  async function fetchMe() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch("/api/auth/me", { headers: { "Authorization": `Bearer ${token}` } });
      if (!res.ok) { clearSession(); return null; }
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return data.user;
      }
    } catch { /* offline */ }
    return getCurrentUser();
  }
  async function logout() {
    const token = getToken();
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: token ? { "Authorization": `Bearer ${token}` } : {} });
    } catch { /* ignore */ }
    clearSession();
    alert("✅ Logged out");
    window.location.href = "index.html";
  }
  function requireRole(allowed) {
    const role = getRole();
    if (!role) { window.location.href = "login.html"; return false; }
    if (!allowed.includes(role)) {
      alert(`⛔ Access denied for role ${role}. Required: ${allowed.join(", ")}`);
      window.location.href = "index.html";
      return false;
    }
    return true;
  }
  function canSee(role, needed) {
    const rank = { complainant: 1, technician: 2, admin: 3, superadmin: 4 };
    return (rank[role] ?? 0) >= (rank[needed] ?? 0);
  }
  window.facilixAuth = { getToken, getCurrentUser, getRole, isLoggedIn, fetchMe, logout, requireRole, setSession, clearSession, canSee };
  window.getCurrentUser = getCurrentUser;
  window.isUserLoggedIn = isLoggedIn;
  window.logoutUser = logout;
  window.logoutAdmin = logout;
})();
