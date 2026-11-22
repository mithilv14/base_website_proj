from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from config import invoices_col, appointments_col, prescriptions_col, departments_col, patients_col
from utils.auth_decorators import permission_required
from utils.helpers import log_action
import datetime

billing_bp = Blueprint("billing", __name__)


def build_appointment_id_query(appointment_id):
    appointment_id = str(appointment_id)
    filters = [{"appointment_id": appointment_id}]
    if ObjectId.is_valid(appointment_id):
        filters.append({"appointment_id": ObjectId(appointment_id)})
    return {"$or": filters} if len(filters) > 1 else filters[0]


def build_id_match_query(field_name, value):
    value = str(value)
    filters = [{field_name: value}]
    if ObjectId.is_valid(value):
        filters.append({field_name: ObjectId(value)})
    return {"$or": filters} if len(filters) > 1 else filters[0]


def find_prescriptions_for_appointment(appt, appointment_id):
    appointment_id_query = build_appointment_id_query(appointment_id)
    linked_prescriptions = list(prescriptions_col.find(appointment_id_query))
    if linked_prescriptions:
        return linked_prescriptions

    appt_date = str(appt.get("date", "")).strip()
    patient_id = str(appt.get("patient_id", "")).strip()
    doctor_id = str(appt.get("doctor_id", "")).strip()
    if not appt_date or not patient_id or not doctor_id:
        return []

    orphan_query = {
        "$and": [
            build_id_match_query("patient_id", patient_id),
            build_id_match_query("doctor_id", doctor_id),
            {"$or": [
                {"appointment_id": ""},
                {"appointment_id": None},
                {"appointment_id": {"$exists": False}},
            ]},
        ]
    }
    orphan_prescriptions = [
        rx for rx in prescriptions_col.find(orphan_query).sort("date", 1)
        if str(rx.get("date", "")).startswith(appt_date)
    ]
    if not orphan_prescriptions:
        return []

    same_day_appt_query = {
        "$and": [
            build_id_match_query("patient_id", patient_id),
            build_id_match_query("doctor_id", doctor_id),
            {"date": appt_date},
        ]
    }
    if appointments_col.count_documents(same_day_appt_query) != 1:
        return []

    orphan_ids = [rx["_id"] for rx in orphan_prescriptions]
    prescriptions_col.update_many({"_id": {"$in": orphan_ids}}, {"$set": {"appointment_id": appointment_id}})
    for rx in orphan_prescriptions:
        rx["appointment_id"] = appointment_id
    return orphan_prescriptions


def ensure_invoice_for_appointment(appointment_id):
    appointment_id = str(appointment_id)
    appt = appointments_col.find_one({"_id": ObjectId(appointment_id)})
    if not appt:
        raise ValueError("Appointment not found.")

    dept_name = appt.get("department_name", "General Medicine")
    dept = departments_col.find_one({"name": dept_name})
    consultation_fee = dept.get("fee", 50) if dept else 50

    line_items = [
        {"description": f"Consultation Fee ({dept_name})", "amount": round(float(consultation_fee), 2)}
    ]

    prescriptions = find_prescriptions_for_appointment(appt, appointment_id)
    for rx in prescriptions:
        medicines = rx.get("medicines", [])
        if medicines:
            for medicine in medicines:
                qty = int(medicine.get("qty", 0) or 0)
                price = float(medicine.get("price", 0) or 0)
                line_total = medicine.get("line_total")
                amount = round(float(line_total), 2) if line_total is not None else round(price * qty, 2)
                line_items.append({
                    "description": f"Medicine - {medicine.get('name', 'Unknown')} x{qty}",
                    "amount": amount
                })
        elif rx.get("total"):
            rx_date = rx.get("date") or datetime.datetime.utcnow().strftime("%Y-%m-%d")
            line_items.append({
                "description": f"Prescription - {str(rx_date)[:10]}",
                "amount": round(float(rx.get("total", 0) or 0), 2)
            })

    total = round(sum(float(item.get("amount", 0) or 0) for item in line_items), 2)
    now_iso = datetime.datetime.utcnow().isoformat()
    appointment_id_query = build_appointment_id_query(appointment_id)
    invoice_data = {
        "appointment_id": appointment_id,
        "patient_id": str(appt.get("patient_id", "")),
        "doctor_id": str(appt.get("doctor_id", "")),
        "items": line_items,
        "total": total,
        "status": "pending",
        "updated_at": now_iso
    }

    pending_invoices = list(invoices_col.find({
        **appointment_id_query,
        "status": "pending"
    }).sort("date", -1))

    if pending_invoices:
        primary_invoice = pending_invoices[0]
        invoice_data["date"] = primary_invoice.get("date") or now_iso
        invoices_col.update_one({"_id": primary_invoice["_id"]}, {"$set": invoice_data})

        duplicate_ids = [inv["_id"] for inv in pending_invoices[1:]]
        if duplicate_ids:
            invoices_col.delete_many({"_id": {"$in": duplicate_ids}})

        return {"invoice_id": str(primary_invoice["_id"]), "created": False}

    paid_invoice = invoices_col.find_one({
        **appointment_id_query,
        "status": "paid"
    })
    if paid_invoice:
        return {"invoice_id": str(paid_invoice["_id"]), "created": False}

    invoice_data["date"] = now_iso
    result = invoices_col.insert_one(invoice_data)
    return {"invoice_id": str(result.inserted_id), "created": True}


def sync_completed_invoices():
    completed_appointments = appointments_col.find({"status": "completed"}, {"_id": 1})
    for appt in completed_appointments:
        ensure_invoice_for_appointment(str(appt["_id"]))


@billing_bp.get("/")
@jwt_required()
@permission_required("view_dashboard") # Common permission for finance view
def get_all_invoices():
    try:
        sync_completed_invoices()
        invoices = list(invoices_col.find().sort("date", -1))
        # Map patient names
        patient_map = {str(p["_id"]): p.get("name", "Unknown") for p in patients_col.find({}, {"name": 1})}
        
        for inv in invoices:
            inv["_id"] = str(inv["_id"])
            inv["patient_name"] = patient_map.get(str(inv.get("patient_id", "")), "Unknown Patient")
        return jsonify({"success": True, "data": invoices}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@billing_bp.post("/generate/<appointment_id>")
@jwt_required()
@permission_required("update_appointment_status")
def generate_invoice(appointment_id):
    try:
        sync_result = ensure_invoice_for_appointment(appointment_id)
        message = "Invoice generated." if sync_result["created"] else "Invoice updated."
        return jsonify({
            "success": True,
            "message": message,
            "invoice_id": sync_result["invoice_id"]
        }), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@billing_bp.patch("/<invoice_id>/pay")
@jwt_required()
@permission_required("update_appointment_status") # Receptionist permission
def mark_as_paid(invoice_id):
    try:
        invoices_col.update_one(
            {"_id": ObjectId(invoice_id)},
            {"$set": {"status": "paid", "paid_at": datetime.datetime.utcnow().isoformat()}}
        )
        log_action(get_jwt_identity(), "update", "Invoice", invoice_id, "Marked as paid", request.remote_addr)
        return jsonify({"success": True, "message": "Payment recorded."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
