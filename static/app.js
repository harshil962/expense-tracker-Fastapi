const API = "/api";
const TOKEN_KEY = "expense_tracker_token";
const USER_KEY = "expense_tracker_user";

const CATEGORY_COLORS = {
  Food: "#f97316", Transport: "#3b82f6", Shopping: "#ec4899",
  Entertainment: "#a855f7", Bills: "#ef4444", Health: "#16a34a",
  Education: "#0ea5e9", Travel: "#eab308", Groceries: "#22c55e", Other: "#6b7280"
};

let categories = [];
let categoryChart, trendChart;
let currentOrder = "desc";

const el = (id) => document.getElementById(id);

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Wrapper around fetch that attaches the Bearer token and
// handles 401s by bouncing back to the login screen.
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = options.headers || {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    showAuthScreen();
    throw new Error("Session expired. Please log in again.");
  }
  return res;
}

function fmtMoney(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function showToast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

async function loadCategories() {
  const res = await apiFetch("/categories");
  categories = await res.json();
  const filterSel = el("categoryFilter");
  const formSel = el("category");
  categories.forEach(c => {
    filterSel.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`);
    formSel.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`);
  });
}

function buildQuery() {
  const params = new URLSearchParams();
  const search = el("searchInput").value.trim();
  const category = el("categoryFilter").value;
  const start = el("startDate").value;
  const end = el("endDate").value;
  const sortBy = el("sortBy").value;

  if (search) params.append("search", search);
  if (category && category !== "All") params.append("category", category);
  if (start) params.append("start_date", start);
  if (end) params.append("end_date", end);
  params.append("sort_by", sortBy);
  params.append("order", currentOrder);
  return params.toString();
}

async function loadExpenses() {
  const query = buildQuery();
  const res = await apiFetch(`/expenses?${query}`);
  const data = await res.json();
  renderTable(data);
}

async function loadSummary() {
  const start = el("startDate").value;
  const end = el("endDate").value;
  const params = new URLSearchParams();
  if (start) params.append("start_date", start);
  if (end) params.append("end_date", end);
  const res = await apiFetch(`/summary?${params.toString()}`);
  const data = await res.json();
  renderStats(data);
  renderCharts(data);
}

function renderStats(data) {
  el("statTotal").textContent = fmtMoney(data.total);
  el("statCount").textContent = data.count;
  el("statAvg").textContent = fmtMoney(data.average);
  const entries = Object.entries(data.by_category);
  if (entries.length) {
    entries.sort((a, b) => b[1] - a[1]);
    el("statTop").textContent = entries[0][0];
  } else {
    el("statTop").textContent = "—";
  }
}

function renderCharts(data) {
  const catEntries = Object.entries(data.by_category);
  const catLabels = catEntries.map(e => e[0]);
  const catValues = catEntries.map(e => e[1]);
  const catColors = catLabels.map(c => CATEGORY_COLORS[c] || "#999");

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(el("categoryChart"), {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [{ data: catValues, backgroundColor: catColors, borderWidth: 2, borderColor: "#fff" }]
    },
    options: {
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      cutout: "60%"
    }
  });

  const monthEntries = Object.entries(data.by_month);
  const monthLabels = monthEntries.map(e => e[0]);
  const monthValues = monthEntries.map(e => e[1]);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(el("trendChart"), {
    type: "line",
    data: {
      labels: monthLabels,
      datasets: [{
        label: "Spent",
        data: monthValues,
        borderColor: "#6d5ef7",
        backgroundColor: "rgba(109,94,247,0.1)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: "#6d5ef7"
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderTable(rows) {
  const body = el("expenseBody");
  const empty = el("emptyState");
  body.innerHTML = "";

  if (!rows.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  rows.forEach(r => {
    const color = CATEGORY_COLORS[r.category] || "#999";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.title)}</strong></td>
      <td><span class="cat-badge" style="background:${color}22;color:${color}">${r.category}</span></td>
      <td>${formatDate(r.date)}</td>
      <td class="amount-cell">${fmtMoney(r.amount)}</td>
      <td class="notes-cell" title="${escapeHtml(r.notes || '')}">${escapeHtml(r.notes || '—')}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit="${r.id}" title="Edit">✏️</button>
          <button class="icon-btn danger" data-del="${r.id}" title="Delete">🗑️</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => openEditModal(btn.dataset.edit));
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteExpense(btn.dataset.del));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(d) {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function refreshAll() {
  await loadExpenses();
  await loadSummary();
}

// Modal handling
function openAddModal() {
  el("modalTitle").textContent = "Add Expense";
  el("expenseForm").reset();
  el("expenseId").value = "";
  el("date").value = new Date().toISOString().slice(0, 10);
  el("modalOverlay").classList.add("active");
}

async function openEditModal(id) {
  const res = await apiFetch(`/expenses/${id}`);
  if (!res.ok) return;
  const data = await res.json();
  el("modalTitle").textContent = "Edit Expense";
  el("expenseId").value = data.id;
  el("title").value = data.title;
  el("amount").value = data.amount;
  el("category").value = data.category;
  el("date").value = data.date;
  el("notes").value = data.notes || "";
  el("modalOverlay").classList.add("active");
}

function closeModal() {
  el("modalOverlay").classList.remove("active");
}

async function deleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  const res = await apiFetch(`/expenses/${id}`, { method: "DELETE" });
  if (res.ok) {
    showToast("Expense deleted");
    refreshAll();
  } else {
    showToast("Failed to delete");
  }
}

async function submitForm(e) {
  e.preventDefault();
  const id = el("expenseId").value;
  const payload = {
    title: el("title").value.trim(),
    amount: parseFloat(el("amount").value),
    category: el("category").value,
    date: el("date").value,
    notes: el("notes").value.trim() || null
  };

  const url = id ? `/expenses/${id}` : `/expenses`;
  const method = id ? "PUT" : "POST";

  const res = await apiFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast(id ? "Expense updated" : "Expense added");
    closeModal();
    refreshAll();
  } else {
    const err = await res.json();
    showToast(err.detail || "Something went wrong");
  }
}

// --- Auth flow ---
function showAuthScreen() {
  el("authScreen").style.display = "flex";
  el("mainApp").style.display = "none";
}

function showMainApp() {
  const user = getStoredUser();
  el("authScreen").style.display = "none";
  el("mainApp").style.display = "block";
  if (user) {
    el("userName").textContent = user.name;
    el("userAvatar").textContent = user.name.charAt(0).toUpperCase();
  }
}

function toggleAuthForms(showRegister) {
  el("loginForm").style.display = showRegister ? "none" : "block";
  el("registerForm").style.display = showRegister ? "block" : "none";
  el("tabLogin").classList.toggle("active", !showRegister);
  el("tabRegister").classList.toggle("active", showRegister);
  el("authSubtitle").textContent = showRegister
    ? "Create an account to get started"
    : "Sign in to manage your expenses";
  el("loginError").textContent = "";
  el("registerError").textContent = "";
}

async function handleLogin(e) {
  e.preventDefault();
  el("loginError").textContent = "";
  const email = el("loginEmail").value.trim();
  const password = el("loginPassword").value;

  const body = new URLSearchParams();
  body.append("username", email);
  body.append("password", password);

  const res = await fetch(`${API}/auth/login`, { method: "POST", body });
  const data = await res.json();

  if (!res.ok) {
    el("loginError").textContent = data.detail || "Login failed";
    return;
  }
  setSession(data.access_token, data.user);
  showMainApp();
  await initAppData();
}

async function handleRegister(e) {
  e.preventDefault();
  el("registerError").textContent = "";
  const name = el("registerName").value.trim();
  const email = el("registerEmail").value.trim();
  const password = el("registerPassword").value;

  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
  const data = await res.json();

  if (!res.ok) {
    el("registerError").textContent = data.detail || "Registration failed";
    return;
  }
  setSession(data.access_token, data.user);
  showMainApp();
  await initAppData();
}

function handleLogout() {
  clearSession();
  showAuthScreen();
  el("loginForm").reset();
}

async function initAppData() {
  // reset chart instances and category list since a different user may log in
  categories = [];
  el("categoryFilter").innerHTML = '<option value="All">All Categories</option>';
  el("category").innerHTML = "";
  await loadCategories();
  await refreshAll();
}

// Event bindings
window.addEventListener("DOMContentLoaded", async () => {
  el("loginForm").addEventListener("submit", handleLogin);
  el("registerForm").addEventListener("submit", handleRegister);
  el("tabLogin").addEventListener("click", () => toggleAuthForms(false));
  el("tabRegister").addEventListener("click", () => toggleAuthForms(true));
  el("logoutBtn").addEventListener("click", handleLogout);

  if (getToken()) {
    showMainApp();
    try {
      await initAppData();
    } catch (err) {
      // apiFetch already redirects to auth screen on 401
    }
  } else {
    showAuthScreen();
  }

  el("openAddModal").addEventListener("click", openAddModal);
  el("closeModal").addEventListener("click", closeModal);
  el("cancelForm").addEventListener("click", closeModal);
  el("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  el("expenseForm").addEventListener("submit", submitForm);

  let debounceTimer;
  el("searchInput").addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadExpenses, 300);
  });
  el("categoryFilter").addEventListener("change", refreshAll);
  el("startDate").addEventListener("change", refreshAll);
  el("endDate").addEventListener("change", refreshAll);
  el("sortBy").addEventListener("change", loadExpenses);

  el("orderToggle").addEventListener("click", () => {
    currentOrder = currentOrder === "desc" ? "asc" : "desc";
    el("orderToggle").textContent = currentOrder === "desc" ? "↓ Desc" : "↑ Asc";
    loadExpenses();
  });

  el("clearFilters").addEventListener("click", () => {
    el("searchInput").value = "";
    el("categoryFilter").value = "All";
    el("startDate").value = "";
    el("endDate").value = "";
    el("sortBy").value = "date";
    currentOrder = "desc";
    el("orderToggle").textContent = "↓ Desc";
    refreshAll();
  });
});