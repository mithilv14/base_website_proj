(() => {
    const BASE_URL = "http://127.0.0.1:5000/api";
    let allPatients = [];
    let editingPatientId = null;

    document.addEventListener("DOMContentLoaded", async () => {
        ensureAuthenticated();
        initPage("patients");
        bindPatientEvents();
        await loadPatients();
    });

    function bindPatientEvents() {
        const addBtn = document.getElementById("openPatientModal");
        if (addBtn) {
            if (!canAccess("manage_patients")) {
                addBtn.style.display = "none";
            } else {
                addBtn.addEventListener("click", () => openPatientModal());
            }
        }
        document.getElementById("closePatientModal").addEventListener("click", closePatientModal);
        document.getElementById("closePatientTimelineModal").addEventListener("click", () => document.getElementById("patientTimelineModal").classList.remove("show"));
        document.getElementById("patientForm").addEventListener("submit", submitPatientForm);
        document.getElementById("searchPatients").addEventListener("input", handlePatientSearch);
    }

    async function loadPatients() {
    try {
        setLoading(true);
        const response = await apiFetch("/patients/");
        allPatients = response.data;
        renderPatients(allPatients);
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        setLoading(false);
    }
}

    async function handlePatientSearch(event) {
    const query = event.target.value.trim();
    if (!query) {
        renderPatients(allPatients);
        return;
    }

    try {
        const response = await apiFetch(`/patients/search?q=${encodeURIComponent(query)}`);
        renderPatients(response.data);
    } catch (error) {
        showToast(error.message, "error");
    }
}

    function renderPatients(patients) {
    const tbody = document.getElementById("patientsTableBody");
    if (!patients.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = patients
        .map(
            (patient) => {
                const canManage = canAccess("manage_patients");
                const manageBtns = canManage ? `
                    <button class="btn btn-primary" onclick="editPatient('${patient._id}')">Edit</button>
                    <button class="btn btn-danger" onclick="deletePatient('${patient._id}')">Delete</button>
                ` : "";
                
                return `
            <tr>
                <td>${sanitize(patient.name)}</td>
                <td>${sanitize(patient.age)}</td>
                <td>${sanitize(patient.gender)}</td>
                <td>${sanitize(patient.contact)}</td>
                <td>${sanitize(patient.blood_group)}</td>
                <td>${sanitize(patient.address)}</td>
                <td>${formatDate(patient.created_at)}</td>
                <td>
                    <div class="actions">
                        ${manageBtns}
                        <button class="btn btn-accent" onclick="viewHistory('${patient._id}')">History</button>
                    </div>
                </td>
            </tr>
        `
        }
        )
        .join("");
}

    function openPatientModal(patient = null) {
    editingPatientId = patient?._id || null;
    document.getElementById("patientModalTitle").textContent = patient ? "Edit Patient" : "Add Patient";
    document.getElementById("patientName").value = patient?.name || "";
    document.getElementById("patientAge").value = patient?.age || "";
    document.getElementById("patientGender").value = patient?.gender || "";
    document.getElementById("patientContact").value = patient?.contact || "";
    document.getElementById("patientAddress").value = patient?.address || "";
    document.getElementById("patientBloodGroup").value = patient?.blood_group || "";
    document.getElementById("patientModal").classList.add("show");
}

    function closePatientModal() {
    document.getElementById("patientModal").classList.remove("show");
    document.getElementById("patientForm").reset();
    editingPatientId = null;
}

    async function editPatient(patientId) {
        const patient = allPatients.find((item) => item._id === patientId);
        if (patient) openPatientModal(patient);
    }

    async function submitPatientForm(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById("patientName").value.trim(),
        age: document.getElementById("patientAge").value.trim(),
        gender: document.getElementById("patientGender").value.trim(),
        contact: document.getElementById("patientContact").value.trim(),
        address: document.getElementById("patientAddress").value.trim(),
        blood_group: document.getElementById("patientBloodGroup").value.trim(),
    };

    if (Object.values(payload).some((value) => !value)) {
        showToast("Please complete all patient fields.", "error");
        return;
    }

    try {
        setLoading(true);
        if (editingPatientId) {
            await apiFetch(`/patients/${editingPatientId}`, {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            showToast("Patient updated successfully.");
        } else {
            await apiFetch("/patients/", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            showToast("Patient added successfully.");
        }
        closePatientModal();
        await loadPatients();
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        setLoading(false);
    }
}

    async function deletePatient(patientId) {
    if (!window.confirm("Delete this patient and related history?")) return;
    try {
        setLoading(true);
        await apiFetch(`/patients/${patientId}`, { method: "DELETE" });
        showToast("Patient deleted successfully.");
        await loadPatients();
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        setLoading(false);
    }
}

    async function viewHistory(patientId) {
        document.getElementById("patientTimelineModal").classList.add("show");
        const container = document.getElementById("patientTimelineContainer");
        container.innerHTML = "<div style='text-align:center; padding: 40px;'><div class='spinner'></div></div>";
        try {
            const response = await apiFetch(`/patients/${patientId}/timeline`);
            if (!response.data || !response.data.length) {
                container.innerHTML = "<div class='empty-state'>No history found for this patient.</div>";
                return;
            }
            container.innerHTML = "<ul class='timeline'>" + response.data.map(item => {
                const dateRaw = item.date ? formatDate(item.date) : "Unknown Date";
                const vType = item.visitType || "checkup";
                const dotClass = ["prescription", "emergency"].includes(vType) ? vType : "checkup";
                return `
                    <li class="timeline-item">
                        <div class="timeline-dot ${dotClass}"></div>
                        <div class="timeline-content">
                            <div class="timeline-date">${dateRaw}</div>
                            <div class="timeline-box-title">
                                <span>${sanitize(item.diagnosis)}</span>
                                <span class="pill" style="font-size:0.75rem; background:rgba(0,0,0,0.05); color:#666;">${sanitize(vType.toUpperCase())}</span>
                            </div>
                            <div class="timeline-box-doc">By: ${sanitize(item.doctorName)}</div>
                            ${item.notes ? `<div style="margin-top:8px; font-size:0.9rem; color:#444;">${sanitize(item.notes)}</div>` : ''}
                        </div>
                    </li>
                `;
            }).join("") + "</ul>";
        } catch (error) {
            container.innerHTML = `<div class='empty-state' style='color:#ef4444;'>${sanitize(error.message)}</div>`;
        }
    }

    window.editPatient = editPatient;
    window.deletePatient = deletePatient;
    window.viewHistory = viewHistory;
})();
