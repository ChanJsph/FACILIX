/**
 * FACILIX Responsive Navigation — site-wide
 * - Injects hamburger + overlay if missing
 * - Wraps .navbar + .auth-buttons into .nav-menu for drawer on <=900px
 * - Toggles with aria-expanded, body scroll lock, ESC + overlay close
 * - Keeps .nav-link.active in sync with current page
 * - Works for both legacy headers: .header-container and inline .container
 */
(function () {
  // Canonical site-wide nav — same 5 links on every page, order: Home, Services, Reports, Requests, About
  const NAV_LINKS = [
    { href: "index.html", label: "Home", test: (p) => p === "index.html" || p === "" || p === "home.html" },
    { href: "services.html", label: "Services", test: (p) => p === "services.html" || p === "services-dashboard.html" },
    { href: "reports.html", label: "Reports", test: (p) => p === "reports.html" || p === "reports-dashboard.html" },
    { href: "requests.html", label: "Requests", test: (p) => p === "requests.html" },
    { href: "about.html", label: "About", test: (p) => p === "about.html" || p === "about-dashboard.html" },
  ];

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

    // Rebuild navbar site-wide from canonical NAV_LINKS so every page has identical, correct hrefs/order.
    // Fixes stale/per-page drift, wrong order, missing links, and typos.
    if (navbar) {
      const cur = getCurrentPage();
      navbar.innerHTML = "";
      NAV_LINKS.forEach((link) => {
        const a = document.createElement("a");
        a.href = link.href;
        a.textContent = link.label;
        a.className = "nav-link";
        // active if exact or via test (e.g. services-dashboard → Services)
        const isActive = link.test ? link.test(cur) : link.href === cur;
        if (isActive) {
          a.classList.add("active");
          a.setAttribute("aria-current", "page");
        }
        navbar.appendChild(a);
      });
    }

    // Ensure auth buttons exist site-wide
    if (!authButtons) {
      authButtons = document.createElement("div");
      authButtons.className = "auth-buttons";
      authButtons.innerHTML = '<a href="register.html" class="register-btn">Register</a><a href="login.html" class="login-btn">Login</a>';
    } else {
      // normalize hrefs/text in case of drift
      authButtons.querySelectorAll("a").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (href.includes("register")) { a.href = "register.html"; a.textContent = "Register"; a.className = "register-btn"; }
        if (href.includes("login")) { a.href = "login.html"; a.textContent = "Login"; a.className = "login-btn"; }
      });
      // ensure both buttons present
      if (!authButtons.querySelector('a[href="register.html"]')) {
        const r = document.createElement("a");
        r.href = "register.html"; r.className = "register-btn"; r.textContent = "Register";
        authButtons.prepend(r);
      }
      if (!authButtons.querySelector('a[href="login.html"]')) {
        const l = document.createElement("a");
        l.href = "login.html"; l.className = "login-btn"; l.textContent = "Login";
        authButtons.appendChild(l);
      }
    }

    // wrap navbar + auth into .nav-menu if not already
    let navMenu = container.querySelector(".nav-menu");
    if (!navMenu) {
      navMenu = document.createElement("div");
      navMenu.className = "nav-menu";
      navMenu.id = "nav-menu";
      // move navbar + auth into menu
      if (navbar) navMenu.appendChild(navbar);
      if (authButtons) navMenu.appendChild(authButtons);
      container.appendChild(navMenu);
    } else {
      // ensure navbar/auth are inside menu
      if (navbar && navbar.parentElement !== navMenu) navMenu.insertBefore(navbar, navMenu.firstChild);
      if (authButtons && authButtons.parentElement !== navMenu) navMenu.appendChild(authButtons);
    }

    // ensure toggle button exists
    let toggle = container.querySelector(".nav-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.className = "nav-toggle";
      toggle.id = "nav-toggle";
      toggle.setAttribute("aria-label", "Toggle navigation menu");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "nav-menu");
      toggle.innerHTML = "<span></span><span></span><span></span>";
      // insert before nav-menu
      container.insertBefore(toggle, navMenu);
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
