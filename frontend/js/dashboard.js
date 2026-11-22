(() => {
    // ================================================================
    // DASHBOARD.JS — Role-Aware Dashboard Controller
    //
    // FIX: Dashboard is accessible to ALL authenticated users.
    //      We only check if the user is logged in (token), NOT role.
    //
    // RULE: Each role loads DIFFERENT data from DIFFERENT endpoints:
    //   - Admin   → /dashboard/stats (all system data)
    //   - Doctor  → /dashboard/doctor-view (own patients/appts only)
    //   - Receptionist → /dashboard/receptionist-view (clinic ops)
    // ================================================================

    document.addEventListener("DOMContentLoaded", async () => {
        // ✅ Only checks if user is authenticated — NOT role
        ensureAuthenticated();
        initPage("dashboard");

        const role = (localStorage.getItem("role") || "").toLowerCase();

        // Hide all views first, then show only the one matching role
        document.querySelectorAll(".role-view").forEach(v => v.classList.add("hidden"));

        if (role === "admin") {
            document.getElementById("adminView").classList.remove("hidden");
            document.getElementById("dashboardTitle").innerHTML =
                "<h2>Dashboard Overview</h2><p>Real-time hospital metrics, diagnosis trends, and recent clinical activity.</p>";
            await loadAdminDashboard();

        } else if (role === "doctor") {
            document.getElementById("doctorView").classList.remove("hidden");
            document.getElementById("dashboardTitle").innerHTML =
                "<h2>My Dashboard</h2><p>Today's consultations, patient records, and clinical activity.</p>";
            // Set today's date in the pill
            const todayEl = document.getElementById("docTodayDate");
            if (todayEl) todayEl.textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
            await loadDoctorDashboard();

        } else if (role === "receptionist") {
            document.getElementById("receptionistView").classList.remove("hidden");
            document.getElementById("dashboardTitle").innerHTML =
                "<h2>Reception Desk</h2><p>Managing patient flow, scheduling, and clinic operations.</p>";
            await loadReceptionistDashboard();
        }
    });

    // ================================================================
    //  ADMIN DASHBOARD LOADER
    //  Calls admin-only endpoints for full system analytics
    // ================================================================
    async function loadAdminDashboard() {
        try {
            setLoading(true);

            // Fetch all admin-level data in parallel
            const [
                { data: stats },
                { data: patients },
                { data: medicines },
                { data: lowStock }
            ] = await Promise.all([
                apiFetch("/dashboard/stats"),
                apiFetch("/patients/"),
                apiFetch("/pharmacy/medicines"),
                apiFetch("/pharmacy/low-stock"),
            ]);

            // KPI Cards
            document.getElementById("totalPatients").textContent = stats.total_patients;
            document.getElementById("totalRecords").textContent = stats.total_records;
            document.getElementById("totalPrescriptions").textContent = stats.total_prescriptions;
            document.getElementById("activeDoctors").textContent = stats.active_doctors;
            document.getElementById("totalRevenue").textContent = `₹${stats.total_revenue?.toLocaleString() || 0}`;

            // Charts
            let monthlyPatients = [], stockOverview = [];
            try {
                const [mpRes, soRes] = await Promise.all([
                    apiFetch("/dashboard/monthly_patients"),
                    apiFetch("/dashboard/stock_overview")
                ]);
                monthlyPatients = mpRes.data;
                stockOverview = soRes.data;
            } catch (e) {
                console.error("Failed to load chart endpoints:", e);
            }

            renderLineChart("patientTrendChart", monthlyPatients || []);
            renderDiseaseBar("diseaseChart", stats.common_diseases || []);
            renderGenderDonut("genderChart", "genderTotalCount", stats.gender_split || {}, patients);
            renderRecentActivity(stats.recent_activity || []);

        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }

        // Admin-only sections
        await loadAdminRequests();
        await loadAuditLogs();
    }

    // ================================================================
    //  DOCTOR DASHBOARD LOADER
    //  Calls /dashboard/doctor-view — backend filters by doctor's ID
    //  Doctor only sees data related to THEIR OWN patients
    // ================================================================
    async function loadDoctorDashboard() {
        try {
            setLoading(true);

            // Build local date string YYYY-MM-DD (e.g. "2026-04-23" in IST)
            // This prevents the UTC timezone mismatch that causes zero-count bugs
            const localDate = new Date().toLocaleDateString("en-CA"); // en-CA = YYYY-MM-DD format

            // Backend filters everything by the authenticated doctor's ID
            const { data } = await apiFetch(`/dashboard/doctor-view?date=${localDate}`);

            // KPI Cards — doctor-specific stats
            const appointmentsToday = data.appointments_today || [];
            
            // Only show patients who have been CHECKED-IN by receptionist
            const checkedInToday = appointmentsToday.filter(a => a.status === "checked_in");
            const treatedPatients = data.stats?.patients_treated ?? 0;
            
            document.getElementById("docPatientsTreated").textContent = treatedPatients;

            // Render "My Appointments Today" — only showing checked_in
            renderDoctorAppts(checkedInToday);

            // Top Conditions
            renderDiseaseBar("docConditionChart", data.top_conditions || []);

            // Recent Diagnoses
            renderDoctorDiagnoses(data.recent_diagnoses || []);

        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    // ================================================================
    //  RECEPTIONIST DASHBOARD LOADER
    //  Calls /dashboard/receptionist-view — clinic-wide appointment data
    // ================================================================
    async function loadReceptionistDashboard() {
        try {
            setLoading(true);
            const localDate = new Date().toLocaleDateString("en-CA");
            const { data } = await apiFetch(`/dashboard/receptionist-view?date=${localDate}`);

            // Filter: only show active appointments for today
            const activeToday = (data.appointments_today || []).filter(a => a.status !== "completed");
            
            // Global Patient Count
            document.getElementById("recepTotalPatients").textContent = data.stats.total_patients || 0;
            document.getElementById("recepApptsToday").textContent = activeToday.length;
            document.getElementById("recepPendingInvoices").textContent = data.stats.unpaid_bills || 0;
            
            // Global Upcoming Checked-in Count (Across all days)
            const upcomingCheckedIn = data.upcoming_checked_in || [];
            const upCountEl = document.getElementById("upcomingCount");
            if (upCountEl) upCountEl.textContent = `${upcomingCheckedIn.length} Active`;

            renderLineChart("recepTrendChart", data.monthly_registrations || []);
            renderRecepAppts(activeToday); 
            renderUpcoming(upcomingCheckedIn);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    // ================================================================
    //  SHARED CHART RENDERERS — Reusable across all views
    // ================================================================

    // Line chart for patient registrations trend — used by Admin + Receptionist
    function renderLineChart(canvasId, items) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (!items || !items.length) {
            ctx.parentNode.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--text-muted);">No data available</div>';
            return;
        }
        const key = canvasId + "Obj";
        if (window[key]) window[key].destroy();
        window[key] = new Chart(ctx, {
            type: "line",
            data: {
                labels: items.map(i => i.month),
                datasets: [{
                    label: "Patient Registrations",
                    data: items.map(i => i.count),
                    borderColor: "#2563EB",
                    backgroundColor: "rgba(37, 99, 235, 0.2)",
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: "#2563EB",
                    pointRadius: 4,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            },
        });
    }

    // Horizontal bar chart for diagnoses — used by Admin + Doctor
    function renderDiseaseBar(canvasId, items) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (!items || !items.length) {
            ctx.parentNode.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--text-muted);">No diagnosis records yet</div>';
            return;
        }
        const key = canvasId + "Obj";
        if (window[key]) window[key].destroy();
        window[key] = new Chart(ctx, {
            type: "bar",
            data: {
                labels: items.map(i => i.name),
                datasets: [{
                    label: "Cases",
                    data: items.map(i => i.count),
                    backgroundColor: ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"],
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
            },
        });
    }

    // Doughnut for Admin gender split — uses patient data
    function renderGenderDonut(canvasId, countElId, genderSplit, patients) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        // Fallback: compute from patients array if genderSplit is empty
        if (!genderSplit || !Object.keys(genderSplit).length) {
            genderSplit = patients.reduce((acc, p) => {
                const k = p.gender || "Unknown";
                acc[k] = (acc[k] || 0) + 1;
                return acc;
            }, {});
        }
        const maleCount = genderSplit.Male || 0;
        const femaleCount = genderSplit.Female || 0;
        const total = maleCount + femaleCount;
        const el = document.getElementById(countElId);
        if (el) el.textContent = total;

        const key = canvasId + "Obj";
        if (window[key]) window[key].destroy();
        window[key] = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Male", "Female"],
                datasets: [{ data: [maleCount, femaleCount], backgroundColor: ["#2563EB", "#10B981"], cutout: "70%", borderWidth: 0 }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
            },
        });
    }

    // Horizontal bar for stock levels — Admin only
    function renderStockBar(canvasId, items) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (!items || !items.length) {
            ctx.parentNode.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--text-muted);">No inventory available</div>';
            return;
        }
        const key = canvasId + "Obj";
        if (window[key]) window[key].destroy();
        window[key] = new Chart(ctx, {
            type: "bar",
            data: {
                labels: items.map(i => i.name),
                datasets: [{
                    label: "Stock",
                    data: items.map(i => i.stock),
                    backgroundColor: items.map(i => i.stock > 50 ? "#10B981" : (i.stock >= 10 ? "#F59E0B" : "#EF4444")),
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true } }
            },
        });
    }

    // HMS 2.0: Pie chart for departmental distribution
    function renderDeptChart(canvasId, items) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        const key = canvasId + "Obj";
        if (window[key]) window[key].destroy();
        window[key] = new Chart(ctx, {
            type: "pie",
            data: {
                labels: items.map(i => i.name),
                datasets: [{
                    data: items.map(i => i.count),
                    backgroundColor: ["#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#D97706", "#059669"],
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } }
            },
        });
    }

    // ================================================================
    //  ADMIN TABLE RENDERERS
    // ================================================================

    function renderRecentActivity(items) {
        const tbody = document.getElementById("activityTableBody");
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No recent clinical activity yet.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(item => `
            <tr>
                <td>${sanitize(item.patient_name)}</td>
                <td>${sanitize(item.doctor_name || "N/A")}</td>
                <td>${sanitize(item.diagnosis || "No diagnosis")}</td>
                <td>${formatDate(item.date)}</td>
            </tr>
        `).join("");
    }

    async function loadAdminRequests() {
        const section = document.getElementById("adminRequestsSection");
        if (section) section.classList.remove("hidden");
        try {
            const response = await apiFetch("/admin/pending-requests");
            renderSignupRequests(response.data || {});
            showSignupRequestTab("admin");
        } catch (error) {
            ["adminRequestsTableBody", "doctorRequestsTableBody", "receptionistRequestsTableBody"].forEach(id => {
                const tbody = document.getElementById(id);
                if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${sanitize(error.message)}</td></tr>`;
            });
        }
    }

    function renderSignupRequests(groupedItems) {
        renderRequestTable("adminRequestsTableBody", groupedItems.admin || [], "No pending admin signup requests.");
        renderRequestTable("doctorRequestsTableBody", groupedItems.doctor || [], "No pending doctor signup requests.");
        renderRequestTable("receptionistRequestsTableBody", groupedItems.receptionist || [], "No pending receptionist signup requests.");
    }

    function renderRequestTable(bodyId, items, emptyMessage) {
        const tbody = document.getElementById(bodyId);
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${sanitize(emptyMessage)}</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(item => `
            <tr>
                <td>${sanitize(item.name)}</td>
                <td>${sanitize(item.email)}</td>
                <td>${formatDate(item.requested_at)}</td>
                <td>
                    <div class="actions">
                        <button class="btn btn-accent" onclick="approveSignupRequest('${item._id}')">Approve</button>
                        <button class="btn btn-danger" onclick="rejectSignupRequest('${item._id}')">Reject</button>
                    </div>
                </td>
            </tr>
        `).join("");
    }

    window.showSignupRequestTab = (role) => {
        const tabs = ["admin", "doctor", "receptionist"];
        tabs.forEach(name => {
            const panel = document.getElementById(`${name}RequestsTab`);
            const btn = document.getElementById(`${name}RequestsTabBtn`);
            if (panel) panel.classList.toggle("hidden", name !== role);
            if (btn) {
                btn.classList.toggle("btn-primary", name === role);
                if (name !== role) btn.classList.remove("btn-primary");
            }
        });
    };

    async function loadAuditLogs() {
        const section = document.getElementById("auditLogsSection");
        if (!section) return;
        section.classList.remove("hidden");
        try {
            const response = await apiFetch("/admin/audit-logs");
            const tbody = document.getElementById("auditLogsTableBody");
            if (!response.data || !response.data.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No audit logs found.</td></tr>`;
                return;
            }
            tbody.innerHTML = response.data.map(log => {
                let colorClass = "", inlineStyle = "";
                if (log.action === "create") colorClass = "success-text";
                else if (log.action === "update") inlineStyle = "color:#F59E0B;background:rgba(245,158,11,0.12);";
                else if (log.action === "delete") colorClass = "danger-text";
                return `<tr>
                    <td>${formatDate(log.timestamp)}</td>
                    <td>${sanitize(log.userName)}</td>
                    <td>${sanitize(log.role)}</td>
                    <td><span class="pill ${colorClass}" style="${inlineStyle}">${sanitize(log.action)}</span></td>
                    <td>${sanitize(log.targetEntity)}</td>
                    <td>${sanitize(log.details)}</td>
                </tr>`;
            }).join("");
        } catch (error) {
            console.error("Audit log error", error);
        }
    }

    // ================================================================
    //  DOCTOR TABLE RENDERERS
    // ================================================================

    // My Appointments Today — "Start Session" hidden for cancelled/completed
    function renderDoctorAppts(items) {
        const tbody = document.getElementById("docApptsTableBody");
        
        // Filter out completed and cancelled per user request
        const activeItems = items.filter(a => {
            const s = (a.status || "pending").toLowerCase();
            return s !== "completed" && s !== "cancelled";
        });

        if (!activeItems.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No active appointments scheduled for today.</td></tr>`;
            return;
        }
        tbody.innerHTML = activeItems.map(a => {
            const status = (a.status || "pending").toLowerCase();
            let statusClass = "", statusStyle = "";
            if (status === "checked_in") statusStyle = "color:#10B981;background:rgba(16,185,129,0.12);";
            else if (status === "completed") statusClass = "success-text";
            else if (status === "cancelled") statusClass = "danger-text";
            else statusStyle = "color:#F59E0B;background:rgba(245,158,11,0.12);"; // pending/confirmed

            // FIX: Only show "Start Session" for active appointments.
            // Cancelled or completed appointments must NOT have this button.
            const canStart = status !== "cancelled" && status !== "completed";
            const actionHtml = canStart
                ? `<a href="/records.html?patient_id=${a.patient_id}&app_id=${a._id}" class="btn btn-primary" style="font-size:0.75rem;padding:4px 10px;">Start Session</a>`
                : `<span style="font-size:0.75rem;color:var(--text-muted);font-style:italic;">${status === "cancelled" ? "Cancelled" : "Done"}</span>`;

            return `
            <tr>
                <td>${sanitize(a.time)}</td>
                <td style="font-weight:600;">${sanitize(a.patient_name)}</td>
                <td><span class="pill ${statusClass}" style="${statusStyle}">${sanitize(status.replace("_", " ").toUpperCase())}</span></td>
                <td><div class="actions">${actionHtml}</div></td>
            </tr>`;
        }).join("");
    }

    // Recent Diagnoses: renamed from recent activity, doctor-filtered
    function renderDoctorDiagnoses(items) {
        const tbody = document.getElementById("docRecentDiagnosesBody");
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No diagnosis records yet.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(r => `
            <tr>
                <td>${sanitize(r.patient_name)}</td>
                <td>${sanitize(r.diagnosis)}</td>
                <td>${formatDate(r.date)}</td>
            </tr>
        `).join("");
    }

    // HMS 2.0: Recent Lab Results for Doctor
    function renderRecentLabs(items) {
        const tbody = document.getElementById("docRecentLabsBody");
        if (!tbody) return;
        if (!items || !items.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No lab results available.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(lb => `
            <tr>
                <td>${sanitize(lb.patient_name)}</td>
                <td>${sanitize(lb.test_name)}</td>
                <td style="color:#2563EB; font-weight:600;">${sanitize(lb.result_data || "Pending summary")}</td>
            </tr>
        `).join("");
    }

    // Recent Prescriptions — last 5 created by this doctor
    function renderDoctorPrescriptions(items) {
        const tbody = document.getElementById("docRecentPrescriptionsBody");
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No recent prescriptions.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(p => `
            <tr>
                <td>${sanitize(p.patient_name)}</td>
                <td>${(p.medicines || []).map(m => `${sanitize(m.name)} ×${m.qty}`).join(", ")}</td>
                <td>${formatDate(p.date)}</td>
            </tr>
        `).join("");
    }

    // ================================================================
    //  RECEPTIONIST TABLE RENDERERS
    // ================================================================

    // Full clinic appointment schedule for today
    function renderRecepAppts(items) {
        const tbody = document.getElementById("recepApptsTableBody");
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No appointments scheduled for today.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(a => {
            let acts = "";
            // Only confirmed appointments can be checked in
            if (a.status === "confirmed") {
                acts = `<button class="btn btn-accent" style="font-size:0.75rem;padding:4px 8px;" onclick="checkinAppt('${a._id}')">Check-in</button>`;
            } else if (a.status === "completed") {
                acts = `<button class="btn btn-primary" style="font-size:0.75rem;padding:4px 8px;background:#10B981;border:0" onclick="generateBill('${a._id}')">Generate Bill</button>`;
            }
            let statusStyle = "";
            if (a.status === "checked_in") statusStyle = "color:#10B981;background:rgba(16,185,129,0.12);";
            else if (a.status === "pending") statusStyle = "color:#F59E0B;background:rgba(245,158,11,0.12);";
            return `
            <tr>
                <td>${sanitize(a.time)}</td>
                <td style="font-weight:600;">${sanitize(a.patient_name)}</td>
                <td>${sanitize(a.doctor_name)}</td>
                <td><span class="pill" style="${statusStyle}">${sanitize((a.status || "pending").replace("_", " ").toUpperCase())}</span></td>
                <td><div class="actions">${acts}</div></td>
            </tr>`;
        }).join("");
    }

    // Walk-in queue: patients with checked_in status
    function renderUpcoming(appts) {
        const tbody = document.getElementById("upcomingApptsTableBody");
        if (!tbody) return;
        if (!appts.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No upcoming sessions.</td></tr>`;
            return;
        }

        tbody.innerHTML = appts.map(a => `
            <tr>
                <td><strong>${sanitize(a.patient_name)}</strong></td>
                <td><small>${sanitize(a.doctor_name)}</small></td>
                <td><span class="pill" style="font-size:0.7rem;">${sanitize(a.date)}</span></td>
            </tr>
        `).join("");
    }

    // Check-in handler for receptionist — updates appt status to "checked_in"
    window.checkinAppt = async (id) => {
        try {
            setLoading(true);
            await apiFetch(`/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "checked_in" }) });
            showToast("Patient checked in successfully.");
            await loadReceptionistDashboard();
        } catch (e) {
            showToast(e.message, "error");
        } finally {
            setLoading(false);
        }
    };

    window.generateBill = async (apptId) => {
        try {
            setLoading(true);
            await apiFetch(`/billing/generate/${apptId}`, { method: "POST" });
            showToast("Invoice generated successfully.");
            await loadReceptionistDashboard();
        } catch (e) {
            showToast(e.message, "error");
        } finally {
            setLoading(false);
        }
    };

    // ================================================================
    //  ADMIN ACTION HANDLERS
    // ================================================================

    async function approveSignupRequest(requestId) {
        try {
            setLoading(true);
            const response = await apiFetch(`/admin/approve/${requestId}`, { method: "PATCH" });
            showToast(response.message || "Signup request approved.");
            await loadAdminRequests();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    async function rejectSignupRequest(requestId) {
        try {
            setLoading(true);
            const response = await apiFetch(`/admin/reject/${requestId}`, { method: "DELETE" });
            showToast(response.message || "Signup request rejected.");
            await loadAdminRequests();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    window.approveSignupRequest = approveSignupRequest;
    window.rejectSignupRequest = rejectSignupRequest;
})();
