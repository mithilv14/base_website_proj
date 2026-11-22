import sys
import os
from pathlib import Path

from bson import ObjectId
from flask import Flask, send_from_directory
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from config import JWT_SECRET_KEY, db
from routes.auth import auth_bp
from routes.dashboard import dashboard_bp
from routes.patients import patients_bp
from routes.pharmacy import pharmacy_bp
from routes.records import records_bp
from routes.admin import admin_bp
from routes.audit import audit_bp
from routes.appointments import appointments_bp
from routes.hospital import hospital_bp
from routes.billing import billing_bp
from routes.labs import labs_bp


try:
    db.command("ping")
    print("MongoDB connected to Healthcare database")
except Exception as e:
    print(f"MongoDB connection failed: {e}")
    sys.exit(1)


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = (BASE_DIR / "../frontend").resolve()


class CustomProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        return super().default(obj)


app = Flask(
    __name__,
    static_folder=str(FRONTEND_DIR),
    template_folder=str(FRONTEND_DIR),
)
app.json_provider_class = CustomProvider
app.json = CustomProvider(app)
app.config["JWT_SECRET_KEY"] = JWT_SECRET_KEY

CORS(app)
JWTManager(app)


@app.after_request
def after_request(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    return response


app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(patients_bp, url_prefix="/api/patients")
app.register_blueprint(records_bp, url_prefix="/api/records")
app.register_blueprint(pharmacy_bp, url_prefix="/api/pharmacy")
app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
app.register_blueprint(admin_bp, url_prefix="/api/admin")
app.register_blueprint(audit_bp, url_prefix="/api/admin/audit-logs")
app.register_blueprint(appointments_bp, url_prefix="/api/appointments")
app.register_blueprint(hospital_bp, url_prefix="/api/hospital")
app.register_blueprint(billing_bp, url_prefix="/api/billing")
app.register_blueprint(labs_bp, url_prefix="/api/labs")


@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(debug=True, port=port)
