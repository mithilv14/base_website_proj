import bcrypt
from datetime import datetime
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from config import users_col


auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/signup")
def signup():
    try:
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        role = data.get("role", "receptionist").strip().lower()

        if not name or not email or not password:
            return jsonify({"success": False, "message": "Name, email, and password are required."}), 400

        if role not in {"admin", "doctor", "receptionist"}:
            return jsonify({"success": False, "message": "Role must be admin, doctor, or receptionist."}), 400

        existing_user = users_col.find_one({"email": email})
        if existing_user:
            return jsonify({"success": False, "message": "An account with this email already exists."}), 409

        hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        status = "pending"
        isApproved = False
        role_label = role.capitalize()
        message = f"{role_label} signup request submitted. An existing admin must approve it before you can log in."

        result = users_col.insert_one(
            {
                "name": name,
                "email": email,
                "password": hashed_password,
                "role": role,
                "status": status,
                "isApproved": isApproved,
                "requested_at": datetime.utcnow().isoformat()
            }
        )

        return jsonify(
            {
                "success": True,
                "message": message,
                "user_id": str(result.inserted_id),
            }
        ), 202
    except Exception as e:
        return jsonify({"success": False, "message": f"Signup failed: {e}"}), 500


@auth_bp.post("/login")
def login():
    try:
        data = request.get_json() or {}
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"success": False, "message": "Email and password are required."}), 400

        user = users_col.find_one({"email": email})
        if not user:
            return jsonify({"success": False, "message": "Invalid email or password."}), 401

        stored_password = user.get("password", "")
        
        try:
            if not bcrypt.checkpw(password.encode("utf-8"), stored_password.encode("utf-8")):
                return jsonify({"success": False, "message": "Invalid email or password."}), 401
        except ValueError:
            # Fallback for legacy plaintext passwords failing the bcrypt check format
            if password != stored_password:
                return jsonify({"success": False, "message": "Invalid email or password."}), 401
            
            # Automatically upgrade the account's plaintext password to a secure bcrypt hash for future logins
            hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            users_col.update_one({"_id": user["_id"]}, {"$set": {"password": hashed_password}})

        if not user.get("isApproved", True) or user.get("status") == "pending":
            role_label = (user.get("role") or "User").capitalize()
            return jsonify({"success": False, "message": f"Your {role_label.lower()} account is awaiting admin approval."}), 403

        token = create_access_token(identity=str(user["_id"]))
        user["_id"] = str(user["_id"])
        user.pop("password", None)

        return jsonify(
            {
                "success": True,
                "message": "Login successful.",
                "token": token,
                "role": user.get("role", ""),
                "user": user,
            }
        ), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Login failed: {e}"}), 500
