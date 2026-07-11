// ================= CONFIGURATION & API BASE =================

const API_BASE = "api.php";
const STUDENT_REG_REGEX = /^[A-Za-z]{3}-01-[0-9]{4}-[0-9]{4}$/;
const ADMIN_SIGNUP_PASSCODE = "IAA-ADMIN-2026";

// ================= GLOBAL STATE VARIABLES =================

let currentUser = null;
let users = [];
let items = [];
let claims = [];
let auditLogs = [];
let activeView = "dashboard";
let activeClaimsTab = "reports";
let activeAdminTab = "users";

// ================= APP INITIALIZATION =================

document.addEventListener("DOMContentLoaded", () => {
  // Set up role selection listeners
  setupRoleSelector();
  
  // Load user session
  checkUserSession();
  
  // Apply theme on load
  applySavedTheme();
});

async function checkUserSession() {
  const sessionUser = localStorage.getItem("iaa_user");
  if (sessionUser) {
    currentUser = JSON.parse(sessionUser);
    showAppShell();
  } else {
    showOnboarding();
  }
}

// Fetch all database registries from backend server (PHP API)
async function loadData() {
  try {
    // 1. Fetch Items
    const itemsRes = await fetch(`${API_BASE}?action=items`);
    if (itemsRes.ok) {
      items = await itemsRes.json();
    }

    // 2. Fetch Claims
    const claimsRes = await fetch(`${API_BASE}?action=claims`);
    if (claimsRes.ok) {
      claims = await claimsRes.json();
    }

    // 3. Fetch Logs if Admin
    if (currentUser && currentUser.role === "admin") {
      const logsRes = await fetch(`${API_BASE}?action=logs`);
      if (logsRes.ok) {
        auditLogs = await logsRes.json();
      }
      
      const usersRes = await fetch(`${API_BASE}?action=admin_users`);
      if (usersRes.ok) {
        users = await usersRes.json();
      }
    }
  } catch (error) {
    console.error("Failed to load records from database server:", error);
    showToast("⚠️ API Server Connection Failed. Is the backend server running?", "error");
  }
}

// ================= THEME TOGGLER =================

function applySavedTheme() {
  const isDark = localStorage.getItem("iaa_dark_theme") === "true";
  const themeToggle = document.getElementById("theme-toggle-cb");
  
  if (isDark) {
    document.body.classList.add("dark-theme");
    if (themeToggle) themeToggle.checked = true;
  } else {
    document.body.classList.remove("dark-theme");
    if (themeToggle) themeToggle.checked = false;
  }
}

function toggleTheme() {
  const themeToggle = document.getElementById("theme-toggle-cb");
  if (themeToggle.checked) {
    document.body.classList.add("dark-theme");
    localStorage.setItem("iaa_dark_theme", "true");
  } else {
    document.body.classList.remove("dark-theme");
    localStorage.setItem("iaa_dark_theme", "false");
  }
}

// ================= AUTHENTICATION FLOW CONTROLS =================

function toggleAuthMode(mode) {
  const signinForm = document.getElementById("signin-form");
  const signupForm = document.getElementById("signup-form");
  const btnShowSignin = document.getElementById("btn-show-signin");
  const btnShowSignup = document.getElementById("btn-show-signup");
  
  if (mode === "signin") {
    signinForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
    btnShowSignin.classList.add("active");
    btnShowSignup.classList.remove("active");
  } else {
    signinForm.classList.add("hidden");
    signupForm.classList.remove("hidden");
    btnShowSignin.classList.remove("active");
    btnShowSignup.classList.add("active");
  }
}

function setupRoleSelector() {
  const options = document.querySelectorAll(".role-option");
  const fields = document.querySelectorAll(".dynamic-fields");
  
  options.forEach(opt => {
    opt.addEventListener("click", () => {
      options.forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      
      fields.forEach(f => f.classList.remove("active"));
      
      const role = opt.dataset.role;
      const targetFields = document.getElementById(`${role}-fields`);
      if (targetFields) {
        targetFields.classList.add("active");
        setRequiredFields(role);
      }
    });
  });
  
  setRequiredFields("student");
}

function setRequiredFields(role) {
  const inputs = document.querySelectorAll(".dynamic-fields input, .dynamic-fields select");
  inputs.forEach(input => input.removeAttribute("required"));
  
  if (role === "student") {
    document.getElementById("student-reg-no").setAttribute("required", "required");
    document.getElementById("student-course").setAttribute("required", "required");
  } else if (role === "staff") {
    document.getElementById("staff-id").setAttribute("required", "required");
    document.getElementById("staff-dept").setAttribute("required", "required");
  } else if (role === "lecturer") {
    document.getElementById("lecturer-id").setAttribute("required", "required");
  } else if (role === "security") {
    document.getElementById("security-badge").setAttribute("required", "required");
    document.getElementById("security-rank").setAttribute("required", "required");
    document.getElementById("security-station").setAttribute("required", "required");
  } else if (role === "admin") {
    document.getElementById("admin-passcode").setAttribute("required", "required");
  }
}

// Auth Actions: Sign In (Communicating with MySQL Backend via PHP)
async function handleSignIn(e) {
  e.preventDefault();
  
  const loginIdInput = document.getElementById("login-email").value.trim();
  const passwordInput = document.getElementById("login-password").value;
  
  try {
    const res = await fetch(`${API_BASE}?action=login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId: loginIdInput, password: passwordInput })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      currentUser = data.user;
      localStorage.setItem("iaa_user", JSON.stringify(currentUser));
      
      await showAppShell();
      showToast(`Logged in successfully! Welcome ${currentUser.name}`, "success");
      document.getElementById("signin-form").reset();
    } else {
      showToast(data.error || "Authentication failed.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to connect to backend server.", "error");
  }
}

// Auth Actions: Sign Up (Communicating with MySQL Backend via PHP)
async function handleSignUp(e) {
  e.preventDefault();
  
  const roleOption = document.querySelector(".role-option.selected");
  const role = roleOption.dataset.role;
  const name = document.getElementById("reg-name").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  
  if (!name || !phone || (!email && role !== 'student') || !password) {
    showToast("Please fill in all standard identity fields.", "error");
    return;
  }
  
  if (password.length < 6) {
    showToast("Password must contain at least 6 characters.", "error");
    return;
  }
  
  let regNumber = "";
  let roleDetails = "";
  
  if (role === "student") {
    regNumber = document.getElementById("student-reg-no").value.trim().toUpperCase();
    
    // Format check on client-side
    if (!STUDENT_REG_REGEX.test(regNumber)) {
      showToast("Student Registration Number must be formatted as: XXX-01-0000-0000 (e.g. IMC-01-0890-2024)", "error");
      return;
    }
    
    const course = document.getElementById("student-course").value.trim();
    const year = document.getElementById("student-year").value;
    roleDetails = `Reg No: ${regNumber} | Course: ${course} (Yr ${year})`;
  } else if (role === "staff") {
    const staffId = document.getElementById("staff-id").value.trim();
    const dept = document.getElementById("staff-dept").value.trim();
    roleDetails = `Staff ID: ${staffId} | Dept: ${dept}`;
  } else if (role === "lecturer") {
    const lecId = document.getElementById("lecturer-id").value.trim();
    const fac = document.getElementById("lecturer-faculty").value;
    roleDetails = `Lecturer ID: ${lecId} | Faculty: ${fac}`;
  } else if (role === "security") {
    const badge = document.getElementById("security-badge").value.trim();
    const rank = document.getElementById("security-rank").value.trim();
    const station = document.getElementById("security-station").value.trim();
    roleDetails = `Badge No: ${badge} | Rank: ${rank} | Station: ${station}`;
  } else if (role === "admin") {
    const passcode = document.getElementById("admin-passcode").value;
    if (passcode !== ADMIN_SIGNUP_PASSCODE) {
      showToast("Access Denied: Invalid Administrative registration key.", "error");
      return;
    }
    roleDetails = `Admin ID: IAA-ADM-${Date.now().toString().slice(-4)}`;
  }
  
  try {
    const res = await fetch(`${API_BASE}?action=register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        name,
        phone,
        role,
        regNumber,
        details: roleDetails
      })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      currentUser = data.user;
      localStorage.setItem("iaa_user", JSON.stringify(currentUser));
      
      await showAppShell();
      showToast(`Account created! Welcome to IAA Lost & Found, ${name}`, "success");
      if (data.notification) triggerSimulatedNotification(data.notification);
      document.getElementById("signup-form").reset();
    } else {
      showToast(data.error || "Registration failed.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to connect to backend server.", "error");
  }
}

// ================= VIEW SHELL CONTROLLER =================

function showOnboarding() {
  document.getElementById("onboarding-container").style.display = "flex";
  document.getElementById("app-shell").classList.add("hidden");
  toggleAuthMode("signin");
}

async function showAppShell() {
  document.getElementById("onboarding-container").style.display = "none";
  document.getElementById("app-shell").classList.remove("hidden");
  
  // Render user info card
  document.getElementById("profile-name").textContent = currentUser.name;
  document.getElementById("profile-avatar").textContent = currentUser.name.charAt(0).toUpperCase();
  
  const roleBadge = document.getElementById("profile-role");
  roleBadge.textContent = currentUser.role;
  roleBadge.className = `user-role-badge badge-${currentUser.role}`;
  
  // Update welcome greeting in dashboard
  const userDisplayId = currentUser.role === 'student' ? currentUser.reg_number : currentUser.role.toUpperCase();
  document.getElementById("welcome-message").innerHTML = `Hello, ${currentUser.name}! <span>(${userDisplayId})</span>`;
  
  // Toggle Admin / Security Navigation options based on User Roles
  const securityNav = document.getElementById("nav-security");
  const adminNav = document.getElementById("nav-admin");
  
  if (currentUser.role === "security") {
    securityNav.classList.remove("hidden");
    adminNav.classList.add("hidden");
  } else if (currentUser.role === "admin") {
    adminNav.classList.remove("hidden");
    securityNav.classList.remove("hidden"); // Admins can check security dashboard
  } else {
    securityNav.classList.add("hidden");
    adminNav.classList.add("hidden");
  }
  
  // Setup post items form date input to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById("post-date").value = today;
  
  // Change form fields dynamically in post item view
  const postType = document.getElementById("post-type");
  const storageContainer = document.getElementById("storage-container");
  
  // Reset event listener to prevent duplicates
  const newPostType = postType.cloneNode(true);
  postType.parentNode.replaceChild(newPostType, postType);
  
  newPostType.addEventListener("change", () => {
    if (newPostType.value === "found") {
      storageContainer.style.display = "flex";
    } else {
      storageContainer.style.display = "none";
    }
  });
  
  // Load databases from server
  await loadData();
  
  // Load dashboard
  switchView("dashboard");
}

async function switchView(viewName) {
  activeView = viewName;
  
  // Hide all panels
  document.querySelectorAll(".view-panel").forEach(p => p.classList.add("hidden"));
  
  // Show target panel
  document.getElementById(`view-${viewName}`).classList.remove("hidden");
  
  // Update active sidebar nav
  document.querySelectorAll(".nav-links li").forEach(li => li.classList.remove("active"));
  const targetNavLi = document.getElementById(`nav-${viewName}`);
  if (targetNavLi) targetNavLi.classList.add("active");
  
  // Render contents
  if (viewName === "dashboard") {
    await loadData();
    renderDashboard();
  } else if (viewName === "claims") {
    await loadData();
    renderMyClaimsAndPosts();
  } else if (viewName === "security") {
    if (currentUser.role !== "security" && currentUser.role !== "admin") {
      switchView("dashboard");
      return;
    }
    await loadData();
    renderSecurityPortal();
  } else if (viewName === "admin") {
    if (currentUser.role !== "admin") {
      switchView("dashboard");
      return;
    }
    await loadData();
    renderAdminPortal();
  }
}

function logout() {
  localStorage.removeItem("iaa_user");
  currentUser = null;
  showOnboarding();
  showToast("Logged out successfully.", "info");
}

// ================= DASHBOARD FEED & RENDERERS =================

function renderDashboard() {
  updateStats();
  applyFilters();
}

function updateStats() {
  const total = items.length;
  const lost = items.filter(i => i.type === "lost" && i.status !== "handed_over").length;
  const found = items.filter(i => i.type === "found" && i.status !== "handed_over").length;
  const resolved = items.filter(i => i.status === "handed_over").length;
  
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-lost").textContent = lost;
  document.getElementById("stat-found").textContent = found;
  document.getElementById("stat-resolved").textContent = resolved;
}

function applyFilters() {
  const searchQuery = document.getElementById("search-input").value.toLowerCase().trim();
  const categoryFilter = document.getElementById("filter-category").value;
  const typeFilter = document.getElementById("filter-type").value;
  
  const filtered = items.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery) || 
                          item.description.toLowerCase().includes(searchQuery) || 
                          item.location.toLowerCase().includes(searchQuery);
    
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    
    return matchesSearch && matchesCategory && matchesType;
  });
  
  const feedGrid = document.getElementById("items-feed-grid");
  feedGrid.innerHTML = "";
  
  if (filtered.length === 0) {
    feedGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; margin-bottom: 12px; stroke: var(--text-secondary); opacity: 0.5;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p>No lost or found items found matching your filters.</p>
      </div>
    `;
    return;
  }
  
  filtered.forEach(item => {
    const card = document.createElement("div");
    card.className = "item-card";
    
    const badgeClass = item.type === "lost" ? "badge-lost-type" : "badge-found-type";
    const categoryIcon = getCategoryIcon(item.category);
    
    const imageHtml = item.image 
      ? `<img src="${item.image}" alt="${item.title}" style="width: 100%; height: 100%; object-fit: cover;">`
      : categoryIcon;
    
    card.innerHTML = `
      <div class="item-image-placeholder">
        ${imageHtml}
        <span class="item-badge ${badgeClass}">${item.type}</span>
      </div>
      <div class="item-content">
        <div class="item-meta">
          <span>${formatDate(item.date_reported)}</span>
          <span style="text-transform: capitalize;">${item.category}</span>
        </div>
        <h4 class="item-title">${item.title}</h4>
        <p class="item-desc">${item.description}</p>
        
        <div class="item-details-row">
          <div class="detail-line">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
            <span>${item.location}</span>
          </div>
        </div>
      </div>
      <div class="item-footer">
        <div class="status-indicator status-${item.status}">
          <span class="status-dot"></span>
          <span>${item.status.replace('_', ' ')}</span>
        </div>
        <button class="view-details-btn" onclick="openItemDetails('${item.id}')">View details</button>
      </div>
    `;
    feedGrid.appendChild(card);
  });
}

function getCategoryIcon(cat) {
  switch (cat) {
    case "electronics":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
    case "documents":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case "keys":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11.5 11.5L22 1l2 2-2.5 2.5 1.5 1.5-1.5 1.5 1.5 1.5L20 13l-4-4"/></svg>`;
    case "books":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20M4 19.5V3.5A2.5 2.5 0 016.5 1H20v20H6.5a2.5 2.5 0 01-2.5-2.5z"/></svg>`;
    case "bags":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 18V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2zM12 2v2M6 8v12M18 8v12"/></svg>`;
    case "clothing":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l1.08 5.42a2 2 0 00.99 1.42L7 14v6a2 2 0 002 2h6a2 2 0 002-2v-6l2.65-1.47a2 2 0 00.99-1.42l1.08-5.42a2 2 0 00-1.34-2.23z"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
}

function formatDate(dateStr) {
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return new Date(dateStr).toLocaleDateString('en-US', options);
}

// ================= POST ITEM OPERATION =================

function updateMockFileName() {
  const fileInput = document.getElementById("post-file-mock");
  const fileNameSpan = document.getElementById("mock-file-name");
  if (fileInput.files.length > 0) {
    fileNameSpan.textContent = fileInput.files[0].name;
  } else {
    fileNameSpan.textContent = "No file chosen";
  }
}

function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

async function handlePostItem(e) {
  e.preventDefault();
  
  const title = document.getElementById("post-title").value.trim();
  const type = document.getElementById("post-type").value;
  const category = document.getElementById("post-category").value;
  const date = document.getElementById("post-date").value;
  const location = document.getElementById("post-location").value.trim();
  const desc = document.getElementById("post-desc").value.trim();
  
  const fileInput = document.getElementById("post-file-mock");
  let image = null;
  
  // Enforce image requirement for lost items
  if (type === "lost" && fileInput.files.length === 0) {
    showToast("⚠️ A photo of the lost item is required to submit a lost report.", "error");
    return;
  }
  
  if (fileInput.files.length > 0) {
    try {
      image = await convertFileToBase64(fileInput.files[0]);
    } catch (err) {
      console.error("Failed to read image file:", err);
      showToast("⚠️ Failed to process selected photo file.", "error");
      return;
    }
  }
  
  let storage = "";
  if (type === "found") {
    storage = document.getElementById("post-storage").value.trim() || "Main Security Gate Custody";
  }
  
  try {
    const res = await fetch(`${API_BASE}?action=items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        type,
        date,
        location,
        storage,
        desc,
        reporterId: currentUser.id,
        contact: currentUser.phone,
        image: image
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      showToast(`Item reported as ${type.toUpperCase()} successfully!`, "success");
      if (data.notification) triggerSimulatedNotification(data.notification);
      document.getElementById("report-item-form").reset();
      document.getElementById("mock-file-name").textContent = "No photo chosen (Required for lost reports)";
      await switchView("dashboard");
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to post report.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to submit item report to backend.", "error");
  }
}

// ================= MODAL CONTROLLER =================

function openModal(modalId) {
  document.getElementById(modalId).classList.add("active");
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("active");
}

function openItemDetails(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  
  document.getElementById("det-item-title").textContent = item.title;
  document.getElementById("det-item-desc").textContent = item.description;
  
  const typeBadge = document.getElementById("det-item-type");
  typeBadge.textContent = item.type.toUpperCase();
  typeBadge.className = `status-pill ${item.type === "lost" ? "pill-rejected" : "pill-approved"}`;
  
  // Render photo if stored in database
  const photoContainer = document.getElementById("det-item-photo-container");
  if (item.image) {
    photoContainer.innerHTML = `<img src="${item.image}" alt="${item.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px;">`;
  } else {
    photoContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>`;
  }
  
  document.getElementById("det-item-category").textContent = item.category.toUpperCase();
  document.getElementById("det-item-date").textContent = formatDate(item.date_reported);
  document.getElementById("det-item-location").textContent = item.location;
  
  const custodyRow = document.getElementById("det-item-custody-row");
  if (item.type === "found") {
    custodyRow.style.display = "flex";
    document.getElementById("det-item-custody").textContent = item.storage || "Main Security Desk";
  } else {
    custodyRow.style.display = "none";
  }
  
  document.getElementById("det-item-reporter").textContent = `${item.reporter_name} (${item.reporter_role.toUpperCase()})`;
  document.getElementById("det-item-contact").textContent = item.contact;
  
  const actionsContainer = document.getElementById("det-modal-actions-container");
  actionsContainer.innerHTML = "";
  
  const isOwner = (item.reporter_id === currentUser.id);
  
  if (isOwner && item.status !== "handed_over") {
    const btn = document.createElement("button");
    btn.className = "submit-btn";
    btn.style.margin = "0";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> Mark as Resolved`;
    btn.onclick = () => resolveMyReport(item.id);
    actionsContainer.appendChild(btn);
  } else if (!isOwner && item.type === "found" && item.status === "found" && currentUser.role !== "admin") {
    const btn = document.createElement("button");
    btn.className = "submit-btn";
    btn.style.margin = "0";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Claim This Item`;
    btn.onclick = () => initiateClaimForm(item.id);
    actionsContainer.appendChild(btn);
  } else if (item.status === "claimed") {
    const text = document.createElement("p");
    text.style.color = "var(--warning)";
    text.style.fontSize = "0.85rem";
    text.style.fontWeight = "600";
    text.textContent = "⚠️ Claim Verification In Progress by Campus Security";
    actionsContainer.appendChild(text);
  } else if (item.status === "handed_over") {
    const text = document.createElement("p");
    text.style.color = "var(--success)";
    text.style.fontSize = "0.85rem";
    text.style.fontWeight = "600";
    text.textContent = "✅ Item Handed Over & Case Resolved";
    actionsContainer.appendChild(text);
  }
  
  const closeBtn = document.createElement("button");
  closeBtn.className = "view-details-btn";
  closeBtn.style.flex = "1";
  closeBtn.textContent = "Close Panel";
  closeBtn.onclick = () => closeModal('item-details-modal');
  actionsContainer.appendChild(closeBtn);
  
  openModal('item-details-modal');
}

async function resolveMyReport(itemId) {
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=update_item_status&id=${itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "handed_over", actorEmail: userIdentifier })
    });
    
    if (res.ok) {
      showToast("Report marked as resolved!", "success");
      closeModal('item-details-modal');
      await switchView("dashboard");
    }
  } catch (err) {
    console.error(err);
    showToast("API Connection failed.", "error");
  }
}

// ================= CLAIM SUBMISSION =================

function initiateClaimForm(itemId) {
  closeModal('item-details-modal');
  
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  
  document.getElementById("claim-item-id").value = itemId;
  document.getElementById("claim-role-details-preview").textContent = `${currentUser.name} (${currentUser.role.toUpperCase()}) | Details: ${currentUser.details}`;
  document.getElementById("claim-proof-text").value = "";
  
  openModal('claim-submission-modal');
}

async function handleClaimItem(e) {
  e.preventDefault();
  
  const itemId = document.getElementById("claim-item-id").value;
  const proof = document.getElementById("claim-proof-text").value.trim();
  
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId,
        claimantId: currentUser.id,
        proof,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      closeModal('claim-submission-modal');
      showToast("Claim request submitted! Awaiting Campus Security verification.", "success");
      if (data.notifications) triggerSimulatedNotification(data.notifications);
      await switchView("dashboard");
    } else {
      const data = await res.json();
      showToast(data.error || "Claim submission failed.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("API Server Connection error.", "error");
  }
}

// ================= MY CLAIMS & POSTS VIEWS =================

function switchClaimsTab(tabName) {
  activeClaimsTab = tabName;
  document.querySelectorAll("#view-claims .tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll("#view-claims .tab-panel").forEach(p => p.classList.remove("active"));
  
  const clickedBtn = Array.from(document.querySelectorAll("#view-claims .tab-btn")).find(btn => btn.textContent.toLowerCase().includes(tabName));
  if (clickedBtn) clickedBtn.classList.add("active");
  
  document.getElementById(`claims-tab-${tabName}`).classList.add("active");
}

function renderMyClaimsAndPosts() {
  // Render user reported items table
  const userReports = items.filter(item => item.reporter_id === currentUser.id);
  const reportsTbody = document.getElementById("user-reports-table-body");
  reportsTbody.innerHTML = "";
  
  if (userReports.length === 0) {
    reportsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">You have not reported any items yet.</td></tr>`;
  } else {
    userReports.forEach(item => {
      const tr = document.createElement("tr");
      
      const typeBadge = item.type === "lost" ? "pill-rejected" : "pill-approved";
      const statusClass = item.status === "handed_over" ? "pill-approved" : "pill-pending";
      
      const resolveAction = item.status !== "handed_over" 
        ? `<button class="view-details-btn" onclick="resolveMyReport('${item.id}');">Resolve</button>`
        : `<span style="font-size:0.8rem; color: var(--success); font-weight:600;">Resolved</span>`;
      
      tr.innerHTML = `
        <td style="font-weight:600;">${item.title}</td>
        <td><span class="status-pill ${typeBadge}">${item.type}</span></td>
        <td style="text-transform: capitalize;">${item.category}</td>
        <td>${formatDate(item.date_reported)}</td>
        <td>${item.location}</td>
        <td><span class="status-pill ${statusClass}">${item.status.replace('_', ' ')}</span></td>
        <td>${resolveAction}</td>
      `;
      reportsTbody.appendChild(tr);
    });
  }
  
  // Render user claims table
  const userClaims = claims.filter(claim => claim.claimant_id === currentUser.id);
  const claimsTbody = document.getElementById("user-claims-table-body");
  claimsTbody.innerHTML = "";
  
  if (userClaims.length === 0) {
    claimsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-secondary);">You have not submitted any claim requests yet.</td></tr>`;
  } else {
    userClaims.forEach(claim => {
      let statusClass = "pill-pending";
      if (claim.status === "approved") statusClass = "pill-approved";
      if (claim.status === "rejected") statusClass = "pill-rejected";
      
      let actionRemarks = "-";
      if (claim.status === "approved") {
        actionRemarks = `Approved! ${claim.officer_remarks || ''}`;
      } else if (claim.status === "rejected") {
        actionRemarks = `Rejected: ${claim.reject_reason || ''}. ${claim.officer_remarks || ''}`;
      }
      
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:600;">${claim.item_title || 'Item Registry'}</td>
        <td>${claim.founder_name || 'Staff Desk'}</td>
        <td>${formatDate(claim.date_claimed)}</td>
        <td style="max-width: 250px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${claim.proof}">${claim.proof}</td>
        <td><span class="status-pill ${statusClass}">${claim.status}</span></td>
        <td style="font-size: 0.85rem; max-width: 200px;">${actionRemarks}</td>
      `;
      claimsTbody.appendChild(tr);
    });
  }
}

// ================= SECURITY OFFICER MANAGEMENT =================

function renderSecurityPortal() {
  const pendingClaims = claims.filter(c => c.status === "pending");
  const claimsContainer = document.getElementById("security-claims-container");
  claimsContainer.innerHTML = "";
  
  document.getElementById("sec-stat-active-claims").textContent = pendingClaims.length;
  document.getElementById("sec-stat-custody").textContent = items.filter(i => i.status === "found" || i.status === "claimed" || i.status === "in_custody").length;
  document.getElementById("sec-stat-resolved").textContent = items.filter(i => i.status === "handed_over").length;
  
  if (pendingClaims.length === 0) {
    claimsContainer.innerHTML = `
      <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius:16px; padding: 24px; text-align: center; color: var(--text-secondary);">
        <p>No active claim verification requests at this time.</p>
      </div>
    `;
  } else {
    pendingClaims.forEach(claim => {
      const card = document.createElement("div");
      card.className = "security-claim-card";
      
      card.innerHTML = `
        <div class="security-claim-main">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="status-pill pill-pending" style="font-size:0.65rem;">Pending Audit</span>
            <span style="font-size:0.75rem; color: var(--text-secondary);">${formatDate(claim.date_claimed)}</span>
          </div>
          <h4>Claim for: ${claim.item_title}</h4>
          
          <div class="security-claim-role-details">
            <span class="security-claim-info-item" style="font-weight:600; text-transform:uppercase;">
              Claimant: ${claim.claimant_name} (${claim.claimant_role})
            </span>
            <span class="security-claim-info-item">
              ${claim.claimant_details}
            </span>
          </div>
          
          <div class="security-claim-proof">
            <strong>Ownership Proof Description:</strong><br>
            "${claim.proof}"
          </div>
          
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">
            📍 Temporarily Custody: <strong>${claim.item_storage || 'Main Security Office'}</strong> | Reported by: ${claim.founder_name}
          </div>
        </div>
        
        <div class="security-claim-actions">
          <button class="btn-approve" onclick="approveClaim('${claim.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            Approve &amp; Handover
          </button>
          <button class="btn-reject" onclick="initiateRejectClaim('${claim.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            Reject Claim
          </button>
        </div>
      `;
      claimsContainer.appendChild(card);
    });
  }
  
  const itemsTbody = document.getElementById("sec-items-table-body");
  itemsTbody.innerHTML = "";
  
  items.forEach(item => {
    const tr = document.createElement("tr");
    
    let typeClass = item.type === "lost" ? "pill-rejected" : "pill-approved";
    let statusClass = "pill-pending";
    if (item.status === "handed_over") statusClass = "pill-approved";
    
    let actionContent = "-";
    if (item.status !== "handed_over") {
      actionContent = `
        <select onchange="updateItemCustodyStatus('${item.id}', this.value)" class="filter-select" style="padding: 4px 8px; font-size: 0.78rem; background-color: var(--bg-tertiary);">
          <option value="">-- Actions --</option>
          <option value="handed_over">Hand Over (Resolve)</option>
          ${item.type === "found" ? `
            <option value="found" ${item.status === 'found' ? 'selected' : ''}>Mark Found</option>
            <option value="in_custody" ${item.status === 'in_custody' ? 'selected' : ''}>Place in Custody</option>
          ` : ''}
        </select>
      `;
    }
    
    tr.innerHTML = `
      <td style="font-family: monospace; font-size:0.8rem;">${item.id}</td>
      <td style="font-weight:600;">${item.title}</td>
      <td style="font-size:0.8rem;">
        <strong>${item.reporter_name} (${item.reporter_role})</strong><br>
        ${item.reporter_details.split('|')[0]}<br>
        📞 ${item.contact}
      </td>
      <td><span class="status-pill ${typeClass}">${item.type}</span></td>
      <td>
        <input type="text" value="${item.storage || 'N/A'}" 
               onchange="updateItemCustodyLocation('${item.id}', this.value)"
               style="background-color: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; padding: 4px 8px; font-size: 0.8rem; width: 150px;"
               ${item.status === "handed_over" ? 'disabled' : ''}>
      </td>
      <td><span class="status-pill ${statusClass}">${item.status.replace('_', ' ')}</span></td>
      <td>${actionContent}</td>
    `;
    itemsTbody.appendChild(tr);
  });
}

async function approveClaim(claimId) {
  const officerNote = prompt("Enter verification remarks or signature:", "Identity verified. Item handed over to claimant at Security Desk.");
  if (officerNote === null) return;
  
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=verify_claim&id=${claimId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "approved",
        remarks: officerNote,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      showToast("Claim approved and item registered as Handed Over!", "success");
      if (data.notification) triggerSimulatedNotification(data.notification);
      await switchView("security");
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to approve claim.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("API Server Connection error.", "error");
  }
}

function initiateRejectClaim(claimId) {
  document.getElementById("reject-claim-id").value = claimId;
  document.getElementById("reject-details-text").value = "";
  openModal('reject-claim-modal');
}

async function handleRejectClaimAction(e) {
  e.preventDefault();
  
  const claimId = document.getElementById("reject-claim-id").value;
  const reason = document.getElementById("reject-reason").value;
  const remarks = document.getElementById("reject-details-text").value.trim();
  
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=verify_claim&id=${claimId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "rejected",
        remarks: remarks,
        reason: reason,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      closeModal('reject-claim-modal');
      showToast("Claim request rejected.", "error");
      if (data.notification) triggerSimulatedNotification(data.notification);
      await switchView("security");
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to process rejection.", "error");
    }
  } catch (err) {
    console.error(err);
    showToast("API Server Connection error.", "error");
  }
}

async function updateItemCustodyLocation(itemId, newLocation) {
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=update_item_status&id=${itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storage: newLocation,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      showToast(`Custody location updated to: "${newLocation}"`, "info");
    }
  } catch (err) {
    console.error(err);
    showToast("API Connection failed.", "error");
  }
}

async function updateItemCustodyStatus(itemId, newStatus) {
  if (!newStatus) return;
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=update_item_status&id=${itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      showToast(`Item status updated to: ${newStatus.toUpperCase()}`, "success");
      await switchView("security");
    }
  } catch (err) {
    console.error(err);
    showToast("API Connection failed.", "error");
  }
}

// ================= PRIVILEGED ADMINISTRATOR DESK =================

function switchAdminTab(tabName) {
  activeAdminTab = tabName;
  document.querySelectorAll("#view-admin .tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll("#view-admin .tab-panel").forEach(p => p.classList.remove("active"));
  
  const clickedBtn = document.getElementById(`btn-admin-${tabName}`);
  if (clickedBtn) clickedBtn.classList.add("active");
  
  document.getElementById(`admin-tab-${tabName}`).classList.add("active");
}

function renderAdminPortal() {
  document.getElementById("admin-stat-users").textContent = users.length;
  document.getElementById("admin-stat-items").textContent = items.length;
  document.getElementById("admin-stat-claims").textContent = claims.length;
  
  renderAdminUsersTable();
  renderAdminItemsRegistry();
  renderAdminLogsTimeline();
}

function renderAdminUsersTable() {
  const tbody = document.getElementById("admin-users-table-body");
  tbody.innerHTML = "";
  
  users.forEach(user => {
    const tr = document.createElement("tr");
    
    let badgeClass = "badge-guest";
    if (user.role === "student") badgeClass = "badge-student";
    if (user.role === "staff") badgeClass = "badge-staff";
    if (user.role === "lecturer") badgeClass = "badge-lecturer";
    if (user.role === "security") badgeClass = "badge-security";
    if (user.role === "admin") badgeClass = "badge-admin";
    
    const isSelf = user.id === currentUser.id;
    const userIdentifier = user.reg_number || user.email;
    
    const deleteAction = isSelf 
      ? `<span style="font-size:0.75rem; color:var(--text-secondary);">Current Session</span>`
      : `<button class="btn-reject" style="padding:4px 8px; font-size:0.75rem;" onclick="adminDeleteUser('${user.id}')">Delete Account</button>`;
      
    const roleChangeSelect = isSelf ? "-" : `
      <select onchange="adminChangeUserRole('${user.id}', this.value)" class="filter-select" style="padding: 4px; font-size:0.75rem; background-color: var(--bg-tertiary);">
        <option value="">Change Role</option>
        <option value="student" ${user.role === 'student' ? 'disabled' : ''}>Student</option>
        <option value="staff" ${user.role === 'staff' ? 'disabled' : ''}>Staff</option>
        <option value="lecturer" ${user.role === 'lecturer' ? 'disabled' : ''}>Lecturer</option>
        <option value="security" ${user.role === 'security' ? 'disabled' : ''}>Security</option>
        <option value="admin" ${user.role === 'admin' ? 'disabled' : ''}>Administrator</option>
      </select>
    `;
    
    tr.innerHTML = `
      <td style="font-weight:600;">${user.name}</td>
      <td>${userIdentifier}</td>
      <td>${user.phone}</td>
      <td><span class="user-role-badge ${badgeClass}">${user.role}</span></td>
      <td style="font-size:0.8rem; max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${user.details}">${user.details}</td>
      <td>
        <div style="display:flex; gap:8px; align-items:center;">
          ${roleChangeSelect}
          ${deleteAction}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function adminChangeUserRole(userId, newRole) {
  if (!newRole) return;
  
  const user = users.find(u => u.id === parseInt(userId));
  if (!user) return;
  
  let roleDetails = "";
  if (newRole === "security") {
    roleDetails = `Badge No: IAA-SEC-${Date.now().toString().slice(-3)} | Rank: Corporal | Station: Head Desk`;
  } else if (newRole === "admin") {
    roleDetails = `Admin ID: IAA-ADM-${Date.now().toString().slice(-3)} | Promoted`;
  } else if (newRole === "student") {
    roleDetails = `Reg No: IMC-01-${Date.now().toString().slice(-4)}-2026 | Course: BBA Year 1`;
  } else {
    roleDetails = `Staff ID: IAA-ST-${Date.now().toString().slice(-4)} | Admin Assigned`;
  }
  
  try {
    const userIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=admin_update_role&id=${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: newRole,
        details: roleDetails,
        actorEmail: userIdentifier
      })
    });
    
    if (res.ok) {
      showToast(`Updated user role successfully!`, "success");
      await switchView("admin");
    }
  } catch (err) {
    console.error(err);
    showToast("API Connection failed.", "error");
  }
}

async function adminDeleteUser(userId) {
  const user = users.find(u => u.id === parseInt(userId));
  if (!user) return;
  const userIdentifier = user.reg_number || user.email;

  if (!confirm(`Are you sure you want to completely delete the account for: ${userIdentifier}?`)) {
    return;
  }
  
  try {
    const actorIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=admin_delete_user&id=${userId}`, {
      method: "POST", // Simple PHP endpoint mapping delete actions via POST requests
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorEmail: actorIdentifier })
    });
    
    if (res.ok) {
      showToast("User account successfully deleted.", "success");
      await switchView("admin");
    }
  } catch (err) {
    console.error(err);
    showToast("API server failure.", "error");
  }
}

function renderAdminItemsRegistry() {
  const tbody = document.getElementById("admin-items-table-body");
  tbody.innerHTML = "";
  
  items.forEach(item => {
    const tr = document.createElement("tr");
    
    const typeBadge = item.type === "lost" ? "pill-rejected" : "pill-approved";
    const statusClass = item.status === "handed_over" ? "pill-approved" : "pill-pending";
    
    tr.innerHTML = `
      <td style="font-family: monospace; font-size:0.75rem;">${item.id}</td>
      <td style="font-weight:600;">${item.title}</td>
      <td><span class="status-pill ${typeBadge}">${item.type}</span></td>
      <td>${item.reporter_name} (${item.reporter_role})</td>
      <td><span class="status-pill ${statusClass}">${item.status.replace('_', ' ')}</span></td>
      <td>
        <button class="btn-reject" style="padding:4px 8px; font-size:0.75rem;" onclick="adminModerateDeleteItem('${item.id}')">Delete Item Override</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function adminModerateDeleteItem(itemId) {
  if (!confirm("Are you sure you want to administratively remove this item from the portal database?")) {
    return;
  }
  
  try {
    const actorIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=admin_delete_item&id=${itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorEmail: actorIdentifier })
    });
    
    if (res.ok) {
      showToast("Item removed from registry override.", "success");
      await switchView("admin");
    }
  } catch (err) {
    console.error(err);
    showToast("API Connection failure.", "error");
  }
}

function renderAdminLogsTimeline() {
  const container = document.getElementById("admin-logs-timeline");
  container.innerHTML = "";
  
  if (auditLogs.length === 0) {
    container.innerHTML = `<p style="color:var(--text-secondary); text-align:center; padding:16px;">Timeline is empty.</p>`;
    return;
  }
  
  auditLogs.forEach(log => {
    const card = document.createElement("div");
    card.className = "audit-log-card";
    
    card.innerHTML = `
      <div class="audit-log-content">
        <span class="audit-log-message">${log.message}</span>
        <div class="audit-log-meta">
          <span class="audit-log-time">🕒 ${log.timestamp}</span>
          <span>By:</span>
          <span class="audit-log-badge">${log.user_identifier}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function clearAuditLogs() {
  if (!confirm("Are you sure you want to clear the entire timeline history of audit logs?")) return;
  try {
    const actorIdentifier = currentUser.reg_number || currentUser.email;
    const res = await fetch(`${API_BASE}?action=logs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorEmail: actorIdentifier })
    });
    
    if (res.ok) {
      showToast("System logs cleared.", "info");
      await switchView("admin");
    }
  } catch (err) {
    console.error(err);
    showToast("Failed to clear logs.", "error");
  }
}

// ================= TOAST SYSTEM UTILITIES =================

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  
  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.remove();
  });
  
  container.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = "slideInRight 0.3s ease-in reverse";
      setTimeout(() => toast.remove(), 250);
    }
  }, 4000);
}

// ================= PRINT WEEKLY REPORT (ADMIN) =================

function printWeeklyReport() {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);
  
  // Filter items reported in the past 7 days
  const weeklyItems = items.filter(item => {
    const reportDate = new Date(item.date_reported);
    return reportDate >= sevenDaysAgo && reportDate <= today;
  });
  
  // Build Print Layout
  const printDiv = document.createElement("div");
  printDiv.id = "print-section";
  
  const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedToday = today.toLocaleDateString('en-US', dateOptions);
  const formattedStart = sevenDaysAgo.toLocaleDateString('en-US', dateOptions);
  
  let tableRows = "";
  if (weeklyItems.length === 0) {
    tableRows = `<tr><td colspan="7" style="text-align: center; color: #666; padding: 20px;">No items reported in the last 7 days.</td></tr>`;
  } else {
    weeklyItems.forEach(item => {
      tableRows += `
        <tr>
          <td>${formatDate(item.date_reported)}</td>
          <td style="font-weight: bold;">${item.title}</td>
          <td style="text-transform: capitalize;">${item.category}</td>
          <td style="text-transform: uppercase; font-weight: 600;">${item.type}</td>
          <td>${item.location}</td>
          <td>${item.storage || 'Main Security Custody'}</td>
          <td style="font-weight: bold; text-transform: uppercase;">${item.status.replace('_', ' ')}</td>
        </tr>
      `;
    });
  }
  
  printDiv.innerHTML = `
    <div class="print-header">
      <img src="assets/iaa_logo_square.jpg" alt="IAA Logo">
      <h1>Institute of Accountancy Arusha</h1>
      <h2>Lost & Found Portal - Weekly Audit Report</h2>
    </div>
    
    <div class="print-meta-grid">
      <div><strong>Report Generation Date:</strong> ${formattedToday}</div>
      <div><strong>Audit Period Timeframe:</strong> ${formattedStart} to ${formattedToday}</div>
      <div><strong>Generated By:</strong> ${currentUser.name} (Portal Administrator)</div>
      <div><strong>Total Items Tracked This Week:</strong> ${weeklyItems.length}</div>
    </div>
    
    <h3 style="margin-top: 24px; font-family: Arial, sans-serif;">Weekly Items Registry log</h3>
    <table class="print-table">
      <thead>
        <tr>
          <th>Date Reported</th>
          <th>Item Title / Name</th>
          <th>Category</th>
          <th>Type</th>
          <th>Campus Location</th>
          <th>Custody Desk</th>
          <th>Current Status</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    <div style="margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 0.9rem;">
      <div style="border-top: 1px solid #000000; padding-top: 8px; text-align: center;">
        <strong>Prepared By:</strong><br>
        Administrative Desk Authority<br>
        Signature: __________________________
      </div>
      <div style="border-top: 1px solid #000000; padding-top: 8px; text-align: center;">
        <strong>Verified By:</strong><br>
        Campus Security Chief Officer<br>
        Signature: __________________________
      </div>
    </div>
  `;
  
  document.body.appendChild(printDiv);
  window.print();
  document.body.removeChild(printDiv);
}

// ================= SIMULATED NOTIFICATION HANDLER =================

function triggerSimulatedNotification(notif) {
  if (!notif) return;
  
  if (Array.isArray(notif)) {
    notif.forEach(n => triggerSimulatedNotification(n));
    return;
  }
  
  // Display email notification toast alert
  if (notif.email) {
    showToast(`✉️ <strong>Email Dispatched successfully</strong><br>To: ${notif.email}<br><strong>Subj:</strong> ${notif.subject}<br><em>${notif.body}</em>`, "info");
  }
  
  // Display SMS notification toast alert
  if (notif.phone) {
    showToast(`📱 <strong>SMS Sent successfully</strong><br>To: ${notif.phone}<br><strong>Msg:</strong> ${notif.body}`, "success");
  }
}
