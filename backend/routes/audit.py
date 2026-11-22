from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from utils.auth_decorators import permission_required

from config import db
# Removed obsolete admin check

audit_bp = Blueprint("audit", __name__)
audit_logs_col = db["audit_logs"]

@audit_bp.get("/")
@jwt_required()
@permission_required("manage_hospital")
def get_audit_logs():
    try:

        page = int(request.args.get("page", 1))
        # Wait, the user specifically mentioned ?role=&action=&page= 
        # But for 15 logs on page load it's fine.
        
        limit = 20
        skip = (page - 1) * limit
        
        query = {}
        role = request.args.get("role", "").strip()
        if role:
            query["role"] = role
        action = request.args.get("action", "").strip()
        if action:
            query["action"] = action
            
        logs = list(audit_logs_col.find(query).sort("timestamp", -1).skip(skip).limit(limit))
        total_logs = audit_logs_col.count_documents(query)
        
        for item in logs:
            item["_id"] = str(item["_id"])
            
        return jsonify({"success": True, "data": logs, "total": total_logs, "page": page, "limit": limit}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching audit logs failed: {e}"}), 500
