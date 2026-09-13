import datetime
import hashlib
import secrets
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from . import models as m

settings = get_settings()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


# ---------------- password hashing ----------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def validate_password_strength(password: str) -> Optional[str]:
    """Returns an error message if the password is too weak, else None."""
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if not any(c.isupper() for c in password):
        return "Password must include at least one uppercase letter."
    if not any(c.isdigit() for c in password):
        return "Password must include at least one digit."
    return None


# ---------------- access tokens (JWT, short-lived) ----------------

def create_access_token(user: m.User) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user.id), "username": user.username, "role": user.role, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> m.User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_error
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise credentials_error
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except JWTError:
        raise credentials_error

    user = db.query(m.User).get(int(user_id))
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_role(*roles: str):
    def dependency(user: m.User = Depends(get_current_user)) -> m.User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted for this role")
        return user
    return dependency


# ---------------- refresh tokens (opaque, rotated, DB-backed) ----------------

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(db: Session, user: m.User) -> str:
    raw = secrets.token_urlsafe(48)
    row = m.RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(raw),
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(row)
    db.commit()
    return raw


def rotate_refresh_token(db: Session, raw_token: str) -> tuple[m.User, str]:
    """Validates a refresh token, revokes it, and issues a replacement.
    Raises HTTPException(401) if the token is missing, expired, or already used."""
    invalid = HTTPException(status_code=401, detail="Invalid or expired refresh token")
    row = db.query(m.RefreshToken).filter(m.RefreshToken.token_hash == _hash_token(raw_token)).first()
    if not row:
        raise invalid
    if row.revoked_at is not None:
        # Reuse of an already-rotated token: treat every other session for this
        # user as compromised and revoke them all, forcing a fresh login.
        db.query(m.RefreshToken).filter(
            m.RefreshToken.user_id == row.user_id, m.RefreshToken.revoked_at.is_(None)
        ).update({"revoked_at": datetime.datetime.utcnow()})
        db.commit()
        raise invalid
    if row.expires_at < datetime.datetime.utcnow():
        raise invalid

    user = db.query(m.User).get(row.user_id)
    if not user or not user.is_active:
        raise invalid

    row.revoked_at = datetime.datetime.utcnow()
    db.commit()
    new_raw = issue_refresh_token(db, user)
    return user, new_raw


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    row = db.query(m.RefreshToken).filter(m.RefreshToken.token_hash == _hash_token(raw_token)).first()
    if row and row.revoked_at is None:
        row.revoked_at = datetime.datetime.utcnow()
        db.commit()


def revoke_all_refresh_tokens(db: Session, user_id: int) -> None:
    """Used after a password reset — every existing session is force-logged-out."""
    db.query(m.RefreshToken).filter(
        m.RefreshToken.user_id == user_id, m.RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.datetime.utcnow()})
    db.commit()


# ---------------- password reset tokens (opaque, single-use, DB-backed) ----------------

def issue_password_reset_token(db: Session, user: m.User) -> str:
    raw = secrets.token_urlsafe(32)
    row = m.PasswordResetToken(
        user_id=user.id,
        token_hash=_hash_token(raw),
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
    )
    db.add(row)
    db.commit()
    return raw


def consume_password_reset_token(db: Session, raw_token: str) -> m.User:
    """Validates a reset token (unused, unexpired) and marks it used.
    Raises HTTPException(400) if the token is invalid, expired, or already used."""
    invalid = HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    row = db.query(m.PasswordResetToken).filter(m.PasswordResetToken.token_hash == _hash_token(raw_token)).first()
    if not row or row.used_at is not None or row.expires_at < datetime.datetime.utcnow():
        raise invalid

    user = db.query(m.User).get(row.user_id)
    if not user or not user.is_active:
        raise invalid

    row.used_at = datetime.datetime.utcnow()
    db.commit()
    return user


# ---------------- account lockout ----------------

def register_failed_login(db: Session, user: m.User) -> None:
    user.failed_login_count = (user.failed_login_count or 0) + 1
    if user.failed_login_count >= MAX_FAILED_LOGINS:
        user.locked_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOCKOUT_MINUTES)
    db.commit()


def register_successful_login(db: Session, user: m.User) -> None:
    user.failed_login_count = 0
    user.locked_until = None
    db.commit()


def is_locked(user: m.User) -> bool:
    return bool(user.locked_until and user.locked_until > datetime.datetime.utcnow())


# ---------------- audit log ----------------

def audit(db: Session, request: Optional[Request], action: str, user: Optional[m.User] = None,
          username: Optional[str] = None, resource: Optional[str] = None, detail: Optional[str] = None) -> None:
    entry = m.AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else username,
        action=action,
        resource=resource,
        ip_address=request.client.host if request and request.client else None,
        detail=detail,
    )
    db.add(entry)
    db.commit()
