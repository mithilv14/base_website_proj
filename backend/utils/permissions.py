# backend/utils/permissions.py

ROLES_AND_PERMISSIONS = {
    "admin": [
        "view_patients", 
        "view_records", 
        "manage_users", 
        "manage_inventory",
        "view_medicines",
        "view_prescriptions",
        "view_appointments",
        "manage_hospital",
        "view_dashboard",
        "manage_billing",
        "manage_labs"
    ],
    "doctor": [
        "view_patients", 
        "view_records",
        "write_records", 
        "prescribe",
        "view_medicines",
        "view_prescriptions",
        "view_appointments",
        "update_appointment_status",
        "view_dashboard",
        "manage_labs"
    ],
    "receptionist": [
        "view_patients",
        "manage_patients",
        "view_appointments",
        "manage_appointments",
        "update_appointment_status",
        "view_dashboard",
        "manage_billing",
        "manage_inventory"
    ]
}

def has_permission(role, permission):
    role = (role or "").lower()
    return permission in ROLES_AND_PERMISSIONS.get(role, [])
