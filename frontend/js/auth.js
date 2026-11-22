const FRONTEND_URL = window.location.origin;
const BASE_URL = `${FRONTEND_URL}/api`;

function saveSession(payload) {
    localStorage.setItem("token", payload.token);
    localStorage.setItem("role", payload.role || payload.user?.role || "");
    localStorage.setItem("user_name", payload.user?.name || "");
    localStorage.setItem("user", JSON.stringify(payload.user || {}));
}

function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user_name");
    localStorage.removeItem("user");
    window.location.href = `${FRONTEND_URL}/index.html`;
}

function ensureAuthenticated() {
    if (!getToken()) {
        window.location.href = `${FRONTEND_URL}/index.html`;
    }
}

async function apiFetch(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token"),
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        logout();
        throw new Error("Session expired. Please log in again.");
    }

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
        throw new Error(payload?.message || "Request failed.");
    }

    return payload;
}

function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer") || createToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
        if (!container.children.length) {
            container.remove();
        }
    }, 3200);
}

function createToastContainer() {
    const container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
    return container;
}

function setLoading(isLoading) {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) return;
    overlay.classList.toggle("show", isLoading);
}

function initTheme() {
    // Theme toggle wiped by user request
    localStorage.removeItem("smrms_theme");
    document.body.classList.remove("dark-mode");
}

function initPage(pageKey) {
    document.body.classList.add("page-ready");
    initTheme();

    renderSidebar(pageKey);

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    const exportCsvBtn = document.getElementById("exportCsvBtn");
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener("click", () => {
            const table = document.querySelector("table");
            if (!table) {
                showToast("No data table found on this page to export.", "error");
                return;
            }
            const rows = Array.from(table.querySelectorAll("tr"));
            const csvContent = rows.map(row => {
                const cells = Array.from(row.querySelectorAll("th, td"));
                return cells.map(cell => `"${cell.innerText.replace(/"/g, '""').trim()}"`).join(",");
            }).join("\n");

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const pageName = window.location.pathname.split("/").pop().replace(".html", "") || "data";
            a.download = `smrms_${pageName}_export.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(`Exported ${pageName} to CSV successfully.`);
        });
    }

    const user = getUser();
    const userName = document.getElementById("userName");
    const userRole = document.getElementById("userRole");
    if (userName) userName.textContent = user?.name || localStorage.getItem("user_name") || "Guest";
    if (userRole) userRole.textContent = (localStorage.getItem("role") || user?.role || "").toUpperCase();

    const role = (localStorage.getItem("role") || "").toLowerCase();
    if (getToken() && role !== "doctor" && document.querySelector(`a[data-page="pharmacy"]`)) {
        checkLowStockAlert();
    }
}

function renderSidebar(pageKey) {
    const role = (localStorage.getItem("role") || "").toLowerCase();
    const navLinksContainer = document.querySelector(".nav-links");
    if (!navLinksContainer) return;

    let linksHtml = `<a href="/dashboard.html" class="nav-link ${pageKey === 'dashboard' ? 'active' : ''}" data-page="dashboard">⌂ Dashboard</a>`;

    if (role === "admin") {
        linksHtml += `
            <a href="/patients.html" class="nav-link ${pageKey === 'patients' ? 'active' : ''}" data-page="patients">☉ Patients</a>
            <a href="/appointments.html" class="nav-link ${pageKey === 'appointments' ? 'active' : ''}" data-page="appointments">📅 Appointments</a>
            <a href="/pharmacy.html" class="nav-link ${pageKey === 'pharmacy' ? 'active' : ''}" data-page="pharmacy">⚗ Inventory</a>
            <a href="/billing.html" class="nav-link ${pageKey === 'billing' ? 'active' : ''}" data-page="billing">💳 Billing Center</a>
        `;
    } else if (role === "doctor") {
        linksHtml += `
            <a href="/patients.html" class="nav-link ${pageKey === 'patients' ? 'active' : ''}" data-page="patients">☉ Patients</a>
            <a href="/records.html" class="nav-link ${pageKey === 'records' ? 'active' : ''}" data-page="records">✎ Clinical Records</a>
            <a href="/appointments.html" class="nav-link ${pageKey === 'appointments' ? 'active' : ''}" data-page="appointments">📅 Appointments</a>
            <a href="/pharmacy.html" class="nav-link ${pageKey === 'pharmacy' ? 'active' : ''}" data-page="pharmacy">⚗ Prescriptions</a>
        `;
    } else if (role === "receptionist") {
        linksHtml += `
            <a href="/patients.html" class="nav-link ${pageKey === 'patients' ? 'active' : ''}" data-page="patients">☉ Patients</a>
            <a href="/appointments.html" class="nav-link ${pageKey === 'appointments' ? 'active' : ''}" data-page="appointments">📅 Appointments</a>
            <a href="/billing.html" class="nav-link ${pageKey === 'billing' ? 'active' : ''}" data-page="billing">💳 Billing Center</a>
        `;
    }

    navLinksContainer.innerHTML = linksHtml;
}

function canAccess(action) {
    const role = (localStorage.getItem("role") || "").toLowerCase();
    const permissions = {
        "admin": ["view_patients", "view_records", "manage_users", "manage_inventory", "view_appointments", "manage_hospital", "view_dashboard"],
        "doctor": ["view_patients", "view_records", "write_records", "prescribe", "view_appointments", "view_medicines", "view_prescriptions", "update_appointment_status", "view_dashboard"],
        "receptionist": ["view_patients", "manage_patients", "view_appointments", "manage_appointments", "update_appointment_status", "view_dashboard"]
    };
    return (permissions[role] || []).includes(action);
}

async function checkLowStockAlert() {
    try {
        const response = await apiFetch("/pharmacy/low-stock");
        if (response.data && response.data.length > 0) {
            const link = document.querySelector(`a[data-page="pharmacy"]`);
            if (link && !link.innerHTML.includes("dot")) {
                link.innerHTML += `<span class="dot" style="background:#ef4444; width:8px; height:8px; border-radius:50%; display:inline-block; margin-left:6px;"></span>`;
            }
        }
    } catch (e) {
        console.error("Low stock check failed", e);
    }
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
}

function sanitize(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("page-ready");
    initTheme();
});
