import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import get_settings

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "arecanut.db")

# Production deploys set DATABASE_URL to a real PostgreSQL DSN, e.g.
#   postgresql+psycopg2://user:password@host:5432/arecanut
# Local development falls back to a SQLite file so the app still runs
# with zero external services. Same models/migrations work on both.
settings = get_settings()
DATABASE_URL = settings.DATABASE_URL or f"sqlite:///{DB_PATH}"

# Neon/Heroku-style URLs use the "postgres://" scheme, which SQLAlchemy 2.x
# no longer accepts — normalize to the psycopg2 dialect SQLAlchemy expects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://"):]

if settings.is_production and DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("Refusing to start in production against SQLite — set DATABASE_URL to a real database.")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_missing_columns():
    """
    Lightweight, idempotent auto-migration: adds any mapped column that
    exists in the SQLAlchemy models but not yet in the actual database table
    (via ALTER TABLE ... ADD COLUMN). This app has no real migration tooling
    wired up (Alembic is listed but unconfigured), and Base.metadata.create_all()
    only ever creates missing *tables* — it silently does nothing for a column
    added to an existing model, which would otherwise break every query
    against that table in production the moment new code deploys.

    Safe to call on every startup: each column is only added if genuinely
    missing, so a warm/repeat call is just an inspection query.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue  # a brand-new table — create_all() already handled it
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_cols:
                continue
            col_type = column.type.compile(dialect=engine.dialect)
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'
            with engine.begin() as conn:
                conn.execute(text(ddl))
