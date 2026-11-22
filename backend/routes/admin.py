from datetime import datetime
from bson import ObjectId
from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from config import users_col
from utils.auth_decorators import permission_required

admin_bp = Blueprint("admin", __name__)

def get_current_admin():
    try:
        current_user = users_col.find_one({"_id": ObjectId(get_jwt_identity())})
        if not current_user or current_user.get("role") != "admin":
            return None
        return current_user
    except:
        return None

@admin_bp.get("/pending-requests")
@jwt_required()
@permission_required("manage_hospital")
def get_admin_requests():
    try:
        requests = list(users_col.find({
            "role": {"$in": ["admin", "doctor", "receptionist"]},
            "status": "pending",
            "isApproved": False
        }).sort("requested_at", 1))

        grouped = {"admin": [], "doctor": [], "receptionist": []}
        for item in requests:
            item["_id"] = str(item["_id"])
            item.pop("password", None)
            item["requested_at"] = item.get("requested_at", "Unknown")
            grouped.setdefault(item.get("role", ""), []).append(item)

        return jsonify({"success": True, "data": grouped}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching admin requests failed: {e}"}), 500

@admin_bp.patch("/approve/<user_id>")
@jwt_required()
@permission_required("manage_hospital")
def approve_admin(user_id):
    try:
        pending_user = users_col.find_one({"_id": ObjectId(user_id), "status": "pending", "isApproved": False})
        if not pending_user:
            return jsonify({"success": False, "message": "Pending signup request not found."}), 404
        result = users_col.update_one(
            {"_id": ObjectId(user_id), "status": "pending"},
            {"$set": {"status": "approved", "isApproved": True}}
        )
        if result.matched_count == 0:
            return jsonify({"success": False, "message": "Pending signup request not found."}), 404

        role_label = (pending_user.get("role") or "user").capitalize()
        return jsonify({"success": True, "message": f"{role_label} signup approved successfully."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Approving admin failed: {e}"}), 500

@admin_bp.delete("/reject/<user_id>")
@jwt_required()
@permission_required("manage_hospital")
def reject_admin(user_id):
    try:
        pending_user = users_col.find_one({"_id": ObjectId(user_id), "status": "pending", "isApproved": False})
        if not pending_user:
            return jsonify({"success": False, "message": "Pending signup request not found."}), 404
        result = users_col.delete_one({"_id": ObjectId(user_id), "status": "pending"})
        if result.deleted_count == 0:
            return jsonify({"success": False, "message": "Pending signup request not found."}), 404

        role_label = (pending_user.get("role") or "user").capitalize()
        return jsonify({"success": True, "message": f"{role_label} signup request rejected."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Rejecting admin failed: {e}"}), 500
