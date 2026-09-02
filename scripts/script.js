console.log("Website loaded!");

// Get current page name
function getCurrentPage() {
    const pathname = window.location.pathname;
    const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
    return filename || 'index.html';
}

// Smooth page transitions
document.querySelectorAll('a[href]').forEach(link => {
    link.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        const currentPage = getCurrentPage();
        
        // Only apply transition for internal links (not hash links or external links)
        if (href && (href.startsWith('.') || href.startsWith('/') || !href.includes(':'))) {
            // Check if it's the same page - if so, don't apply transition
            if (href === currentPage) {
                return; // Do nothing, page will not reload
            }
            
            e.preventDefault();
            
            // Scroll to top smoothly
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            
            // Navigate immediately without fade effect
            window.location.href = href;
        }
    });
});

// Reset animation on page load
window.addEventListener('load', () => {
    document.body.style.opacity = '1';
    window.scrollTo(0, 0);
});

// Ensure body is visible on page load
document.body.style.opacity = '1';

// ===== USER MANAGEMENT UTILITIES =====

// Check if user is logged in
function isUserLoggedIn() {
    return localStorage.getItem('currentUser') !== null;
}

// Get current logged-in user
function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Check if admin is logged in
function isAdminLoggedIn() {
    return localStorage.getItem('currentAdmin') !== null;
}

// Get current logged-in admin
function getCurrentAdmin() {
    const admin = localStorage.getItem('currentAdmin');
    return admin ? JSON.parse(admin) : null;
}

// Logout user
function logoutUser() {
    localStorage.removeItem('currentUser');
    alert('✅ Logged out successfully!');
    window.location.href = 'index.html';
}

// Logout admin
function logoutAdmin() {
    localStorage.removeItem('currentAdmin');
    alert('✅ Admin logged out successfully!');
    window.location.href = 'index.html';
}

// Get all registered users (for debugging)
function getAllUsers() {
    return JSON.parse(localStorage.getItem('users') || '[]');
}

// Check if email exists
function emailExists(email) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    return users.some(user => user.email === email);
}

// Update user profile
function updateUserProfile(email, updates) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const userIndex = users.findIndex(u => u.email === email);
    
    if (userIndex !== -1) {
        users[userIndex] = { ...users[userIndex], ...updates };
        localStorage.setItem('users', JSON.stringify(users));
        
        // Update current user session if it's the logged-in user
        const currentUser = getCurrentUser();
        if (currentUser && currentUser.email === email) {
            const updatedSession = { ...currentUser, ...updates };
            localStorage.setItem('currentUser', JSON.stringify(updatedSession));
        }
        
        return true;
    }
    return false;
}

// Display user info (for debugging in console)
function displayUserInfo() {
    const user = getCurrentUser();
    if (user) {
        console.log('Logged in as:', user);
    } else {
        console.log('No user logged in');
    }
} 