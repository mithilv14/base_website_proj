from datetime import datetime

from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from config import patients_col, records_col, users_col
from utils.helpers import log_action
from utils.auth_decorators import permission_required

records_bp = Blueprint("records", __name__)


def resolve_consultation_appointment(patient_id, doctor_id, appointment_id=""):
    from config import db
    appointments_col = db["appointments"]

    if appointment_id:
        appt = appointments_col.find_one({"_id": ObjectId(appointment_id)})
        return appointment_id, appt

    doctor_filters = [{"doctor_id": str(doctor_id)}]
    if ObjectId.is_valid(str(doctor_id)):
        doctor_filters.append({"doctor_id": ObjectId(doctor_id)})

    appt = appointments_col.find_one(
        {
            "patient_id": patient_id,
            "status": "checked_in",
            "$or": doctor_filters,
        },
        sort=[("date", 1), ("time", 1)]
    )
    return (str(appt["_id"]), appt) if appt else ("", None)


@records_bp.get("/")
@jwt_required()
@permission_required("view_records")
def get_records():
    try:
        records = list(records_col.find().sort("date", -1))
        patient_map = {str(patient["_id"]): patient.get("name", "Unknown Patient") for patient in patients_col.find({}, {"name": 1})}
        doctor_map = {str(user["_id"]): user.get("name", "Unknown Doctor") for user in users_col.find({}, {"name": 1})}

        for record in records:
            record["_id"] = str(record["_id"])
            record["patient_name"] = record.get("patient_name") or patient_map.get(record.get("patient_id"), "Unknown Patient")
            record["doctor_name"] = record.get("doctor_name") or doctor_map.get(record.get("doctor_id"), "Unknown Doctor")
        return jsonify({"success": True, "data": records}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching records failed: {e}"}), 500


@records_bp.post("/")
@jwt_required()
@permission_required("write_records")
def create_record():
    try:
        data = request.get_json() or {}
        patient_id = data.get("patient_id", "").strip()
        doctor_id = data.get("doctor_id", "").strip() or get_jwt_identity()
        appointment_id = data.get("appointment_id", "").strip()
        symptoms = data.get("symptoms", [])
        diagnosis = data.get("diagnosis", "").strip()
        notes = data.get("notes", "").strip()

        if isinstance(symptoms, str):
            symptoms = [item.strip() for item in symptoms.split(",") if item.strip()]

        if not patient_id or not diagnosis or not symptoms:
            return jsonify({"success": False, "message": "Patient, symptoms, and diagnosis are required."}), 400

        patient = patients_col.find_one({"_id": ObjectId(patient_id)})
        if not patient:
            return jsonify({"success": False, "message": "Patient not found."}), 404

        appointment_id, appt = resolve_consultation_appointment(patient_id, doctor_id, appointment_id)
        if appt:
            status = (appt.get("status") or "").lower()
            if status in ["cancelled", "completed"]:
                return jsonify({"success": False, "message": f"Cannot add records to a {status} consultation."}), 400

        doctor = users_col.find_one({"_id": ObjectId(doctor_id)}) if ObjectId.is_valid(str(doctor_id)) else None
        doctor_name = doctor.get("name", "Unknown Doctor") if doctor else data.get("doctor_name", "").strip() or "Unknown Doctor"

        record = {
            "patient_id": patient_id,
            "patient_name": patient.get("name", "Unknown Patient"),
            "doctor_id": doctor_id,
            "doctor_name": doctor_name,
            "appointment_id": appointment_id,
            "diagnosis": diagnosis,
            "symptoms": symptoms,
            "notes": notes,
            "visitType": data.get("visitType", "checkup").strip(),
            "date": datetime.utcnow().isoformat(),
        }
        result = records_col.insert_one(record)
        log_action(get_jwt_identity(), "create", "Record", result.inserted_id, f"Logged patient record for '{record['diagnosis']}'", request.remote_addr)
        return jsonify({"success": True, "message": "Record added successfully.", "inserted_id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"success": False, "message": f"Creating record failed: {e}"}), 500


@records_bp.get("/<patient_id>")
@jwt_required()
@permission_required("view_records")
def get_patient_records(patient_id):
    try:
        records = list(records_col.find({"patient_id": patient_id}).sort("date", -1))
        patient = patients_col.find_one({"_id": ObjectId(patient_id)}, {"name": 1}) if ObjectId.is_valid(patient_id) else None
        doctor_map = {str(user["_id"]): user.get("name", "Unknown Doctor") for user in users_col.find({}, {"name": 1})}

        for record in records:
            record["_id"] = str(record["_id"])
            record["patient_name"] = record.get("patient_name") or (patient.get("name") if patient else "Unknown Patient")
            record["doctor_name"] = record.get("doctor_name") or doctor_map.get(record.get("doctor_id"), "Unknown Doctor")
        return jsonify({"success": True, "data": records}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching patient records failed: {e}"}), 500


@records_bp.put("/<record_id>")
@jwt_required()
@permission_required("write_records")
def update_record(record_id):
    try:
        data = request.get_json() or {}
        doctor_id = get_jwt_identity()
        
        # Check if record exists and belongs to doctor (unless admin)
        record = records_col.find_one({"_id": ObjectId(record_id)})
        if not record:
            return jsonify({"success": False, "message": "Record not found."}), 404
            
        user = users_col.find_one({"_id": ObjectId(doctor_id)})
        if user.get("role") != "admin" and record.get("doctor_id") != str(doctor_id):
            return jsonify({"success": False, "message": "Unauthorized to edit this record."}), 403

        update_fields = {}
        if "symptoms" in data:
            update_fields["symptoms"] = data["symptoms"]
        if "diagnosis" in data:
            update_fields["diagnosis"] = data["diagnosis"].strip()
        if "notes" in data:
            update_fields["notes"] = data["notes"].strip()
        if "visitType" in data:
            update_fields["visitType"] = data["visitType"].strip()

        if not update_fields:
            return jsonify({"success": False, "message": "No fields to update."}), 400

        records_col.update_one({"_id": ObjectId(record_id)}, {"$set": update_fields})
        log_action(doctor_id, "update", "Record", record_id, f"Updated clinical record details", request.remote_addr)
        return jsonify({"success": True, "message": "Record updated successfully."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Updating record failed: {e}"}), 500


@records_bp.delete("/<record_id>")
@jwt_required()
@permission_required("write_records")
def delete_record(record_id):
    try:
        doctor_id = get_jwt_identity()
        record = records_col.find_one({"_id": ObjectId(record_id)})
        if not record:
            return jsonify({"success": False, "message": "Record not found."}), 404
            
        user = users_col.find_one({"_id": ObjectId(doctor_id)})
        if user.get("role") != "admin" and record.get("doctor_id") != str(doctor_id):
            return jsonify({"success": False, "message": "Unauthorized to delete this record."}), 403

        records_col.delete_one({"_id": ObjectId(record_id)})
        log_action(doctor_id, "delete", "Record", record_id, f"Removed clinical record", request.remote_addr)
        return jsonify({"success": True, "message": "Record deleted successfully."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Deleting record failed: {e}"}), 500
