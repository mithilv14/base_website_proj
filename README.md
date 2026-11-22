# Smart Medical Record Management System (SMRMS)

SMRMS is integrated to run the HTML/CSS/JavaScript frontend and Flask API on the same server, backed by the local MongoDB database named `Healthcare`.

## Prerequisites

- MongoDB running locally on port `27017`
- Database named exactly: `Healthcare`
- Python 3.8+

## Install dependencies

```powershell
pip install flask pymongo flask-jwt-extended flask-cors bcrypt
```

## Seed sample data

Run this once from the project root:

```powershell
python seed_data.py
```

## Start the server

```powershell
cd backend
python app.py
```

## Open in browser

[http://127.0.0.1:5000](http://127.0.0.1:5000)

## Notes

- Flask serves the static frontend files directly from `frontend/`
- The API base URL used by the frontend is `http://127.0.0.1:5000/api`
- JWT login stores the token and role in `localStorage`
- MongoDB collections used are `users`, `patients`, `records`, `medicines`, and `prescriptions`
