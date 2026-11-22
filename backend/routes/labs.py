from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from config import lab_orders_col, patients_col, users_col
from utils.auth_decorators import permission_required
from utils.helpers import log_action
import datetime

labs_bp = Blueprint("labs", __name__)

@labs_bp.get("/")
@jwt_required()
def get_lab_orders():
    try:
        query = {}
        patient_id = request.args.get("patient_id")
        if patient_id:
            query["patient_id"] = patient_id
            
        orders = list(lab_orders_col.find(query).sort("date", -1))
        patient_map = {str(p["_id"]): p.get("name", "Unknown") for p in patients_col.find({}, {"name": 1})}
        doctor_map = {str(u["_id"]): u.get("name", "Unknown") for u in users_col.find({}, {"name": 1})}
        
        for o in orders:
            o["_id"] = str(o["_id"])
            o["patient_name"] = patient_map.get(o.get("patient_id"), "Unknown Patient")
            o["doctor_name"] = doctor_map.get(o.get("doctor_id"), "Unknown Doctor")
        return jsonify({"success": True, "data": orders}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@labs_bp.post("/")
@jwt_required()
@permission_required("write_records") # Doctors order labs
def create_lab_order():
    try:
        data = request.get_json() or {}
        patient_id = data.get("patient_id")
        test_name = data.get("test_name")
        instructions = data.get("instructions", "")
        
        if not patient_id or not test_name:
            return jsonify({"success": False, "message": "Patient and Test Name are required."}), 400
            
        order = {
            "patient_id": patient_id,
            "doctor_id": get_jwt_identity(),
            "test_name": test_name,
            "instructions": instructions,
            "status": "pending",
            "result_data": "",
            "date": datetime.datetime.utcnow().isoformat()
        }
        
        result = lab_orders_col.insert_one(order)
        log_action(get_jwt_identity(), "create", "LabOrder", str(result.inserted_id), f"Ordered test: {test_name}", request.remote_addr)
        return jsonify({"success": True, "message": "Lab test ordered.", "order_id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@labs_bp.patch("/<order_id>/results")
@jwt_required()
@permission_required("manage_inventory") # Using this permission for lab staff for now
def update_lab_results(order_id):
    try:
        data = request.get_json() or {}
        result_data = data.get("result_data", "").strip()
        
        if not result_data:
            return jsonify({"success": False, "message": "Result data is required."}), 400
            
        lab_orders_col.update_one(
            {"_id": ObjectId(order_id)},
            {"$set": {"status": "completed", "result_data": result_data, "completed_at": datetime.datetime.utcnow().isoformat()}}
        )
        return jsonify({"success": True, "message": "Results updated."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
