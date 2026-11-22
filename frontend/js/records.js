(() => {
    // ================================================================
    // RECORDS.JS
    //
    // Features:
    // 1. Role-aware: doctor/admin can create records
    // 2. FORM PERSISTENCE: drafts saved to localStorage
    // 3. FINISH CONSULTATION: mark appointment as completed
    // 4. EDIT/DELETE: doctors can manage their past records
    // ================================================================

    const DRAFT_KEY = "smrms_record_draft";
    let patientsCache = [];
    let activeAppointmentId = null; 
    let editingRecordId = null; // Track if we are editing an existing record

    document.addEventListener("DOMContentLoaded", async () => {
        ensureAuthenticated();
        initPage("records");

        const params = new URLSearchParams(window.location.search);
        activeAppointmentId = params.get("app_id");

        if (canAccess("write_records")) {
            document.getElementById("recordForm").addEventListener("submit", submitRecordForm);

            ["recordPatient", "recordVisitType", "recordSymptoms", "recordDiagnosis", "recordNotes"].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener("input", saveDraft);
                if (id === "recordPatient" && el) {
                    el.addEventListener("change", async (e) => {
                        const val = e.target.value;
                        if (!val) {
                            activeAppointmentId = null;
                            hideBanner();
                            await loadRecords();
                            return;
                        }
                        await syncActiveAppointment(val, { showSessionBanner: true });
                        await loadRecords(val);
                    });
                }
            });

            const clearBtn = document.getElementById("clearDraftBtn");
            if (clearBtn) clearBtn.addEventListener("click", clearDraft);

        } else {
            const gridTwo = document.querySelector(".grid-two");
            if (gridTwo) gridTwo.style.display = "none";
        }

        await Promise.all([loadPatientsForRecords(), loadRecords()]);
        setupConsultationBanner();
    });

    // ================================================================
    // CONSULTATION BANNER
    // ================================================================

    function setupConsultationBanner() {
        const params = new URLSearchParams(window.location.search);
        const patientId = params.get("patient_id");
        if (!patientId) return;
        syncActiveAppointment(patientId, { showSessionBanner: true }).catch(() => {});
    }

    async function syncActiveAppointment(patientId, options = {}) {
        const { showSessionBanner = false } = options;
        const params = new URLSearchParams(window.location.search);
        const urlAppId = params.get("app_id");
        const response = await apiFetch(`/appointments/?patient_id=${encodeURIComponent(patientId)}&status=checked_in`);
        const appts = response.data || [];
        const match = appts.find(a => a._id === urlAppId) || appts[0] || null;
        activeAppointmentId = match?._id || null;
        if (showSessionBanner) {
            if (match) showBanner(match);
            else hideBanner();
        }
        return match;
    }

    function hideBanner() {
        const banner = document.getElementById("consultationBanner");
        if (!banner) return;
        banner.classList.add("hidden");
        banner.style.display = "none";
    }

    function showBanner(appt) {
        const banner = document.getElementById("consultationBanner");
        const nameEl = document.getElementById("consultationPatientName");
        if (!banner || !nameEl) return;

        nameEl.textContent = `${appt.patient_name || "Patient"}`;
        banner.classList.remove("hidden");
        banner.style.display = "flex";
        banner.style.gap = "15px";

        banner.innerHTML = `
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:12px; height:12px; border-radius:50%; background:#2563EB; animation: pulse 2s infinite;"></div>
                    <strong id="consultationPatientName" style="font-size:1.1rem; color:var(--text);">${sanitize(appt.patient_name)}</strong>
                    <span class="pill" style="font-size:0.7rem; background:rgba(37,99,235,0.1);">ACTIVE SESSION</span>
                </div>
                <p style="margin:4px 0 0; color:var(--muted); font-size:0.85rem;">
                    Clinical record and prescription selection locked to this patient.
                </p>
            </div>
            <div style="display:flex; gap:10px;">
                <a href="/pharmacy.html?patient_id=${appt.patient_id}&app_id=${appt._id}" class="btn" style="background:#6366f1; color:white; font-size:0.85rem; display:flex; align-items:center; gap:6px;">
                    💊 Prescriptions
                </a>
                <button id="finishConsultationBtn" class="btn btn-accent" style="font-size:0.85rem;">
                    ✔ Finish Consultation
                </button>
            </div>
        `;

        document.getElementById("finishConsultationBtn").addEventListener("click", finishConsultation);
    }

    async function finishConsultation() {
        if (!activeAppointmentId) {
            showToast("No active appointment ID found.", "error");
            return;
        }

        try {
            setLoading(true);
            // Mark appointment as completed.
            // The backend now generates or refreshes the invoice for this appointment.
            await apiFetch(`/appointments/${activeAppointmentId}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status: "completed" }),
            });

            const banner = document.getElementById("consultationBanner");
            if (banner) {
                banner.style.borderLeftColor = "#10B981";
                banner.style.background = "rgba(16,185,129,0.05)";
                banner.innerHTML = `
                    <div style="flex:1;">
                        <strong style="color:#10B981; font-size:1.1rem;">✔ Consultation Completed</strong>
                        <p style="margin:4px 0 0; color:var(--muted); font-size:0.85rem;">
                            Patient session finished. Appointment marked as completed and invoice prepared automatically.
                        </p>
                    </div>
                    <a href="/dashboard.html" class="btn btn-primary" style="white-space:nowrap;">← Back to Dashboard</a>
                `;
            }

            // Restore dropdown
            const select = document.getElementById("recordPatient");
            if (select) select.disabled = false;

            clearDraft();
            showToast("Consultation completed successfully.");
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    // ================================================================
    // FORM DRAFT & EDITING
    // ================================================================

    function saveDraft() {
        if (editingRecordId) return; // Don't save drafts while editing an existing record

        const draft = {
            patient: document.getElementById("recordPatient")?.value || "",
            visitType: document.getElementById("recordVisitType")?.value || "checkup",
            symptoms: document.getElementById("recordSymptoms")?.value || "",
            diagnosis: document.getElementById("recordDiagnosis")?.value || "",
            notes: document.getElementById("recordNotes")?.value || "",
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

        const indicator = document.getElementById("draftIndicator");
        if (indicator) {
            indicator.style.display = "inline";
            clearTimeout(indicator._hideTimer);
            indicator._hideTimer = setTimeout(() => { indicator.style.display = "none"; }, 2000);
        }
    }

    function restoreDraft() {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return;
            const draft = JSON.parse(raw);

            if (draft.symptoms) document.getElementById("recordSymptoms").value = draft.symptoms;
            if (draft.diagnosis) document.getElementById("recordDiagnosis").value = draft.diagnosis;
            if (draft.notes) document.getElementById("recordNotes").value = draft.notes;
            if (draft.visitType) document.getElementById("recordVisitType").value = draft.visitType;

            if (draft.patient) {
                const sel = document.getElementById("recordPatient");
                if (sel.options.length > 1) sel.value = draft.patient;
                else sel.dataset.pendingValue = draft.patient;
            }
        } catch (e) { console.warn("Could not restore draft:", e); }
    }
    function clearDraft() {
        localStorage.removeItem(DRAFT_KEY);
        const ind = document.getElementById("draftIndicator");
        if (ind) ind.style.display = "none";
    }

    // ================================================================
    // DATA LOADING
    // ================================================================

    async function loadPatientsForRecords() {
        try {
            // Fetch patients and all currently checked-in appointments for this doctor
            const [patRes, apptRes] = await Promise.all([
                apiFetch("/patients/"),
                apiFetch("/appointments/?status=checked_in")
            ]);
            
            patientsCache = patRes.data || [];
            const checkedInAppts = apptRes.data || [];
            
            // Map of patient IDs that are READY for consultation
            // STRICTURE: Doctor Only sees those with status 'checked_in'
            const activePatientIds = new Set(
                checkedInAppts.filter(a => a.status === "checked_in").map(a => str(a.patient_id))
            );

            const select = document.getElementById("recordPatient");
            
            // Filter: show if they have an active appt OR if it's the current session
            const params = new URLSearchParams(window.location.search);
            const activeId = params.get("patient_id");

            const filteredPatients = patientsCache.filter(p => {
                if (str(p._id) === activeId) return true; 
                return activePatientIds.has(str(p._id));
            });

            select.innerHTML = `<option value="">Select patient</option>` + filteredPatients
                .map(p => `<option value="${p._id}">${sanitize(p.name)} (${sanitize(p.contact)})</option>`)
                .join("");

            // Session LOCK logic
            if (activeId) {
                select.value = activeId;
                select.disabled = true; // LOCK dropdown during active session
                await syncActiveAppointment(activeId, { showSessionBanner: true });
                await loadRecords(activeId);
            } else {
                select.disabled = false;
                const pending = select.dataset.pendingValue;
                if (pending) {
                    select.value = pending;
                    delete select.dataset.pendingValue;
                    await syncActiveAppointment(pending);
                }
            }

        } catch (error) { showToast(error.message, "error"); }
    }

    // Helper for ObjectId comparison
    function str(oid) {
        return typeof oid === 'object' ? oid._id : String(oid);
    }

    async function loadRecords(patientId = "") {
        try {
            setLoading(true);
            const endpoint = patientId ? `/records/${patientId}` : "/records/";
            const response = await apiFetch(endpoint);
            renderRecords(response.data);
        } catch (error) { showToast(error.message, "error"); }
        finally { setLoading(false); }
    }

    // ================================================================
    // SUBMISSION (POST & PUT)
    // ================================================================

    async function submitRecordForm(event) {
        event.preventDefault();
        const patientId = document.getElementById("recordPatient").value;
        const symptomsValue = document.getElementById("recordSymptoms").value.trim();
        const diagnosis = document.getElementById("recordDiagnosis").value.trim();
        const notes = document.getElementById("recordNotes").value.trim();

        if (!patientId || !symptomsValue || !diagnosis) {
            showToast("Patient, symptoms, and diagnosis are required.", "error");
            return;
        }

        const payload = {
            patient_id: patientId,
            appointment_id: activeAppointmentId || "",
            symptoms: symptomsValue.split(",").map(s => s.trim()).filter(Boolean),
            diagnosis,
            notes,
            visitType: document.getElementById("recordVisitType")?.value || "checkup",
        };

        try {
            setLoading(true);
            if (editingRecordId) {
                await apiFetch(`/records/${editingRecordId}`, { method: "PUT", body: JSON.stringify(payload) });
                showToast("Record updated successfully.");
            } else {
                await apiFetch("/records/", { method: "POST", body: JSON.stringify(payload) });
                showToast("Diagnosis record saved successfully.");
            }

            clearDraft();
            document.getElementById("recordPatient").value = patientId;
            await loadRecords(patientId);
        } catch (error) { showToast(error.message, "error"); }
        finally { setLoading(false); }
    }

    // ================================================================
    // EDIT & DELETE ACTIONS
    // ================================================================


    // ================================================================
    // RENDER
    // ================================================================

    function renderRecords(records) {
        const tbody = document.getElementById("recordsTableBody");

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No records available.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => {
            return `
            <tr>
                <td>${sanitize(r.patient_name || findPatientName(r.patient_id))}</td>
                <td>${sanitize(r.doctor_name || "N/A")}</td>
                <td><span class="pill" style="font-size:0.75rem;">${sanitize((r.visitType || "checkup").toUpperCase())}</span></td>
                <td>${(r.symptoms || []).map(s => `<span class="pill">${sanitize(s)}</span>`).join(" ")}</td>
                <td>${sanitize(r.diagnosis)}</td>
                <td>${sanitize(r.notes || "-")}</td>
                <td>${formatDate(r.date)}</td>
            </tr>
        `; }).join("");
    }

    function findPatientName(patientId) {
        return patientsCache.find(p => str(p._id) === str(patientId))?.name || "Unknown Patient";
    }

    // ================================================================
    // GLOBAL HELPERS
    // ================================================================

    window.addSymptom = function (symptom) {
        const input = document.getElementById("recordSymptoms");
        if (!input) return;
        let current = input.value.trim();
        let list = current.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        if (!list.includes(symptom.toLowerCase())) {
            input.value = current ? (current.endsWith(",") ? current + " " + symptom : current + ", " + symptom) : symptom;
            saveDraft();
        }
    };

    restoreDraft();
})();
