from datetime import datetime
from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from config import patients_col, prescriptions_col, records_col, appointments_col, users_col
from utils.helpers import log_action
from utils.auth_decorators import permission_required

patients_bp = Blueprint("patients", __name__)

def _get_doctor_patient_ids(user_id):
    """Helper to get a list of patient IDs currently booked with a doctor."""
    appts = list(appointments_col.find({"doctor_id": str(user_id)}, {"patient_id": 1}))
    return [ObjectId(a["patient_id"]) for a in appts if ObjectId.is_valid(a.get("patient_id"))]


@patients_bp.get("/search")
@jwt_required()
@permission_required("view_patients")
def search_patients():
    try:
        user_id = get_jwt_identity()
        user = users_col.find_one({"_id": ObjectId(user_id)})
        role = (user.get("role") or "").lower() if user else ""

        query = request.args.get("q", "").strip()
        search_filter = {"name": {"$regex": query, "$options": "i"}} if query else {}
        
        if role == "doctor":
            search_filter["_id"] = {"$in": _get_doctor_patient_ids(user_id)}

        patients = list(patients_col.find(search_filter))
        for patient in patients:
            patient["_id"] = str(patient["_id"])
        return jsonify({"success": True, "data": patients}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Patient search failed: {e}"}), 500


@patients_bp.get("/")
@jwt_required()
@permission_required("view_patients")
def get_patients():
    try:
        user_id = get_jwt_identity()
        user = users_col.find_one({"_id": ObjectId(user_id)})
        role = (user.get("role") or "").lower() if user else ""

        search_filter = {}
        if role == "doctor":
            search_filter["_id"] = {"$in": _get_doctor_patient_ids(user_id)}

        patients = list(patients_col.find(search_filter))
        for patient in patients:
            patient["_id"] = str(patient["_id"])
        return jsonify({"success": True, "data": patients}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching patients failed: {e}"}), 500


@patients_bp.post("/")
@jwt_required()
@permission_required("manage_patients")
def create_patient():
    try:
        data = request.get_json() or {}
        patient = {
            "name": data.get("name", "").strip(),
            "age": int(data.get("age", 0)),
            "gender": data.get("gender", "").strip(),
            "contact": data.get("contact", "").strip(),
            "address": data.get("address", "").strip(),
            "blood_group": data.get("blood_group", "").strip(),
            "created_at": datetime.utcnow().isoformat(),
        }

        if not all([patient["name"], patient["age"], patient["gender"], patient["contact"], patient["address"], patient["blood_group"]]):
            return jsonify({"success": False, "message": "All patient fields are required."}), 400

        result = patients_col.insert_one(patient)
        log_action(get_jwt_identity(), "create", "Patient", result.inserted_id, f"Created patient: {patient['name']}", request.remote_addr)
        return jsonify({"success": True, "message": "Patient added successfully.", "inserted_id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"success": False, "message": f"Creating patient failed: {e}"}), 500


@patients_bp.get("/<patient_id>")
@jwt_required()
@permission_required("view_patients")
def get_patient(patient_id):
    try:
        patient = patients_col.find_one({"_id": ObjectId(patient_id)})
        if not patient:
            return jsonify({"success": False, "message": "Patient not found."}), 404
        patient["_id"] = str(patient["_id"])
        return jsonify({"success": True, "data": patient}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching patient failed: {e}"}), 500


@patients_bp.put("/<patient_id>")
@jwt_required()
@permission_required("manage_patients")
def update_patient(patient_id):
    try:
        data = request.get_json() or {}
        updates = {
            "name": data.get("name", "").strip(),
            "age": int(data.get("age", 0)),
            "gender": data.get("gender", "").strip(),
            "contact": data.get("contact", "").strip(),
            "address": data.get("address", "").strip(),
            "blood_group": data.get("blood_group", "").strip(),
        }
        patients_col.update_one({"_id": ObjectId(patient_id)}, {"$set": updates})
        log_action(get_jwt_identity(), "update", "Patient", patient_id, "Updated patient details", request.remote_addr)
        return jsonify({"success": True, "message": "Patient updated successfully."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Updating patient failed: {e}"}), 500


@patients_bp.delete("/<patient_id>")
@jwt_required()
@permission_required("manage_patients")
def delete_patient(patient_id):
    try:
        result = patients_col.delete_one({"_id": ObjectId(patient_id)})
        if result.deleted_count == 0:
            return jsonify({"success": False, "message": "Patient not found."}), 404

        records_col.delete_many({"patient_id": patient_id})
        prescriptions_col.delete_many({"patient_id": patient_id})
        log_action(get_jwt_identity(), "delete", "Patient", patient_id, "Deleted patient and associated records", request.remote_addr)
        return jsonify({"success": True, "message": "Patient deleted successfully."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Deleting patient failed: {e}"}), 500

@patients_bp.get("/<patient_id>/timeline")
@jwt_required()
@permission_required("view_patients")
def get_patient_timeline(patient_id):
    try:
        from config import users_col
        records = list(records_col.find({"patient_id": patient_id}))
        prescriptions = list(prescriptions_col.find({"patient_id": patient_id}))
        
        doctor_map = {str(u["_id"]): u.get("name", "Unknown Doctor") for u in users_col.find()}
        
        timeline = []
        for r in records:
            timeline.append({
                "type": "record",
                "date": r.get("date"),
                "visitType": r.get("visitType", "checkup"),
                "diagnosis": r.get("diagnosis"),
                "doctorName": doctor_map.get(r.get("doctor_id"), "Unknown Doctor"),
                "notes": r.get("notes")
            })
            
        for p in prescriptions:
            meds = ", ".join([f"{m.get('name')} x{m.get('qty')}" for m in p.get("medicines", [])])
            timeline.append({
                "type": "prescription",
                "date": p.get("date"),
                "visitType": "prescription",
                "diagnosis": "Prescription Refill",
                "doctorName": doctor_map.get(p.get("doctor_id"), "Unknown Doctor"),
                "notes": meds
            })
            
        timeline.sort(key=lambda x: x["date"] if x["date"] else "", reverse=True)
        return jsonify({"success": True, "data": timeline}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching timeline failed: {e}"}), 500
