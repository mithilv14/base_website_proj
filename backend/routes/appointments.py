from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from config import db, patients_col, users_col, records_col, prescriptions_col, medicines_col
from utils.helpers import log_action
from utils.auth_decorators import permission_required
import datetime

appointments_bp = Blueprint("appointments", __name__)
appointments_col = db["appointments"]

@appointments_bp.get("/doctors")
@jwt_required()
@permission_required("view_appointments")
def get_doctors():
    try:
        doctors = list(users_col.find({"role": "doctor"}))
        data = [{"_id": str(d["_id"]), "name": d.get("name", "Unknown")} for d in doctors]
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching doctors failed: {e}"}), 500

@appointments_bp.get("/")
@jwt_required()
@permission_required("view_appointments")
def get_appointments():
    try:
        user_id = get_jwt_identity()
        user = users_col.find_one({"_id": ObjectId(user_id)})
        role = (user.get("role") or "").lower() if user else ""

        query = {}
        if role == "doctor":
            doctor_filters = [{"doctor_id": str(user_id)}]
            if ObjectId.is_valid(str(user_id)):
                doctor_filters.append({"doctor_id": ObjectId(user_id)})
            query["$or"] = doctor_filters

        date = request.args.get("date", "").strip()
        patient_id = request.args.get("patient_id", "").strip()
        status = request.args.get("status", "").strip()

        if date:
            query["date"] = date
        if patient_id:
            query["patient_id"] = patient_id
        if status:
            query["status"] = status

        appointments = list(appointments_col.find(query).sort("date", 1))
        
        patient_map = {str(p["_id"]): p.get("name", "Unknown Patient") for p in patients_col.find()}
        doctor_map = {str(u["_id"]): u.get("name", "Unknown Doctor") for u in users_col.find({"role": "doctor"})}

        for appt in appointments:
            appt["_id"] = str(appt["_id"])
            appt["patient_name"] = patient_map.get(str(appt.get("patient_id")), "Unknown Patient")
            appt["doctor_name"] = doctor_map.get(str(appt.get("doctor_id")), "Unknown Doctor")
            
        return jsonify({"success": True, "data": appointments}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching appointments failed: {e}"}), 500

@appointments_bp.post("/")
@jwt_required()
@permission_required("manage_appointments")
def create_appointment():
    try:
        data = request.get_json() or {}
        patient_id = data.get("patient_id")
        doctor_id = data.get("doctor_id")
        date = data.get("date")
        time = data.get("time")

        if not patient_id or not doctor_id or not date or not time:
            return jsonify({"success": False, "message": "All fields are required."}), 400

        appointment = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "date": date,
            "time": time,
            "status": "pending",
            "created_at": datetime.datetime.utcnow().isoformat()
        }

        result = appointments_col.insert_one(appointment)
        log_action(get_jwt_identity(), "create", "Appointment", result.inserted_id, f"Scheduled appointment on {date} at {time}", request.remote_addr)
        
        return jsonify({"success": True, "message": "Appointment booked successfully.", "inserted_id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"success": False, "message": f"Booking appointment failed: {e}"}), 500

@appointments_bp.patch("/<app_id>/status")
@jwt_required()
@permission_required("update_appointment_status")
def update_status(app_id):
    try:
        user_id = get_jwt_identity()
        user = users_col.find_one({"_id": ObjectId(user_id)})
        role = (user.get("role") or "").lower() if user else ""

        data = request.get_json() or {}
        status = data.get("status")
        if status not in ["pending", "confirmed", "checked_in", "cancelled", "completed"]:
            return jsonify({"success": False, "message": "Invalid status."}), 400

        filter_query = {"_id": ObjectId(app_id)}
        if role == "doctor":
            doctor_filters = [{"doctor_id": str(user_id)}]
            if ObjectId.is_valid(str(user_id)):
                doctor_filters.append({"doctor_id": ObjectId(user_id)})
            filter_query["$or"] = doctor_filters

        current_appt = appointments_col.find_one(filter_query)
        if not current_appt:
            return jsonify({"success": False, "message": "Appointment not found or unauthorized."}), 404

        previous_status = current_appt.get("status")
        appointments_col.update_one(filter_query, {"$set": {"status": status}})

        # AUTOMATIC CLEANUP IF CANCELLED
        if status == "cancelled":
            # 1. Restock medicines from prescriptions
            linked_rx = list(prescriptions_col.find({"appointment_id": app_id}))
            for rx in linked_rx:
                for item in rx.get("medicines", []):
                    medicines_col.update_one({"name": item.get("name")}, {"$inc": {"stock": item.get("qty", 0)}})
            
            # 2. Delete linked data
            records_col.delete_many({"appointment_id": app_id})
            prescriptions_col.delete_many({"appointment_id": app_id})
            
            log_action(user_id, "cleanup", "Appointment", app_id, f"Automatically cleared records/prescriptions for cancelled session", request.remote_addr)

        if status == "completed":
            try:
                from routes.billing import ensure_invoice_for_appointment
                ensure_invoice_for_appointment(app_id)
            except Exception as invoice_error:
                appointments_col.update_one(
                    {"_id": ObjectId(app_id)},
                    {"$set": {"status": previous_status}}
                )
                return jsonify({
                    "success": False,
                    "message": f"Appointment completion failed while preparing invoice: {invoice_error}"
                }), 500

        log_action(get_jwt_identity(), "update", "Appointment", app_id, f"Changed appointment status to {status}", request.remote_addr)
        return jsonify({"success": True, "message": f"Appointment {status}."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Updating status failed: {e}"}), 500
