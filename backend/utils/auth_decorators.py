from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity
from bson import ObjectId
from config import users_col
from utils.permissions import has_permission

def permission_required(permission_name):
    def wrapper(fn):
        @wraps(fn)
        def decorator(*args, **kwargs):
            user_id = get_jwt_identity()
            if not user_id:
                return jsonify({"success": False, "message": "Missing authentication."}), 401
            
            user = users_col.find_one({"_id": ObjectId(user_id)})
            if not user:
                return jsonify({"success": False, "message": "User not found."}), 404
            
            role = user.get("role", "")
            
            if not has_permission(role, permission_name):
                return jsonify({"success": False, "message": f"Unauthorized. Requires permission: {permission_name}"}), 403
            
            return fn(*args, **kwargs)
        return decorator
    return wrapper
