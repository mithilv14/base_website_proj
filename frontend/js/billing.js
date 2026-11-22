(() => {
    let allInvoices = [];

    document.addEventListener("DOMContentLoaded", async () => {
        ensureAuthenticated();
        initPage("billing");

        await loadInvoices();

        document.getElementById("billingSearch").addEventListener("input", filterInvoices);
        document.getElementById("statusFilter").addEventListener("change", filterInvoices);
        
        // Modal close
        document.querySelector(".close-modal").onclick = () => {
            document.getElementById("invoiceModal").style.display = "none";
        };
    });

    async function loadInvoices() {
        try {
            setLoading(true);
            const response = await apiFetch("/billing/");
            allInvoices = (response.data || []).sort((a, b) => {
                const left = new Date(a.date || 0).getTime();
                const right = new Date(b.date || 0).getTime();
                return right - left;
            });
            
            // Calculate stats
            const pending = allInvoices.filter(i => i.status === "pending").length;
            const totalPaid = allInvoices.filter(i => i.status === "paid").reduce((sum, i) => sum + i.total, 0);
            
            document.getElementById("billingPendingCount").textContent = pending;
            document.getElementById("billingTotalPaid").textContent = `₹${totalPaid.toLocaleString()}`;
            
            renderInvoices(allInvoices);
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }

    function renderInvoices(items) {
        const tbody = document.getElementById("billingTableBody");
        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No invoices found.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(inv => `
            <tr>
                <td>${formatDate(inv.date)}</td>
                <td style="font-weight:600;">${sanitize(inv.patient_name)}</td>
                <td>${inv.items.length} items</td>
                <td style="font-weight:600;">₹${inv.total.toLocaleString()}</td>
                <td>
                    <span class="pill" style="background:${inv.status === 'paid' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'}; color:${inv.status === 'paid' ? '#10B981' : '#F59E0B'}">
                        ${inv.status.toUpperCase()}
                    </span>
                </td>
                <td>
                    <div class="actions">
                        <button class="btn btn-primary" style="font-size:0.75rem; padding:4px 10px;" onclick="viewInvoice('${inv._id}')">View & Pay</button>
                    </div>
                </td>
            </tr>
        `).join("");
    }

    function filterInvoices() {
        const query = document.getElementById("billingSearch").value.toLowerCase();
        const status = document.getElementById("statusFilter").value;

        const filtered = allInvoices.filter(inv => {
            const matchesQuery = inv.patient_name.toLowerCase().includes(query);
            const matchesStatus = status === "all" || inv.status === status;
            return matchesQuery && matchesStatus;
        });

        renderInvoices(filtered);
    }

    window.viewInvoice = (id) => {
        const inv = allInvoices.find(i => i._id === id);
        if (!inv) return;

        const modal = document.getElementById("invoiceModal");
        const area = document.getElementById("invoiceDetailArea");
        const footer = document.getElementById("invoiceFooter");
        const payBtn = document.getElementById("payInvoiceBtn");

        area.innerHTML = `
            <div style="margin-bottom:15px;">
                <label style="font-size:0.8rem; color:var(--text-muted);">PATIENT</label>
                <div style="font-weight:600; font-size:1.1rem;">${sanitize(inv.patient_name)}</div>
            </div>
            <div class="table-wrap" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
                <table style="font-size:0.9rem;">
                    <thead>
                        <tr>
                            <th style="background:none;">Item Description</th>
                            <th style="background:none; text-align:right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${inv.items.map(item => `
                            <tr>
                                <td style="border:0; padding:8px 0;">${sanitize(item.description)}</td>
                                <td style="border:0; padding:8px 0; text-align:right;">₹${item.amount.toLocaleString()}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                    <tfoot>
                        <tr style="border-top:1px solid var(--border);">
                            <td style="padding-top:12px; font-weight:600;">Total Amount</td>
                            <td style="padding-top:12px; font-weight:700; text-align:right; font-size:1.1rem; color:#2563EB;">₹${inv.total.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

        if (inv.status === "paid") {
            payBtn.style.display = "none";
            footer.innerHTML = `<span style="color:#10B981; font-weight:600; border:1px solid #10B981; padding:6px 12px; border-radius:6px;">✔ PAID ON ${formatDate(inv.paid_at)}</span>`;
        } else {
            payBtn.style.display = "block";
            payBtn.onclick = () => recordPayment(inv._id);
            footer.innerHTML = "";
            footer.appendChild(payBtn);
        }

        modal.style.display = "flex";
    };

    async function recordPayment(id) {
        if (!confirm("Are you sure you want to mark this invoice as paid?")) return;
        try {
            setLoading(true);
            await apiFetch(`/billing/${id}/pay`, { method: "PATCH" });
            showToast("Payment recorded successfully.");
            document.getElementById("invoiceModal").style.display = "none";
            await loadInvoices();
        } catch (error) {
            showToast(error.message, "error");
        } finally {
            setLoading(false);
        }
    }
})();
