# Expense Tracker (with JWT Auth)

A full-stack expense tracker built with FastAPI (backend) and vanilla HTML/CSS/JS + Chart.js (frontend).

## Features
- **JWT authentication**: sign up, log in, log out; passwords hashed with bcrypt
- Each user only sees their own expenses (per-user data isolation)
- Add, edit, delete expenses
- Categories: Food, Transport, Shopping, Entertainment, Bills, Health, Education, Travel, Groceries, Other
- Search, filter by category/date range, sort by date/amount/title/category
- Dashboard stats: total spent, transaction count, average expense, top category
- Charts: spending by category (doughnut) and spending over time (line)
- Data persisted in SQLite (expenses.db, auto-created on first run)

## Setup

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open http://127.0.0.1:8000 in your browser. You'll see a login/sign-up screen first — create an account to get started.

## Important: set a real JWT secret in production

The app reads the signing key from an environment variable:

```bash
# macOS/Linux
export JWT_SECRET_KEY="some-long-random-string"

# Windows PowerShell
$env:JWT_SECRET_KEY="some-long-random-string"
```

If unset, it falls back to a default dev key — fine for local testing, but change it before deploying anywhere real. Tokens expire after 7 days (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` in `main.py`).

## API Endpoints

**Auth**
- POST `/api/auth/register` — body: `{name, email, password}` → returns access token + user
- POST `/api/auth/login` — form-encoded `username` (email) + `password` → returns access token + user
- GET  `/api/auth/me` — returns the current logged-in user (requires Bearer token)

**Expenses (all require `Authorization: Bearer <token>`)**
- GET    /api/expenses          (filters: category, start_date, end_date, search, sort_by, order)
- POST   /api/expenses
- GET    /api/expenses/{id}
- PUT    /api/expenses/{id}
- DELETE /api/expenses/{id}
- GET    /api/summary           (filters: start_date, end_date)

**Public**
- GET /api/categories

Interactive API docs available at `/docs` (Swagger UI) — use the "Authorize" button there with your token to test protected routes.