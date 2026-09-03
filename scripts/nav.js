/**
 * FACILIX Responsive Navigation — site-wide
 * - Injects hamburger + overlay if missing
 * - Wraps .navbar + .auth-buttons into .nav-menu for drawer on <=900px
 * - Toggles with aria-expanded, body scroll lock, ESC + overlay close
 * - Keeps .nav-link.active in sync with current page
 * - Works for both legacy headers: .header-container and inline .container
 */
(function () {
  // Admin: quick-access holds Services/Reports/Requests/Technicians, so hide them at top for admin
  const NAV_LINKS = [
    { href: "index.html", label: "Home", test: (p) => p === "index.html" || p === "" || p === "home.html", roles: ["complainant","technician","admin","superadmin", null] },
    { href: "services.html", label: "Services", test: (p) => p === "services.html" || p === "services-dashboard.html", roles: ["complainant","technician", null] },
    { href: "reports.html", label: "Reports", test: (p) => p === "reports.html" || p === "reports-dashboard.html", roles: [] },
    { href: "requests.html", label: "Requests", test: (p) => p === "requests.html", roles: [] },
    { href: "technician-dashboard.html", label: "Technician", test: (p) => p === "technician-dashboard.html", roles: ["technician","admin","superadmin"] },
    { href: "technicians.html", label: "Technicians", test: (p) => p === "technicians.html", roles: ["admin","superadmin"] },
    { href: "about.html", label: "About", test: (p) => p === "about.html" || p === "about-dashboard.html", roles: ["complainant","technician","admin","superadmin", null] },
  ];

  function getCurrentRole() {
    try {
      // auth.js stores token+user; try facilixAuth first, fallback to localStorage
      if (window.facilixAuth && window.facilixAuth.getRole) return window.facilixAuth.getRole();
      const raw = localStorage.getItem("currentUser") || localStorage.getItem("facilix_token") && localStorage.getItem("currentUser");
      if (raw) {
        const u = JSON.parse(localStorage.getItem("currentUser") || "null");
        return u?.role || null;
      }
      // also check stored safe user under facilix key
      const u2 = JSON.parse(localStorage.getItem("currentUser") || "null");
      if (u2?.role) return u2.role;
    } catch {}
    // try direct token decode? just check localStorage for role
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null");
      if (u?.role) return u.role;
    } catch {}
    return null; // public / not logged in
  }

  function visibleLinks() {
    const role = getCurrentRole();
    return NAV_LINKS.filter(l => !l.roles || l.roles.includes(role));
  }

  function getCurrentPage() {
    const path = window.location.pathname;
    const file = path.substring(path.lastIndexOf("/") + 1).split("?")[0].split("#")[0];
    return file || "index.html";
  }

  function ensureHeader() {
    const header = document.querySelector(".header");
    if (!header) return null;

    // support both .header-container and legacy .container with inline style
    let container = header.querySelector(".header-container");
    if (!container) container = header.querySelector(":scope > .container");
    if (!container) container = header.querySelector(":scope > div");
    if (!container) return null;

    // ensure container has class for styling
    if (!container.classList.contains("header-container") && !container.classList.contains("container")) {
      container.classList.add("header-container");
    }

    // ensure logo is a link
    let logo = container.querySelector(".logo");
    if (logo && logo.tagName !== "A") {
      const a = document.createElement("a");
      a.href = "index.html";
      a.className = logo.className;
      a.innerHTML = logo.innerHTML;
      // preserve classes like logo
      logo.replaceWith(a);
      logo = a;
    }

    let navbar = container.querySelector(".navbar");
    let authButtons = container.querySelector(".auth-buttons");

    // Rebuild navbar site-wide from canonical NAV_LINKS filtered by role
    if (navbar) {
      const cur = getCurrentPage();
      navbar.innerHTML = "";
      visibleLinks().forEach((link) => {
        const a = document.createElement("a");
        a.href = link.href;
        a.textContent = link.label;
        a.className = "nav-link";
        const isActive = link.test ? link.test(cur) : link.href === cur;
        if (isActive) {
          a.classList.add("active");
          a.setAttribute("aria-current", "page");
        }
        navbar.appendChild(a);
      });
    }

    // Ensure auth buttons exist site-wide — when logged in, replace login/register with logout icon at same location
    const isLoggedIn = !!getCurrentRole();
    if (!authButtons) {
      authButtons = document.createElement("div");
      authButtons.className = "auth-buttons";
      authButtons.innerHTML = '<a href="register.html" class="register-btn">Register</a><a href="login.html" class="login-btn">Login</a>';
    }

    // Remove any legacy separate user-menu (we now reuse auth-buttons at login location)
    const legacyMenu = container.querySelector(".user-menu");
    if (legacyMenu) legacyMenu.remove();

    if (isLoggedIn) {
      try {
        const raw = localStorage.getItem("currentUser");
        const u = raw ? JSON.parse(raw) : null;
        const name = u?.fullname || u?.username || u?.email || "User";
        const email = u?.email || "";
        const role = u?.role || getCurrentRole() || "";
        const initial = (name.trim()[0] || "U").toUpperCase();
        const loginTime = (() => { try { return u?.loginTime || ""; } catch { return ""; } })() || new Date().toLocaleString();
        const shortName = name.split(" ")[0] || name;
        // Compact pill in nav bar — details only in dropdown
        authButtons.innerHTML = `
          <button class="user-pill" id="navUserPill" aria-expanded="false" aria-haspopup="true" aria-controls="userDropdown" title="${name} — ${email}">
            <span class="user-avatar">${initial}</span>
            <span class="user-name">${shortName}</span>
            <svg class="user-pill-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="user-dropdown" id="userDropdown" role="menu" aria-labelledby="navUserPill">
            <div class="dropdown-header">
              <span class="dropdown-avatar">${initial}</span>
              <div style="min-width:0; flex:1;">
                <div class="dropdown-name">${name}</div>
                <div class="dropdown-email">${email}</div>
                <span class="dropdown-role">${role}</span>
              </div>
            </div>
            <div class="dropdown-meta">
              <div class="dropdown-meta-row"><strong>Email</strong><span title="${email}">${email}</span></div>
              <div class="dropdown-meta-row"><strong>Role</strong><span style="text-transform:capitalize">${role}</span></div>
              <div class="dropdown-meta-row"><strong>Login</strong><span>${loginTime}</span></div>
              <div class="dropdown-status">● Active session</div>
            </div>
            <div class="dropdown-actions">
              <button class="dropdown-logout" onclick="window.facilixAuth && window.facilixAuth.logout()" role="menuitem">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Logout
              </button>
            </div>
          </div>`;
        authButtons.style.display = "";
        authButtons.classList.add("auth-logged-in");
        // bind dropdown toggle
        setTimeout(() => {
          const pill = document.getElementById("navUserPill");
          const dropdown = document.getElementById("userDropdown");
          if (!pill || !dropdown) return;
          function open() {
            pill.setAttribute("aria-expanded", "true");
            dropdown.classList.add("active");
          }
          function close() {
            pill.setAttribute("aria-expanded", "false");
            dropdown.classList.remove("active");
          }
          function isOpen() { return pill.getAttribute("aria-expanded") === "true"; }
          pill.addEventListener("click", (e) => {
            e.stopPropagation();
            isOpen() ? close() : open();
          });
          document.addEventListener("click", (e) => {
            if (!isOpen()) return;
            if (!dropdown.contains(e.target) && !pill.contains(e.target)) close();
          });
          document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && isOpen()) close();
          });
          // prevent dropdown clicks from closing nav-menu on mobile
          dropdown.addEventListener("click", (e) => e.stopPropagation());
        }, 0);
      } catch {
        authButtons.innerHTML = '<a href="register.html" class="register-btn">Register</a><a href="login.html" class="login-btn">Login</a>';
      }
    } else {
      // Public / not logged in — restore Register + Login at same spot
      authButtons.innerHTML = '<a href="register.html" class="register-btn">Register</a><a href="login.html" class="login-btn">Login</a>';
      authButtons.style.display = "";
      authButtons.classList.remove("auth-logged-in");
    }

    // wrap navbar into .nav-menu; keep auth (user pill) OUTSIDE as compact pill next to logo
    let navMenu = container.querySelector(".nav-menu");
    if (!navMenu) {
      navMenu = document.createElement("div");
      navMenu.className = "nav-menu";
      navMenu.id = "nav-menu";
      if (navbar) navMenu.appendChild(navbar);
      container.appendChild(navMenu);
    } else {
      if (navbar && navbar.parentElement !== navMenu) navMenu.insertBefore(navbar, navMenu.firstChild);
      // if auth was previously inside menu, move it out
      if (authButtons && authButtons.parentElement === navMenu) {
        container.appendChild(authButtons);
      }
    }
    // ensure authButtons is direct child of header container (outside drawer) — pill next to logo
    if (authButtons && authButtons.parentElement !== container) {
      // place after navMenu (flex: logo | navMenu(fixed on mobile) | auth pill | toggle)
      const t = container.querySelector(".nav-toggle");
      if (t) container.insertBefore(authButtons, t);
      else container.appendChild(authButtons);
    }
    // if authButtons somehow still inside navMenu, pull it out
    if (authButtons && authButtons.parentElement === navMenu) {
      container.appendChild(authButtons);
    }

    // ensure toggle button exists — placed AFTER auth pill (rightmost)
    let toggle = container.querySelector(".nav-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.className = "nav-toggle";
      toggle.id = "nav-toggle";
      toggle.setAttribute("aria-label", "Toggle navigation menu");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "nav-menu");
      toggle.innerHTML = "<span></span><span></span><span></span>";
      container.appendChild(toggle);
    } else {
      // ensure toggle is after auth pill
      if (authButtons && toggle.previousElementSibling !== authButtons && authButtons.parentElement === container) {
        container.insertBefore(authButtons, toggle);
      }
      // ensure toggle is last visual (flex order handled via CSS order, but keep DOM last)
      if (container.lastElementChild !== toggle) {
        container.appendChild(toggle);
        // re-insert auth before toggle
        if (authButtons) container.insertBefore(authButtons, toggle);
      }
    }

    // ensure overlay exists (outside header, direct child of body)
    let overlay = document.getElementById("nav-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "nav-overlay";
      overlay.id = "nav-overlay";
      document.body.appendChild(overlay);
    }

    return { header, container, navMenu, toggle, overlay, navbar, authButtons };
  }

  function setActiveLinks(navbar) {
    if (!navbar) return;
    const cur = getCurrentPage();
    navbar.querySelectorAll(".nav-link").forEach((a) => {
      const href = (a.getAttribute("href") || "").split("?")[0];
      // exact match or via NAV_LINKS test
      let isActive = href === cur;
      if (!isActive) {
        const def = NAV_LINKS.find((l) => l.href === href);
        if (def && def.test) isActive = def.test(cur);
      }
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function bind(els) {
    if (!els) return;
    const { toggle, navMenu, overlay } = els;

    function open() {
      toggle.setAttribute("aria-expanded", "true");
      navMenu.classList.add("active");
      overlay.classList.add("active");
      document.body.style.overflow = "hidden";
    }
    function close() {
      toggle.setAttribute("aria-expanded", "false");
      navMenu.classList.remove("active");
      overlay.classList.remove("active");
      document.body.style.overflow = "";
    }
    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen() ? close() : open();
    });

    overlay.addEventListener("click", close);

    // close on nav link click (mobile)
    navMenu.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a && window.innerWidth <= 900) close();
    });

    // ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });

    // reset on resize to desktop
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 900 && isOpen()) close();
      }, 150);
    });

    // active links
    setActiveLinks(els.navbar);
  }

  // init on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bind(ensureHeader()));
  } else {
    bind(ensureHeader());
  }
})();
