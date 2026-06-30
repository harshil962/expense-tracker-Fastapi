from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List
from datetime import date, datetime, timedelta
import sqlite3
import os
import bcrypt
from jose import jwt, JWTError

DB_PATH = os.path.join(os.path.dirname(__file__), "expenses.db")

# ---- JWT CONFIG ----
# IMPORTANT: In production, set this via an environment variable, not hardcoded.
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "change-this-secret-key-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

app = FastAPI(title="Expense Tracker API")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

CATEGORIES = [
    "Food", "Transport", "Shopping", "Entertainment", "Bills",
    "Health", "Education", "Travel", "Groceries", "Other"
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()
    conn.close()


init_db()


# ---------- AUTH HELPERS ----------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_email(email: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return row


def get_user_by_id(user_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row


async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = get_user_by_id(int(user_id))
    if user is None:
        raise credentials_exception
    return user


# ---------- SCHEMAS ----------

class UserSignup(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=72)


class UserOut(BaseModel):
    id: int
    name: str
    email: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ExpenseIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    amount: float = Field(..., gt=0)
    category: str
    date: date
    notes: Optional[str] = None


class ExpenseOut(ExpenseIn):
    id: int
    created_at: datetime


def row_to_expense(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "amount": row["amount"],
        "category": row["category"],
        "date": row["date"],
        "notes": row["notes"],
        "created_at": row["created_at"],
    }


def row_to_user(row) -> dict:
    return {"id": row["id"], "name": row["name"], "email": row["email"]}


# ---------- AUTH ROUTES ----------

@app.post("/api/auth/register", response_model=TokenOut)
def register(payload: UserSignup):
    if get_user_by_email(payload.email):
        raise HTTPException(400, "An account with this email already exists")

    conn = get_db()
    created_at = datetime.utcnow().isoformat()
    cur = conn.execute(
        "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (payload.name, payload.email, hash_password(payload.password), created_at),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    token = create_access_token({"sub": str(new_id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": new_id, "name": payload.name, "email": payload.email},
    }


@app.post("/api/auth/login", response_model=TokenOut)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # form_data.username carries the email
    user = get_user_by_email(form_data.username)
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": str(user["id"])})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": row_to_user(user),
    }


@app.get("/api/auth/me", response_model=UserOut)
def me(current_user=Depends(get_current_user)):
    return row_to_user(current_user)


# ---------- CATEGORY ROUTE (public) ----------

@app.get("/api/categories")
def get_categories():
    return CATEGORIES


# ---------- EXPENSE ROUTES (protected) ----------

@app.post("/api/expenses", response_model=ExpenseOut)
def create_expense(expense: ExpenseIn, current_user=Depends(get_current_user)):
    if expense.category not in CATEGORIES:
        raise HTTPException(400, f"Invalid category. Choose from {CATEGORIES}")
    conn = get_db()
    created_at = datetime.utcnow().isoformat()
    cur = conn.execute(
        "INSERT INTO expenses (user_id, title, amount, category, date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (current_user["id"], expense.title, expense.amount, expense.category, expense.date.isoformat(), expense.notes, created_at),
    )
    conn.commit()
    new_id = cur.lastrowid
    row = conn.execute("SELECT * FROM expenses WHERE id = ?", (new_id,)).fetchone()
    conn.close()
    return row_to_expense(row)


@app.get("/api/expenses", response_model=List[ExpenseOut])
def list_expenses(
    category: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    search: Optional[str] = None,
    sort_by: str = Query("date", pattern="^(date|amount|title|category)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    current_user=Depends(get_current_user),
):
    conn = get_db()
    query = "SELECT * FROM expenses WHERE user_id = ?"
    params: list = [current_user["id"]]

    if category and category != "All":
        query += " AND category = ?"
        params.append(category)
    if start_date:
        query += " AND date >= ?"
        params.append(start_date.isoformat())
    if end_date:
        query += " AND date <= ?"
        params.append(end_date.isoformat())
    if search:
        query += " AND (title LIKE ? OR notes LIKE ?)"
        params.append(f"%{search}%")
        params.append(f"%{search}%")

    query += f" ORDER BY {sort_by} {order.upper()}"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [row_to_expense(r) for r in rows]


@app.get("/api/expenses/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, current_user=Depends(get_current_user)):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM expenses WHERE id = ? AND user_id = ?", (expense_id, current_user["id"])
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Expense not found")
    return row_to_expense(row)


@app.put("/api/expenses/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, expense: ExpenseIn, current_user=Depends(get_current_user)):
    if expense.category not in CATEGORIES:
        raise HTTPException(400, f"Invalid category. Choose from {CATEGORIES}")
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM expenses WHERE id = ? AND user_id = ?", (expense_id, current_user["id"])
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Expense not found")
    conn.execute(
        "UPDATE expenses SET title=?, amount=?, category=?, date=?, notes=? WHERE id=? AND user_id=?",
        (expense.title, expense.amount, expense.category, expense.date.isoformat(), expense.notes, expense_id, current_user["id"]),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM expenses WHERE id = ?", (expense_id,)).fetchone()
    conn.close()
    return row_to_expense(row)


@app.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: int, current_user=Depends(get_current_user)):
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM expenses WHERE id = ? AND user_id = ?", (expense_id, current_user["id"])
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Expense not found")
    conn.execute("DELETE FROM expenses WHERE id = ? AND user_id = ?", (expense_id, current_user["id"]))
    conn.commit()
    conn.close()
    return {"message": "Deleted successfully"}


@app.get("/api/summary")
def summary(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    current_user=Depends(get_current_user),
):
    conn = get_db()
    query = "SELECT * FROM expenses WHERE user_id = ?"
    params: list = [current_user["id"]]
    if start_date:
        query += " AND date >= ?"
        params.append(start_date.isoformat())
    if end_date:
        query += " AND date <= ?"
        params.append(end_date.isoformat())
    rows = conn.execute(query, params).fetchall()
    conn.close()

    total = sum(r["amount"] for r in rows)
    by_category = {}
    for r in rows:
        by_category[r["category"]] = by_category.get(r["category"], 0) + r["amount"]

    by_month = {}
    for r in rows:
        month_key = r["date"][:7]  # YYYY-MM
        by_month[month_key] = by_month.get(month_key, 0) + r["amount"]

    return {
        "total": round(total, 2),
        "count": len(rows),
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
        "by_month": dict(sorted({k: round(v, 2) for k, v in by_month.items()}.items())),
        "average": round(total / len(rows), 2) if rows else 0,
    }


# ---------- FRONTEND ----------
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "index.html"))