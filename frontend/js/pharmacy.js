(() => {
    let medicineCache = [];
    let patientCache = [];

    let activeAppointmentId = null;

    document.addEventListener("DOMContentLoaded", async () => {
        ensureAuthenticated();
        initPage("pharmacy");
        applyPharmacyRBAC();
        bindPharmacyEvents();
        await Promise.all([loadMedicines(), loadPatients(), loadPrescriptions()]);
        setupConsultationBanner();
    });

    // ================================================================
    // CONSULTATION BANNER
    // ================================================================

    function setupConsultationBanner() {
        const params = new URLSearchParams(window.location.search);
        const patientId = params.get("patient_id");
        if (!patientId) return;
        syncActiveAppointment(patientId, { showSessionBanner: true }).catch(console.error);
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
        if (!banner) return;
        banner.classList.remove("hidden");
        banner.style.display = "flex";
        banner.style.gap = "15px";

        banner.innerHTML = `
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:12px; height:12px; border-radius:50%; background:#2563EB; animation: pulse 2s infinite;"></div>
                    <strong style="font-size:1.1rem; color:var(--text);">${sanitize(appt.patient_name)}</strong>
                    <span class="pill" style="font-size:0.7rem; background:rgba(37,99,235,0.1);">ACTIVE SESSION</span>
                </div>
                <p style="margin:4px 0 0; color:var(--muted); font-size:0.85rem;">
                    Medicine selection locked. Save your prescription and finish the session.
                </p>
            </div>
            <div style="display:flex; gap:10px;">
                <a href="/records.html?patient_id=${appt.patient_id}&app_id=${appt._id}" class="btn" style="background:#4f46e5; color:white; font-size:0.85rem; display:flex; align-items:center; gap:6px;">
                    ✎ Diagnosis Record
                </a>
                <button id="finishConsultationBtn" class="btn btn-accent" style="font-size:0.85rem;">
                    ✔ Finish Consultation
                </button>
            </div>
        `;

        document.getElementById("finishConsultationBtn").addEventListener("click", finishConsultation);
    }

    async function finishConsultation() {
        if (!activeAppointmentId) return;
        try {
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
            const select = document.getElementById("prescriptionPatient");
            if (select) select.disabled = false;
            showToast("Consultation completed successfully.");
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    function applyPharmacyRBAC() {
        if (!canAccess("manage_inventory")) {
            const addMedicinePanel = document.getElementById("medicineForm").closest(".panel");
            if (addMedicinePanel) addMedicinePanel.style.display = "none";
        }
        
        if (!canAccess("prescribe")) {
            const addPrescriptionPanel = document.getElementById("prescriptionForm").closest(".panel");
            if (addPrescriptionPanel) addPrescriptionPanel.style.display = "none";
        }
    }

    function bindPharmacyEvents() {
        document.getElementById("medicineForm").addEventListener("submit", submitMedicineForm);
        document.getElementById("prescriptionForm").addEventListener("submit", submitPrescriptionForm);
        document.getElementById("addPrescriptionRow").addEventListener("click", addPrescriptionRow);
        document.getElementById("prescriptionPatient").addEventListener("change", async (e) => {
            const patientId = e.target.value;
            if (!patientId) {
                activeAppointmentId = null;
                hideBanner();
                return;
            }
            await syncActiveAppointment(patientId, { showSessionBanner: true });
        });
        
        document.getElementById("medicineSearch").addEventListener("input", filterMedicines);
        document.getElementById("clearMedicineSearch").addEventListener("click", clearSearch);
        
        document.getElementById("closeMedicineModal").addEventListener("click", closeMedicineModal);
        document.getElementById("medicineDetailModal").addEventListener("click", (e) => {
            if(e.target.id === "medicineDetailModal") closeMedicineModal();
        });
        document.getElementById("restockForm").addEventListener("submit", submitRestock);

        addPrescriptionRow();
    }

    async function loadMedicines() {
        try {
            const response = await apiFetch("/pharmacy/medicines");
            medicineCache = response.data;
            renderMedicines();
            populateMedicineSelects();
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    async function loadPatients() {
        try {
            const [patRes, apptRes] = await Promise.all([
                apiFetch("/patients/"),
                apiFetch("/appointments/?status=checked_in")
            ]);
            
            patientCache = patRes.data || [];
            const checkedInAppts = apptRes.data || [];
            
            // STRICTURE: Only show patients with 'checked_in' status
            const activePatientIds = new Set(
                checkedInAppts.filter(a => a.status === "checked_in").map(a => str(a.patient_id))
            );

            const select = document.getElementById("prescriptionPatient");
            const params = new URLSearchParams(window.location.search);
            const activeId = params.get("patient_id");

            const filteredPatients = patientCache.filter(p => {
                if (str(p._id) === activeId) return true;
                return activePatientIds.has(str(p._id));
            });

            select.innerHTML = `<option value="">Select patient</option>` + filteredPatients
                .map((patient) => `<option value="${patient._id}">${sanitize(patient.name)}</option>`)
                .join("");

            if (activeId) {
                select.value = activeId;
                select.disabled = true; // LOCK dropdown
                await syncActiveAppointment(activeId, { showSessionBanner: true });
            } else {
                select.disabled = false;
            }
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    function str(oid) {
        return typeof oid === 'object' ? oid._id : String(oid);
    }

    async function loadPrescriptions() {
        try {
            const response = await apiFetch("/pharmacy/prescriptions");
            renderPrescriptions(response.data);
        } catch (error) {
            showToast(error.message, "error");
        }
    }

    function renderMedicinesArray(medicinesArray) {
        const tbody = document.getElementById("medicinesTableBody");
        if (!medicinesArray.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No medicines found.</td></tr>`;
            return;
        }

        tbody.innerHTML = medicinesArray
            .map(
                (medicine) => {
                    let statusBadge = "";
                    if (medicine.stock > 50) statusBadge = `<span class="pill success-text">Healthy Stock</span>`;
                    else if (medicine.stock >= 10) statusBadge = `<span class="pill" style="color: #F59E0B; background: rgba(245,158,11,0.12);">Low Stock</span>`;
                    else statusBadge = `<span class="pill danger-text">Critical</span>`;
                    
                    return `
                    <tr class="clickable-row" style="cursor: pointer;" onclick="openMedicineModal('${medicine._id}')">
                        <td>${sanitize(medicine.name)}</td>
                        <td>Rs. ${Number(medicine.price).toFixed(2)}</td>
                        <td>${sanitize(medicine.stock)}</td>
                        <td>${statusBadge}</td>
                    </tr>
                    `;
                }
            )
            .join("");
    }

    function filterMedicines() {
        const query = document.getElementById("medicineSearch").value.trim().toLowerCase();
        const clearBtn = document.getElementById("clearMedicineSearch");
        clearBtn.style.display = query.length > 0 ? "block" : "none";
        
        if (!query) {
            renderMedicinesArray(medicineCache);
            return;
        }
        
        const filtered = medicineCache.filter(m => m.name.toLowerCase().includes(query));
        renderMedicinesArray(filtered);
    }
    
    function clearSearch() {
        document.getElementById("medicineSearch").value = "";
        filterMedicines();
    }

    function renderMedicines() {
        filterMedicines();
    }

    async function submitMedicineForm(event) {
        event.preventDefault();
        const nameInput = document.getElementById("medicineName").value.trim();
        const priceInput = document.getElementById("medicinePrice").value.trim();
        const stockInput = document.getElementById("medicineStock").value.trim();

        if (!nameInput || !priceInput || !stockInput) {
            showToast("Please fill in medicine name, price, and stock.", "error");
            return;
        }

        const exactMatch = medicineCache.find(m => m.name.toLowerCase() === nameInput.toLowerCase());
        if (exactMatch) {
            showToast("Medicine already exists. Click on it in the table to restock.", "error");
            return;
        }

        const payload = {
            name: nameInput,
            price: priceInput,
            stock: stockInput,
        };

        try {
            setLoading(true);
            await apiFetch("/pharmacy/medicines", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            document.getElementById("medicineForm").reset();
            showToast("Medicine inventory updated.");
            await loadMedicines();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    window.openMedicineModal = function(id) {
        if (!canAccess("manage_inventory")) return; // Only inventory managers can view details/restock
        const medicine = medicineCache.find(m => m._id === id);
        if (!medicine) return;
        
        document.getElementById("modalMedicineName").textContent = sanitize(medicine.name);
        document.getElementById("modalMedicinePrice").textContent = Number(medicine.price).toFixed(2);
        document.getElementById("modalMedicineStock").textContent = medicine.stock;
        
        let statusText = "Critical", statusClass = "danger-text", statusStyle = "";
        if (medicine.stock > 50) { statusText = "Healthy Stock"; statusClass = "success-text"; }
        else if (medicine.stock >= 10) { statusText = "Low Stock"; statusClass = ""; statusStyle = "color: #F59E0B; background: rgba(245,158,11,0.12);"; }
        
        const badge = document.getElementById("modalMedicineStatus");
        badge.textContent = statusText;
        badge.className = "pill " + statusClass;
        badge.style.cssText = statusStyle;
        
        document.getElementById("restockMedicineId").value = id;
        document.getElementById("restockQty").value = "";
        
        const modal = document.getElementById("medicineDetailModal");
        modal.classList.remove("hidden");
        modal.style.display = "flex";
    };

    function closeMedicineModal() {
        const modal = document.getElementById("medicineDetailModal");
        modal.classList.add("hidden");
        modal.style.display = "none";
    }

    async function submitRestock(e) {
        e.preventDefault();
        const id = document.getElementById("restockMedicineId").value;
        const qtyToRestock = Number(document.getElementById("restockQty").value);
        
        if (qtyToRestock <= 0) {
            showToast("Quantity must be a positive number.", "error");
            return;
        }
        
        try {
            setLoading(true);
            await apiFetch(`/pharmacy/medicines/${id}/restock`, {
                method: "PATCH",
                body: JSON.stringify({ add_stock: qtyToRestock })
            });
            
            showToast("Stock updated successfully");
            
            await loadMedicines(); 
            const medicine = medicineCache.find(m => m._id === id);
            if(medicine) window.openMedicineModal(id);
            
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    function addPrescriptionRow() {
        const container = document.getElementById("prescriptionItems");
        const row = document.createElement("div");
        row.className = "prescription-item";
        row.innerHTML = `
            <select class="select medicine-select"></select>
            <input class="input qty-input" type="number" min="1" placeholder="Qty">
            <button class="btn btn-danger" type="button">Remove</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
            row.remove();
            calculatePrescriptionTotal();
        });
        row.querySelector(".medicine-select").addEventListener("change", calculatePrescriptionTotal);
        row.querySelector(".qty-input").addEventListener("input", calculatePrescriptionTotal);
        container.appendChild(row);
        populateMedicineSelects();
    }

    function populateMedicineSelects() {
        document.querySelectorAll(".medicine-select").forEach((select) => {
            const currentValue = select.value;
            select.innerHTML = `<option value="">Select medicine</option>` + medicineCache
                .map((medicine) => `<option value="${medicine.name}">${sanitize(medicine.name)} (Rs. ${Number(medicine.price).toFixed(2)} | Stock ${medicine.stock})</option>`)
                .join("");
            select.value = currentValue;
        });
    }

    function calculatePrescriptionTotal() {
        const total = [...document.querySelectorAll(".prescription-item")].reduce((sum, row) => {
            const medicineName = row.querySelector(".medicine-select").value;
            const qty = Number(row.querySelector(".qty-input").value || 0);
            const medicine = medicineCache.find((item) => item.name === medicineName);
            return sum + (medicine ? medicine.price * qty : 0);
        }, 0);
        document.getElementById("prescriptionTotal").textContent = `Rs. ${total.toFixed(2)}`;
    }

    async function submitPrescriptionForm(event) {
        event.preventDefault();
        const patient_id = document.getElementById("prescriptionPatient").value;
        const medicines = [...document.querySelectorAll(".prescription-item")]
            .map((row) => ({
                name: row.querySelector(".medicine-select").value,
                qty: row.querySelector(".qty-input").value,
            }))
            .filter((item) => item.name && item.qty);

        if (!patient_id || !medicines.length) {
            showToast("Please select a patient and add at least one medicine.", "error");
            return;
        }

        const payload = {
            patient_id,
            medicines,
            appointment_id: activeAppointmentId || ""
        };

        try {
            setLoading(true);
            await apiFetch("/pharmacy/prescriptions", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            document.getElementById("prescriptionForm").reset();
            document.getElementById("prescriptionItems").innerHTML = "";
            addPrescriptionRow();
            calculatePrescriptionTotal();
            showToast("Prescription created successfully.");
            await Promise.all([loadMedicines(), loadPrescriptions()]);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    function renderPrescriptions(items) {
        const tbody = document.getElementById("prescriptionsTableBody");
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No prescriptions created yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = items
            .map(
                (item) => `
                <tr>
                    <td>${sanitize(item.patient_name)}</td>
                    <td>${sanitize(item.doctor_name)}</td>
                    <td>${item.medicines.map((medicine) => `${sanitize(medicine.name)} x ${sanitize(medicine.qty)}`).join("<br>")}</td>
                    <td>Rs. ${Number(item.total).toFixed(2)}</td>
                    <td>${formatDate(item.date)}</td>
                </tr>
            `
            )
            .join("");
    }
})();
