(() => {
    const BASE_URL = "http://127.0.0.1:5000/api";
    let patientsCache = [];
    let doctorsCache = [];

    document.addEventListener("DOMContentLoaded", async () => {
        ensureAuthenticated();
        initPage("appointments");
        bindEvents();
        await Promise.all([loadPatients(), loadDoctors(), loadAppointments()]);
    });

    function bindEvents() {
        const bookBtn = document.getElementById("openApptModal");
        if (bookBtn) {
            if (!canAccess("manage_appointments")) {
                bookBtn.style.display = "none";
            } else {
                bookBtn.addEventListener("click", () => document.getElementById("apptModal").classList.add("show"));
            }
        }
        document.getElementById("closeApptModal").addEventListener("click", () => {
            document.getElementById("apptModal").classList.remove("show");
            document.getElementById("apptForm").reset();
        });
        document.getElementById("apptForm").addEventListener("submit", submitAppt);
    }

    async function loadPatients() {
        try {
            const res = await apiFetch("/patients/");
            patientsCache = res.data || [];
            document.getElementById("apptPatient").innerHTML = `<option value="">Select Patient</option>` + 
                patientsCache.map(p => `<option value="${p._id}">${sanitize(p.name)}</option>`).join("");
        } catch(e) { showToast(e.message, "error"); }
    }

    async function loadDoctors() {
        try {
            const res = await apiFetch("/appointments/doctors");
            doctorsCache = res.data || [];
            document.getElementById("apptDoctor").innerHTML = `<option value="">Select Doctor</option>` + 
                doctorsCache.map(d => `<option value="${d._id}">${sanitize(d.name)}</option>`).join("");
        } catch(e) { showToast(e.message, "error"); }
    }

    async function loadAppointments() {
        try {
            setLoading(true);
            const res = await apiFetch("/appointments/");
            render(res.data || []);
        } catch(e) { showToast(e.message, "error"); }
        finally { setLoading(false); }
    }

    function render(appts) {
        const tbody = document.getElementById("apptTableBody");
        
        // Filter out completed per user request
        const activeAppts = appts.filter(a => a.status !== "completed");
        
        if (!activeAppts.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No upcoming appointments found.</td></tr>`;
            return;
        }
        tbody.innerHTML = activeAppts.map(a => {
            let sClass = 'warning-text';
            let inlineStyle = '';
            
            if (a.status === 'confirmed') sClass = 'success-text';
            else if (a.status === 'cancelled') sClass = 'danger-text';
            else if (a.status === 'checked_in') { sClass = ''; inlineStyle = 'color: #10B981; background: rgba(16,185,129,0.12);'; }
            else if (a.status === 'completed') sClass = 'success-text';
            else inlineStyle = 'color: #F59E0B; background: rgba(245,158,11,0.12);';

            let acts = '';
            if (a.status === 'pending' && canAccess("update_appointment_status")) {
                acts = `
                    <button class="btn btn-primary" style="font-size:0.75rem; padding: 4px 8px;" onclick="updateStatus('${a._id}', 'confirmed')">Confirm</button>
                    <button class="btn btn-danger" style="font-size:0.75rem; padding: 4px 8px;" onclick="updateStatus('${a._id}', 'cancelled')">Cancel</button>
                `;
            } else if (a.status === 'confirmed' && canAccess("manage_appointments")) {
                // Receptionist Check-in Feature
                acts = `
                    <button class="btn" style="font-size:0.75rem; padding: 4px 8px; background: #10B981; border: none; color: white;" onclick="updateStatus('${a._id}', 'checked_in')">Check-in Patient</button>
                `;
            } else if (a.status === 'checked_in' && canAccess("update_appointment_status")) {
                acts = `
                    <button class="btn btn-primary" style="font-size:0.75rem; padding: 4px 8px;" onclick="updateStatus('${a._id}', 'completed')">Mark Completed</button>
                `;
            }
            return `<tr>
                <td>${sanitize(a.patient_name)}</td>
                <td>${sanitize(a.doctor_name)}</td>
                <td>${sanitize(a.date)}</td>
                <td>${sanitize(a.time)}</td>
                <td><span class="pill ${sClass}" style="${inlineStyle}">${sanitize((a.status || 'pending').toUpperCase())}</span></td>
                <td><div class="actions">${acts}</div></td>
            </tr>`;
        }).join("");
    }

    async function submitAppt(e) {
        e.preventDefault();
        const payload = {
            patient_id: document.getElementById("apptPatient").value,
            doctor_id: document.getElementById("apptDoctor").value,
            date: document.getElementById("apptDate").value,
            time: document.getElementById("apptTime").value
        };
        try {
            setLoading(true);
            await apiFetch("/appointments/", { method: "POST", body: JSON.stringify(payload) });
            showToast("Appointment booked!");
            document.getElementById("apptModal").classList.remove("show");
            document.getElementById("apptForm").reset();
            await loadAppointments();
        } catch(e) { showToast(e.message, "error"); }
        finally { setLoading(false); }
    }

    window.updateStatus = async (id, status) => {
        try {
            setLoading(true);
            await apiFetch(`/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({status})});
            showToast("Status updated");
            await loadAppointments();
        } catch(e) { showToast(e.message, "error"); }
        finally { setLoading(false); }
    }
})();
