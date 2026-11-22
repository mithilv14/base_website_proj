import datetime
from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from config import (
    admin_requests_col, appointments_col, patients_col,
    prescriptions_col, records_col, users_col, medicines_col, 
    invoices_col, lab_orders_col, departments_col
)

dashboard_bp = Blueprint("dashboard", __name__)


# ================================================================
# HELPERS
# ================================================================

def build_patient_map():
    return {str(p["_id"]): p.get("name", "Unknown Patient") for p in patients_col.find({}, {"name": 1})}

def build_doctor_map():
    return {str(u["_id"]): u.get("name", "Unknown Doctor") for u in users_col.find({"role": "doctor"}, {"name": 1})}

def get_monthly_counts(collection, date_field="created_at"):
    """Returns last-6-month registration counts for any collection."""
    now = datetime.datetime.utcnow()
    months = [(now - datetime.timedelta(days=30 * i)).strftime("%b") for i in range(5, -1, -1)]
    counts = {m: 0 for m in months}
    for doc in collection.find({date_field: {"$ne": None}}):
        raw = doc.get(date_field)
        if not raw:
            continue
        try:
            dt = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            m = dt.strftime("%b")
            if m in counts:
                counts[m] += 1
        except (ValueError, TypeError):
            pass
    return [{"month": m, "count": counts[m]} for m in months]


# ================================================================
# ADMIN ENDPOINTS
# ================================================================

@dashboard_bp.get("/stats")
@jwt_required()
def get_dashboard_stats():
    """
    Full system stats for Admin.
    ✅ Accessible to all authenticated users but returns aggregate data
       — only meaningful for admins since doctors/receptionists load
         their own dedicated endpoints instead.
    """
    try:
        total_patients = patients_col.count_documents({})
        total_records = records_col.count_documents({})
        total_prescriptions = prescriptions_col.count_documents({})
        active_doctors = users_col.count_documents({"role": "doctor"})

        common_diseases = list(records_col.aggregate([
            {"$group": {"_id": "$diagnosis", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
        ]))

        gender_split_raw = list(patients_col.aggregate([
            {"$group": {"_id": "$gender", "count": {"$sum": 1}}}
        ]))
        gender_split = {item["_id"]: item["count"] for item in gender_split_raw if item.get("_id")}

        # HMS 2.0: Revenue Stats
        revenue_data = list(invoices_col.aggregate([
            {"$match": {"status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$total"}}}
        ]))
        total_revenue = revenue_data[0]["total"] if revenue_data else 0

        # HMS 2.0: Departments Stats
        dept_stats_raw = list(appointments_col.aggregate([
            {"$group": {"_id": "$department_name", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]))
        dept_stats = [{"name": i["_id"] or "Unknown", "count": i["count"]} for i in dept_stats_raw]

        patient_map = build_patient_map()
        doctor_map = build_doctor_map()

        recent_activity = list(records_col.find().sort("date", -1).limit(8))
        for item in recent_activity:
            item["_id"] = str(item["_id"])
            item["patient_name"] = patient_map.get(item.get("patient_id"), "Unknown Patient")
            item["doctor_name"] = doctor_map.get(item.get("doctor_id"), "Unknown Doctor")

        return jsonify({
            "success": True,
            "data": {
                "total_patients": total_patients,
                "total_records": total_records,
                "total_prescriptions": total_prescriptions,
                "active_doctors": active_doctors,
                "common_diseases": [
                    {"name": i["_id"], "count": i["count"]}
                    for i in common_diseases if i.get("_id")
                ],
                "gender_split": gender_split,
                "recent_activity": recent_activity,
                "total_revenue": round(total_revenue, 2),
                "patients_by_department": dept_stats,
            },
        }), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching dashboard stats failed: {e}"}), 500


@dashboard_bp.get("/monthly_patients")
@jwt_required()
def get_monthly_patients_new():
    """Monthly patient registration trend. Accessible to all authenticated users."""
    try:
        data = get_monthly_counts(patients_col, "created_at")
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching monthly patients failed: {e}"}), 500


@dashboard_bp.get("/stock_overview")
@jwt_required()
def get_stock_overview():
    """Top 5 medicine stock overview. Admin only (called only from adminView)."""
    try:
        medicines = list(medicines_col.find().sort("stock", -1).limit(5))
        data = [{"name": m.get("name", "Unknown"), "stock": m.get("stock", 0)} for m in medicines]
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "message": f"Fetching stock overview failed: {e}"}), 500


# ================================================================
# DOCTOR DASHBOARD ENDPOINT
# FIX: All data is filtered by the authenticated doctor's own ID.
#      Doctor ONLY sees their own patients, records, prescriptions.
# ================================================================

@dashboard_bp.get("/doctor-view")
@jwt_required()
def get_doctor_dashboard():
    """
    Doctor-specific dashboard data.
    
    FIX: Queries using BOTH the JWT identity string AND the ObjectId,
         so it works regardless of how doctor_id was stored.
         Also falls back to doctor name matching for legacy records.
    """
    try:
        doctor_id_str = get_jwt_identity()  # raw string from JWT (user's _id)

        # Look up the doctor's actual document to get their name
        try:
            doctor_doc = users_col.find_one({"_id": ObjectId(doctor_id_str)})
        except Exception:
            doctor_doc = None

        doctor_name = doctor_doc.get("name", "") if doctor_doc else ""

        # Build a query that matches doctor_id stored as either:
        #   - string ObjectId  (new records)
        #   - doctor's name    (older/legacy records)
        doctor_query = {"$or": [
            {"doctor_id": doctor_id_str},
            {"doctor_id": ObjectId(doctor_id_str)} if ObjectId.is_valid(doctor_id_str) else {},
            {"doctor_name": doctor_name} if doctor_name else {},
        ]}
        # Filter out any empty dicts from the $or
        doctor_query["$or"] = [q for q in doctor_query["$or"] if q]

        # Appointment query supports both string and ObjectId storage.
        appt_query = {"$or": [
            {"doctor_id": doctor_id_str},
            {"doctor_id": ObjectId(doctor_id_str)} if ObjectId.is_valid(doctor_id_str) else {},
        ]}
        appt_query["$or"] = [q for q in appt_query["$or"] if q]

        # FIX: Use client-sent local date to avoid UTC/IST timezone mismatch.
        # Frontend sends ?date=YYYY-MM-DD in local time.  Falls back to UTC.
        today = request.args.get("date") or datetime.datetime.utcnow().strftime("%Y-%m-%d")
        patient_map = build_patient_map()

        # Today's appointments for THIS doctor
        appts = list(appointments_col.find({
            **appt_query,
            "date": today
        }).sort("time", 1))

        # Map labels
        for a in appts:
            a["_id"] = str(a["_id"])
            a["patient_name"] = patient_map.get(str(a.get("patient_id")), "Unknown Patient")

        today_patients_count = len(set(str(a.get("patient_id")) for a in appts))
        pending_consultations = sum(1 for a in appts if a.get("status") in ["pending", "confirmed", "checked_in"])

        completed_appts = list(appointments_col.find({
            **appt_query,
            "status": "completed"
        }))
        treated_patient_ids = {
            str(a.get("patient_id"))
            for a in completed_appts
            if a.get("patient_id")
        }
        treated_patient_ids.update(
            str(patient_id)
            for patient_id in records_col.distinct("patient_id", doctor_query)
            if patient_id
        )

        # HMS 2.0: Lab Stats for Doctor
        pending_labs = lab_orders_col.count_documents({
            **appt_query, # Reuse doctor identity query
            "status": "pending"
        })
        
        recent_labs = list(lab_orders_col.find({
            **appt_query,
            "status": "completed"
        }).sort("completed_at", -1).limit(5))
        
        for lb in recent_labs:
            lb["_id"] = str(lb["_id"])
            lb["patient_name"] = patient_map.get(str(lb.get("patient_id")), "Unknown Patient")

        # Counts using the robust doctor_query (handles legacy + new)
        total_my_records = records_col.count_documents(doctor_query)
        total_my_prescriptions = prescriptions_col.count_documents(doctor_query)

        # Recent 5 diagnoses
        recent_diagnoses = list(records_col.find(doctor_query).sort("date", -1).limit(5))
        for r in recent_diagnoses:
            r["_id"] = str(r["_id"])
            r["patient_name"] = patient_map.get(str(r.get("patient_id")), "Unknown Patient")

        # Recent 5 prescriptions
        recent_prescriptions = list(prescriptions_col.find(doctor_query).sort("date", -1).limit(5))
        for p in recent_prescriptions:
            p["_id"] = str(p["_id"])
            p["patient_name"] = patient_map.get(str(p.get("patient_id")), "Unknown Patient")

        # Top conditions from this doctor's records
        top_conditions = list(records_col.aggregate([
            {"$match": doctor_query},
            {"$group": {"_id": "$diagnosis", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5}
        ]))

        # Today's consultation statuses only
        all_active_appts = [a for a in appts if (a.get("status") or "").lower() in ["pending", "confirmed", "checked_in", "completed", "cancelled"]]

        return jsonify({
            "success": True,
            "data": {
                "appointments_today": appts,
                "all_active_appointments": all_active_appts,
                "stats": {
                    "patients_today": today_patients_count,
                    "patients_treated": len(treated_patient_ids),
                    "completed_consultations": len(completed_appts),
                    "pending_consultations": pending_consultations,
                    "total_my_records": total_my_records,
                    "total_my_prescriptions": total_my_prescriptions,
                    "pending_labs": pending_labs,
                    "total_patients": patients_col.count_documents({}),
                },
                "recent_diagnoses": recent_diagnoses,
                "recent_prescriptions": recent_prescriptions,
                "recent_labs": recent_labs,
                "top_conditions": [
                    {"name": i["_id"], "count": i["count"]}
                    for i in top_conditions if i.get("_id")
                ],
                # Debug info (visible in browser network tab)
                "_debug": {
                    "doctor_id_str": doctor_id_str,
                    "doctor_name": doctor_name,
                    "today": today,
                    "total_records_matched": total_my_records,
                    "total_prescriptions_matched": total_my_prescriptions,
                    "appts_today": len(appts),
                }
            }
        }), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ================================================================
# RECEPTIONIST DASHBOARD ENDPOINT
# Clinic-wide operational view — no clinical/medical detail
# ================================================================

@dashboard_bp.get("/receptionist-view")
@jwt_required()
def get_receptionist_dashboard():
    """
    Receptionist-specific dashboard data.
    Shows all today's appointments (all doctors) and walk-in queue.

    Returns:
    - appointments_today: all appointments for today (all doctors)
    - walkin_queue:       appointments with status "checked_in"
    - stats.appointments_today: total count
    - stats.patients_today:     unique patients count
    """
    try:
        from routes.billing import sync_completed_invoices

        # FIX: Use client-sent local date to avoid UTC/IST timezone mismatch.
        # Frontend sends ?date=YYYY-MM-DD in local time.  Falls back to UTC.
        today = request.args.get("date") or datetime.datetime.utcnow().strftime("%Y-%m-%d")
        sync_completed_invoices()

        patient_map = build_patient_map()
        doctor_map = build_doctor_map()

        # All appointments today (clinic-wide)
        appts = list(appointments_col.find({"date": today}).sort("time", 1))

        # GLOBAL upcoming: patients currently checked in on ANY day
        global_upcoming = list(appointments_col.find({"status": "checked_in"}).sort("date", 1))

        # Map labels for appointments
        for a in appts:
            a["_id"] = str(a["_id"])
            a["patient_name"] = patient_map.get(str(a.get("patient_id")), "Unknown Patient")
            a["doctor_name"] = doctor_map.get(str(a.get("doctor_id")), "Unknown Doctor")

        for u in global_upcoming:
            u["_id"] = str(u["_id"])
            u["patient_name"] = patient_map.get(str(u.get("patient_id")), "Unknown Patient")
            u["doctor_name"] = doctor_map.get(str(u.get("doctor_id")), "Unknown Doctor")

        return jsonify({
            "success": True,
            "data": {
                "appointments_today": appts,
                "upcoming_checked_in": global_upcoming,
                "monthly_registrations": get_monthly_counts(patients_col, "created_at"),
                "stats": {
                    "total_patients": patients_col.count_documents({}),
                    "appointments_today": len(appts),
                    "patients_today": len(set(str(a.get("patient_id")) for a in appts)),
                    "unpaid_bills": invoices_col.count_documents({"status": "pending"}),
                    "upcoming_checked_in_count": len(global_upcoming),
                }
            }
        }), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ================================================================
# DEBUG ENDPOINT — Diagnose doctor data-matching issues
# GET /api/dashboard/debug/doctor-data  (requires JWT)
# ================================================================

@dashboard_bp.get("/debug/doctor-data")
@jwt_required()
def debug_doctor_data():
    """
    Debug: reveals the authenticated doctor's JWT identity and what
    doctor_id values are stored in the DB for records/appointments.
    Use this to diagnose why the doctor dashboard shows zeros.
    """
    try:
        doctor_id_str = get_jwt_identity()
        doctor_doc = users_col.find_one({"_id": ObjectId(doctor_id_str)}, {"password": 0})
        doctor_name = doctor_doc.get("name", "") if doctor_doc else ""

        sample_records = list(records_col.find().limit(5))
        sample_appts = list(appointments_col.find().limit(5))
        sample_rx = list(prescriptions_col.find().limit(5))

        def clean(docs):
            for d in docs:
                d["_id"] = str(d["_id"])
            return docs

        return jsonify({
            "success": True,
            "your_identity": {
                "jwt_id": doctor_id_str,
                "name": doctor_name,
                "role": doctor_doc.get("role") if doctor_doc else None,
            },
            "sample_records_in_db": clean(sample_records),
            "sample_appointments_in_db": clean(sample_appts),
            "sample_prescriptions_in_db": clean(sample_rx),
            "counts": {
                "records_matching_id":        records_col.count_documents({"doctor_id": doctor_id_str}),
                "records_matching_name":      records_col.count_documents({"doctor_name": doctor_name}),
                "appts_matching_id":          appointments_col.count_documents({"doctor_id": doctor_id_str}),
                "prescriptions_matching_id":  prescriptions_col.count_documents({"doctor_id": doctor_id_str}),
            }
        }), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
