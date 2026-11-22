from datetime import datetime

from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from config import medicines_col, patients_col, prescriptions_col, users_col
from utils.helpers import log_action
from utils.auth_decorators import permission_required

pharmacy_bp = Blueprint("pharmacy", __name__)


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

@pharmacy_bp.get("/medicines")
@jwt_required()
@permission_required("view_medicines")
def get_medicines():
    try:
        medicines = list(medicines_col.find().sort("name", 1))
        for medicine in medicines:
            medicine["_id"] = str(medicine["_id"])
        return jsonify({"success": True, "data": medicines}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching medicines failed: {e}"}), 500

@pharmacy_bp.get("/medicines/<medicine_id>")
@jwt_required()
@permission_required("view_medicines")
def get_medicine(medicine_id):
    try:
        medicine = medicines_col.find_one({"_id": ObjectId(medicine_id)})
        if not medicine:
            return jsonify({"success": False, "message": "Medicine not found."}), 404
        medicine["_id"] = str(medicine["_id"])
        return jsonify({"success": True, "data": medicine}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching medicine failed: {e}"}), 500

@pharmacy_bp.get("/low-stock")
@jwt_required()
@permission_required("manage_inventory")
def get_low_stock():
    try:
        medicines = list(medicines_col.find())
        low_stock = []
        for medicine in medicines:
            threshold = medicine.get("lowStockThreshold", 20)
            if medicine.get("stock", 0) <= threshold:
                medicine["_id"] = str(medicine["_id"])
                low_stock.append(medicine)
        return jsonify({"success": True, "data": low_stock}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching low stock failed: {e}"}), 500

@pharmacy_bp.post("/medicines")
@jwt_required()
@permission_required("manage_inventory")
def add_medicine():
    try:
        data = request.get_json() or {}
        name = data.get("name", "").strip().lower()

        if not name:
            return jsonify({"success": False, "message": "Medicine name is required."}), 400

        result = medicines_col.update_one(
            { "name_lower": name },
            {
                "$set": {
                    "name": data["name"].strip(),
                    "name_lower": name,
                    "price": float(data.get("price", 0)),
                    "lowStockThreshold": int(data.get("lowStockThreshold", 20))
                },
                "$setOnInsert": { "stock": int(data.get("stock", 0)) }
            },
            upsert=True
        )

        inserted_id = str(result.upserted_id) if result.upserted_id else None
        log_action(get_jwt_identity(), "create", "Medicine", result.upserted_id, f"Added internal medicine stock: {data['name']}", request.remote_addr)
        return jsonify({"success": True, "message": "Medicine added successfully.", "inserted_id": inserted_id}), 201
    except Exception as e:
        return jsonify({"success": False, "message": f"Adding medicine failed: {e}"}), 500

@pharmacy_bp.patch("/medicines/<medicine_id>/restock")
@jwt_required()
@permission_required("manage_inventory")
def restock_medicine(medicine_id):
    try:
        data = request.get_json() or {}
        add_stock = data.get("add_stock")
        if add_stock is None or type(add_stock) not in [int, float] or int(add_stock) <= 0:
            return jsonify({"success": False, "message": "Invalid stock quantity. Must be a positive integer."}), 400
        
        medicine = medicines_col.find_one_and_update(
            {"_id": ObjectId(medicine_id)},
            {"$inc": {"stock": int(add_stock)}},
            return_document=True
        )
        if not medicine:
            return jsonify({"success": False, "message": "Medicine not found."}), 404
            
        medicine["_id"] = str(medicine["_id"])
        log_action(get_jwt_identity(), "update", "Medicine", ObjectId(medicine_id), f"Restocked {add_stock} units for {medicine.get('name')}", request.remote_addr)
        return jsonify({"success": True, "message": "Stock updated successfully.", "data": medicine}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Restocking medicine failed: {e}"}), 500

@pharmacy_bp.get("/prescriptions")
@jwt_required()
@permission_required("view_prescriptions")
def get_prescriptions():
    try:
        prescriptions = list(prescriptions_col.find().sort("date", -1))
        patient_map = {str(patient["_id"]): patient.get("name", "Unknown Patient") for patient in patients_col.find({}, {"name": 1})}
        doctor_map = {str(user["_id"]): user.get("name", "Unknown Doctor") for user in users_col.find({}, {"name": 1})}

        for prescription in prescriptions:
            prescription["_id"] = str(prescription["_id"])
            prescription["patient_name"] = prescription.get("patient_name") or patient_map.get(prescription.get("patient_id"), "Unknown Patient")
            prescription["doctor_name"] = prescription.get("doctor_name") or doctor_map.get(prescription.get("doctor_id"), "Unknown Doctor")
        return jsonify({"success": True, "data": prescriptions}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching prescriptions failed: {e}"}), 500

@pharmacy_bp.post("/prescriptions")
@jwt_required()
@permission_required("prescribe")
def create_prescription():
    try:
        data = request.get_json() or {}
        patient_id = data.get("patient_id", "").strip()
        doctor_id = data.get("doctor_id", "").strip() or get_jwt_identity()
        appointment_id = data.get("appointment_id", "").strip()
        medicines = data.get("medicines", [])

        if not patient_id or not medicines:
            return jsonify({"success": False, "message": "Patient and medicines are required."}), 400

        if not patients_col.find_one({"_id": ObjectId(patient_id)}):
            return jsonify({"success": False, "message": "Patient not found."}), 404

        appointment_id, appt = resolve_consultation_appointment(patient_id, doctor_id, appointment_id)
        if appt:
            status = (appt.get("status") or "").lower()
            if status in ["cancelled", "completed"]:
                return jsonify({"success": False, "message": f"Cannot prescribe for a {status} consultation."}), 400

        patient = patients_col.find_one({"_id": ObjectId(patient_id)}, {"name": 1})
        doctor = users_col.find_one({"_id": ObjectId(doctor_id)}) if ObjectId.is_valid(str(doctor_id)) else None
        patient_name = patient.get("name", "Unknown Patient") if patient else "Unknown Patient"
        doctor_name = doctor.get("name", "Unknown Doctor") if doctor else data.get("doctor_name", "").strip() or "Unknown Doctor"

        prescription_items = []
        total = 0.0

        for item in medicines:
            name = str(item.get("name", "")).strip()
            qty = int(item.get("qty", 0))
            medicine = medicines_col.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}})

            if not medicine:
                return jsonify({"success": False, "message": f"Medicine '{name}' not found."}), 404
            if qty <= 0:
                return jsonify({"success": False, "message": "Medicine quantity must be greater than zero."}), 400
            if medicine.get("stock", 0) < qty:
                return jsonify({"success": False, "message": f"Insufficient stock for '{medicine['name']}'."}), 400

            line_total = float(medicine["price"]) * qty
            total += line_total
            medicines_col.update_one({"_id": medicine["_id"]}, {"$inc": {"stock": -qty}})
            prescription_items.append(
                {
                    "name": medicine["name"],
                    "qty": qty,
                    "price": float(medicine["price"]),
                    "line_total": round(line_total, 2),
                }
            )

        result = prescriptions_col.insert_one(
            {
                "patient_id": patient_id,
                "patient_name": patient_name,
                "doctor_id": doctor_id,
                "doctor_name": doctor_name,
                "appointment_id": appointment_id,
                "medicines": prescription_items,
                "total": round(total, 2),
                "date": datetime.utcnow().isoformat(),
            }
        )
        log_action(get_jwt_identity(), "create", "Prescription", result.inserted_id, "Dispensed or updated prescription details", request.remote_addr)
        return jsonify({"success": True, "message": "Prescription created successfully.", "inserted_id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"success": False, "message": f"Creating prescription failed: {e}"}), 500


@pharmacy_bp.delete("/prescriptions/<prescription_id>")
@jwt_required()
@permission_required("prescribe")
def delete_prescription(prescription_id):
    try:
        doctor_id = get_jwt_identity()
        prescription = prescriptions_col.find_one({"_id": ObjectId(prescription_id)})
        if not prescription:
            return jsonify({"success": False, "message": "Prescription not found."}), 404
            
        user = users_col.find_one({"_id": ObjectId(doctor_id)})
        if user.get("role") != "admin" and prescription.get("doctor_id") != str(doctor_id):
            return jsonify({"success": False, "message": "Unauthorized to delete this prescription."}), 403

        # RESTOCK MEDICINES!
        for item in prescription.get("medicines", []):
            name = item.get("name")
            qty = item.get("qty", 0)
            medicines_col.update_one({"name": name}, {"$inc": {"stock": qty}})

        prescriptions_col.delete_one({"_id": ObjectId(prescription_id)})
        log_action(doctor_id, "delete", "Prescription", prescription_id, "Removed prescription and restored stock", request.remote_addr)
        return jsonify({"success": True, "message": "Prescription deleted and stock restored."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Deleting prescription failed: {e}"}), 500
