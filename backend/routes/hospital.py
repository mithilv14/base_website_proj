from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from config import departments_col, users_col
from utils.auth_decorators import permission_required
from utils.helpers import log_action

hospital_bp = Blueprint("hospital", __name__)

@hospital_bp.get("/departments")
@jwt_required()
def get_departments():
    try:
        depts = list(departments_col.find())
        for d in depts:
            d["_id"] = str(d["_id"])
        return jsonify({"success": True, "data": depts}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@hospital_bp.post("/departments")
@jwt_required()
@permission_required("manage_hospital")
def add_department():
    try:
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        fee = float(data.get("fee", 0))

        if not name:
            return jsonify({"success": False, "message": "Department name is required."}), 400

        res = departments_col.update_one(
            {"name": name},
            {"$set": {"name": name, "fee": fee}},
            upsert=True
        )
        log_action(get_jwt_identity(), "update", "Department", name, f"Updated department {name}", request.remote_addr)
        return jsonify({"success": True, "message": "Department saved."}), 201
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

@hospital_bp.patch("/doctors/<doctor_id>/department")
@jwt_required()
@permission_required("manage_hospital")
def assign_doctor_department(doctor_id):
    try:
        data = request.get_json() or {}
        dept_id = data.get("department_id")
        
        if not dept_id:
            return jsonify({"success": False, "message": "Department ID is required."}), 400
            
        dept = departments_col.find_one({"_id": ObjectId(dept_id)})
        if not dept:
            return jsonify({"success": False, "message": "Department not found."}), 404
            
        users_col.update_one(
            {"_id": ObjectId(doctor_id)},
            {"$set": {"department_id": str(dept_id), "department_name": dept["name"]}}
        )
        
        log_action(get_jwt_identity(), "update", "Doctor", doctor_id, f"Assigned doctor to {dept['name']}", request.remote_addr)
        return jsonify({"success": True, "message": f"Doctor assigned to {dept['name']}."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
