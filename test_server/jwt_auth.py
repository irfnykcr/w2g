import jwt
from datetime import datetime, timedelta, timezone
from os import getenv
from dotenv import load_dotenv
import logging

load_dotenv()

logger = logging.getLogger("jwt_auth")

JWT_SECRET = getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 30

if not JWT_SECRET:
	raise ValueError("JWT_SECRET environment variable must be set")

def create_access_token(user: str, roomid = None) -> str:
	expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
	payload = {
		"sub": user,
		"type": "access",
		"exp": expire,
		"iat": datetime.now(timezone.utc)
	}
	if roomid:
		payload["roomid"] = roomid
	return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user: str) -> str:
	expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
	payload = {
		"sub": user,
		"type": "refresh",
		"exp": expire,
		"iat": datetime.now(timezone.utc)
	}
	return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str, token_type: str = "access") -> dict | None:
	try:
		payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
		if payload.get("type") != token_type:
			logger.warning(f"Token type mismatch: expected {token_type}, got {payload.get('type')}")
			return None
		return payload
	except jwt.ExpiredSignatureError:
		logger.debug("Token expired")
		return None
	except jwt.InvalidTokenError as e:
		logger.warning(f"Invalid token: {e}")
		return None

def get_user_from_token(token: str) -> str | None:
	payload = verify_token(token, "access")
	if payload:
		return payload.get("sub")
	return None

def get_roomid_from_token(token: str) -> str | None:
	payload = verify_token(token, "access")
	if payload:
		return payload.get("roomid")
	return None

def refresh_access_token(refresh_token: str, roomid = None) -> dict | None:
	payload = verify_token(refresh_token, "refresh")
	if not payload:
		return None
	user = payload.get("sub")
	if not user:
		return None
	new_access = create_access_token(user, roomid)
	return {
		"access_token": new_access,
		"user": user
	}
