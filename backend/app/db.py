import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

database_url = settings.database_url
# Railway (and Heroku before it) sometimes hands out the old "postgres://"
# scheme — SQLAlchemy 1.4+/2.0 only accepts "postgresql://".
if database_url.startswith("postgres://"):
    database_url = "postgresql://" + database_url[len("postgres://") :]

# Make sure sqlite's parent directory exists (e.g. ./data/app.db).
if database_url.startswith("sqlite:///"):
    db_path = database_url.replace("sqlite:///", "", 1)
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from . import models  # noqa: F401  (ensure models are registered before create_all)

    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
