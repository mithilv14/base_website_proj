from datetime import datetime

from bson import ObjectId


def is_valid_object_id(value):
    return ObjectId.is_valid(value)


def to_object_id(value):
    return ObjectId(value) if is_valid_object_id(value) else None


def utc_now():
    return datetime.utcnow()


def serialize_doc(document):
    if not document:
        return None

    serialized = {}
    for key, value in document.items():
        if isinstance(value, ObjectId):
            serialized["id" if key == "_id" else key] = str(value)
        elif isinstance(value, datetime):
            serialized[key] = value.isoformat()
        elif isinstance(value, list):
            serialized[key] = [serialize_doc(item) if isinstance(item, dict) else item for item in value]
        elif isinstance(value, dict):
            serialized[key] = serialize_doc(value)
        else:
            serialized[key] = value

    return serialized


def serialize_list(documents):
    return [serialize_doc(document) for document in documents]


def error_response(message, status_code=400):
    return {"success": False, "message": message}, status_code


def success_response(message, data=None, status_code=200):
    payload = {"success": True, "message": message}
    if data is not None:
        payload["data"] = data
    return payload, status_code

def log_action(user_id, action, target_entity, target_id, details, ip_address="0.0.0.0"):
    try:
        from config import db, users_col
        from bson import ObjectId
        from datetime import datetime
        
        user = users_col.find_one({"_id": ObjectId(user_id)}) if user_id else {}
        user_name = user.get("name", "Unknown")
        role = user.get("role", "Unknown")
        
        audit_logs_col = db["audit_logs"]
        audit_logs_col.insert_one({
            "userId": str(user_id) if user_id else "",
            "userName": user_name,
            "role": role,
            "action": action,
            "targetEntity": target_entity,
            "targetId": str(target_id) if target_id else "",
            "details": details,
            "ipAddress": ip_address,
            "timestamp": datetime.utcnow().isoformat()
        })
    except Exception as e:
        print("Audit log error:", e)
