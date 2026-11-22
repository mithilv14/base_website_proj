import os
import sys

import bcrypt


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from config import medicines_col, patients_col, users_col  # noqa: E402


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def main():
    users = [
        {"name": "Admin User", "email": "admin@smrms.com", "password": hash_password("password123"), "role": "admin"},
        {"name": "Dr. Meera Sharma", "email": "doctor@smrms.com", "password": hash_password("password123"), "role": "doctor"},
        {"name": "Reception Desk", "email": "reception@smrms.com", "password": hash_password("password123"), "role": "receptionist"},
    ]

    for user in users:
        users_col.update_one({"email": user["email"]}, {"$setOnInsert": user}, upsert=True)

    patients = [
        {"name": "Aarav Patel", "age": 29, "gender": "Male", "contact": "9876500011", "address": "Ahmedabad", "blood_group": "B+", "created_at": "2026-01-01T09:00:00"},
        {"name": "Priya Nair", "age": 34, "gender": "Female", "contact": "9876500022", "address": "Kochi", "blood_group": "O+", "created_at": "2026-01-02T09:15:00"},
        {"name": "Rohan Gupta", "age": 41, "gender": "Male", "contact": "9876500033", "address": "Delhi", "blood_group": "A+", "created_at": "2026-01-03T10:00:00"},
        {"name": "Sneha Iyer", "age": 25, "gender": "Female", "contact": "9876500044", "address": "Chennai", "blood_group": "AB+", "created_at": "2026-01-04T10:20:00"},
        {"name": "Kabir Khan", "age": 52, "gender": "Male", "contact": "9876500055", "address": "Mumbai", "blood_group": "O-", "created_at": "2026-01-05T11:00:00"},
    ]

    for patient in patients:
        patients_col.update_one({"name": patient["name"], "contact": patient["contact"]}, {"$setOnInsert": patient}, upsert=True)

    medicines = [
        {"name": "Paracetamol", "price": 15.0, "stock": 120},
        {"name": "Amoxicillin", "price": 45.0, "stock": 80},
        {"name": "Cetirizine", "price": 18.0, "stock": 95},
        {"name": "Omeprazole", "price": 32.5, "stock": 60},
        {"name": "Vitamin C", "price": 22.0, "stock": 140},
    ]

    for medicine in medicines:
        medicines_col.update_one({"name": medicine["name"]}, {"$set": medicine}, upsert=True)

    print("Seed data inserted successfully into Healthcare.")
    print("Login email: doctor@smrms.com | Password: password123")


if __name__ == "__main__":
    main()
