from pymongo import MongoClient



MONGO_URI = "mongodb+srv://mithilv:Mithil2006@cluster0.8w1kpa7.mongodb.net/?appName=Cluster0"
DB_NAME = "Healthcare"

DB_NAME = "Healthcare"
JWT_SECRET_KEY = "smrms_secret_key_2024"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

users_col = db["users"]
patients_col = db["patients"]
records_col = db["records"]
medicines_col = db["medicines"]
prescriptions_col = db["prescriptions"]
admin_requests_col = db["admin_requests"]
appointments_col = db["appointments"]
departments_col = db["departments"]
invoices_col = db["invoices"]
lab_orders_col = db["lab_orders"]

patients_col.create_index("name")
records_col.create_index("patient_id")
records_col.create_index("diagnosis")
admin_requests_col.create_index("email")
appointments_col.create_index("patient_id")
invoices_col.create_index("patient_id")
lab_orders_col.create_index("patient_id")
