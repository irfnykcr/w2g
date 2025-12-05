import logging
from traceback import print_exc
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from os import getenv, path, remove
from signal import signal, SIGTERM, SIGINT
import sys
import re
from base64 import b64decode, b64encode
from videoSyncBinary import BinaryProtocol, RoomManager
import async_db
import jwt_auth
from collections import defaultdict
import time as time_module

load_dotenv()

logging.basicConfig(
	level=logging.INFO,
	format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger("wssVideoSync")

MAX_URL_LENGTH = 2048
MAX_SUBTITLE_SIZE = 10 * 1024 * 1024
MAX_ROOMS = 1000
MAX_WS_MESSAGE_SIZE = 65536
ROOMID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

app = FastAPI()

ALLOWED_ORIGINS = [
	"app://.",
	"file://",
]

app.add_middleware(
	CORSMiddleware,
	allow_origin_regex=r"^(app://\.|file://|null)$",
	allow_credentials=True,
	allow_methods=["GET", "POST"],
	allow_headers=["Content-Type", "Authorization"],
)

class RateLimiter:
	def __init__(self, max_requests: int = 30, window_seconds: int = 60):
		self.max_requests = max_requests
		self.window_seconds = window_seconds
		self.requests = defaultdict(list)
	
	def is_allowed(self, key: str) -> bool:
		now = time_module.time()
		self.requests[key] = [t for t in self.requests[key] if now - t < self.window_seconds]
		if len(self.requests[key]) >= self.max_requests:
			return False
		self.requests[key].append(now)
		return True
	
	def cleanup(self):
		now = time_module.time()
		keys_to_delete = [k for k, v in self.requests.items() if not v or now - max(v) > self.window_seconds * 2]
		for k in keys_to_delete:
			del self.requests[k]

rate_limiter = RateLimiter(max_requests=60, window_seconds=60)
ws_rate_limiter = RateLimiter(max_requests=100, window_seconds=10)

HOME = getenv("DIR_SERVER")
SUBTITLES_DIR = fr"{HOME}/subtitles"

room_manager = RoomManager()

def check_url(url: str) -> bool:
	if not url:
		return False
	if len(url) > MAX_URL_LENGTH:
		return False
	if not url.startswith("https://"):
		return False
	try:
		host = url.split('/')[2].lower()
		if host in ('localhost', '127.0.0.1', '0.0.0.0', '[::1]'):
			return False
		if host.startswith('192.168.') or host.startswith('10.') or host.startswith('172.'):
			return False
	except:
		return False
	return True

def is_valid_roomid(roomid: str) -> bool:
	if not roomid:
		return False
	return bool(ROOMID_PATTERN.match(roomid))

def save_subtitle(roomid: str, subtitle_data: str, filename: str) -> bool:
	if not is_valid_roomid(roomid):
		logger.error(f"Invalid roomid for subtitle: {roomid}")
		return False
	try:
		decoded_data = b64decode(subtitle_data)
		if len(decoded_data) > MAX_SUBTITLE_SIZE:
			logger.error(f"Subtitle too large for room {roomid}")
			return False
		subtitle_path = path.join(SUBTITLES_DIR, f"{roomid}.vtt")
		with open(subtitle_path, 'wb') as f:
			f.write(decoded_data)
		logger.info(f"Saved subtitle for room {roomid}")
		return True
	except:
		print_exc()
		logger.error(f"Failed to save subtitle for room {roomid}")
		return False

def load_subtitle(roomid: str):
	if not is_valid_roomid(roomid):
		return None
	try:
		subtitle_path = path.join(SUBTITLES_DIR, f"{roomid}.vtt")
		if path.exists(subtitle_path):
			with open(subtitle_path, 'rb') as f:
				data = f.read()
			return b64encode(data).decode('utf-8')
		return None
	except:
		print_exc()
		return None

def delete_subtitle(roomid: str) -> bool:
	if not is_valid_roomid(roomid):
		return False
	subtitle_path = path.join(SUBTITLES_DIR, f"{roomid}.vtt")
	try:
		if path.exists(subtitle_path):
			remove(subtitle_path)
			logger.info(f"Deleted subtitle: {subtitle_path}")
			return True
		return False
	except:
		print_exc()
		return False

def subtitle_exists(roomid: str) -> bool:
	if not is_valid_roomid(roomid):
		return False
	return path.exists(path.join(SUBTITLES_DIR, f"{roomid}.vtt"))

async def save_rooms_to_db():
	try:
		for roomid, room in room_manager.rooms.items():
			await async_db.save_room_state(roomid, room.state.url, room.state.time, room.state.is_playing, room.state.subtitle_exist)
		logger.info(f"Saved {len(room_manager.rooms)} rooms to database")
	except:
		print_exc()

async def load_rooms_from_db():
	try:
		rows = await async_db.load_all_room_states()
		for roomid, url, time_val, is_playing, subtitle_exist in rows:
			if not is_valid_roomid(roomid):
				continue
			room = room_manager.get_or_create_room(roomid)
			room.state.url = url or ""
			try:
				room.state.time = int(time_val) if time_val else 0
			except (ValueError, TypeError):
				room.state.time = 0
			room.state.is_playing = bool(is_playing)
			room.state.subtitle_exist = bool(subtitle_exist)
		logger.info(f"Loaded {len(room_manager.rooms)} rooms from database")
	except:
		print_exc()

def signal_handler(sig, frame):
	logger.info(f"Received signal {sig}")
	sys.exit(0)

signal(SIGTERM, signal_handler)
signal(SIGINT, signal_handler)

@app.on_event("startup")
async def startup_event():
	await async_db.init_pool()
	logger.info("Starting up, loading room states...")
	await load_rooms_from_db()

@app.on_event("shutdown")
async def shutdown_event():
	logger.info("Shutting down, saving room states...")
	await save_rooms_to_db()
	await async_db.close_pool()


class VideoSyncHandler:
	def __init__(self):
		self.room_manager = room_manager

	async def broadcast(self, room, data: bytes, exclude_user: str | None = None):
		for user, conn in room.connections.items():
			if exclude_user and user == exclude_user:
				continue
			try:
				if conn.websocket.client_state.value == 1:
					await conn.websocket.send_bytes(data)
			except:
				logger.error(f"broadcast: Error sending to {user}")

	async def handle_connect(self, websocket: WebSocket, user: str, roomid: str):
		if len(self.room_manager.rooms) >= MAX_ROOMS and roomid not in self.room_manager.rooms:
			logger.error(f"Max rooms reached, rejecting {user}@{roomid}")
			await websocket.close(code=1008, reason="Max rooms reached")
			return False
		
		room = self.room_manager.get_or_create_room(roomid)
		existing = room.add_connection(user, websocket)
		if existing:
			logger.info(f"Kicking existing connection: {user}@{roomid}")
			try:
				await existing.websocket.close(code=1008, reason="New connection")
			except:
				pass
			room.connections[user].websocket = websocket
			room.connections[user].is_uptodate = False
		
		room.state.subtitle_exist = subtitle_exists(roomid)
		
		try:
			init_data = BinaryProtocol.encode_init(room.state)
			await websocket.send_bytes(init_data)
		except:
			logger.error(f"Error sending init to {user}")
		return True

	async def handle_disconnect(self, user: str, roomid: str):
		room = self.room_manager.get_room(roomid)
		if room:
			room.remove_connection(user)
		self.room_manager.cleanup_empty_rooms()

	async def handle_message(self, websocket: WebSocket, data: bytes, user: str, roomid: str):
		room = self.room_manager.get_room(roomid)
		if not room:
			return
		
		msg = BinaryProtocol.decode(data)
		if not msg:
			logger.warning(f"Failed to decode message from {user}")
			return
		
		request_id = msg.get('request_id', 0)
		msg_type = msg['type']
		logger.debug(f"msg: type={msg_type} user={user} room={roomid}")

		if msg_type == 'sync_req':
			init_data = BinaryProtocol.encode_init(room.state, request_id)
			await websocket.send_bytes(init_data)

		elif msg_type == 'uptodate':
			conn = room.get_connection(user)
			if conn:
				conn.is_uptodate = True

		elif msg_type == 'time':
			timeout_pass = msg.get('timeout_pass', False)
			time_val = min(max(0, int(msg.get('time', 0))), 0xFFFFFFFF)
			if room.can_update(user, 'time', timeout_pass):
				room.state.time = time_val
				room.state.time_user = user
				
				if timeout_pass:
					broadcast_data = BinaryProtocol.encode_time(time_val, 0, passive=True)
					await self.broadcast(room, broadcast_data, exclude_user=user)
				else:
					room.mark_all_not_uptodate(user)
					broadcast_data = BinaryProtocol.encode_time(time_val, 0, passive=False)
					await self.broadcast(room, broadcast_data, exclude_user=user)
				
				ack = BinaryProtocol.encode_ack(True, request_id)
				await websocket.send_bytes(ack)
			else:
				ack = BinaryProtocol.encode_ack(False, request_id, "not authorized")
				await websocket.send_bytes(ack)

		elif msg_type == 'state':
			time_val = min(max(0, int(msg.get('time', 0))), 0xFFFFFFFF)
			if room.can_update(user, 'state'):
				room.state.is_playing = msg['is_playing']
				room.state.time = time_val
				room.state.playing_user = user
				room.state.time_user = user
				room.mark_all_not_uptodate(user)
				
				broadcast_data = BinaryProtocol.encode_state(msg['is_playing'], time_val, 0)
				await self.broadcast(room, broadcast_data, exclude_user=user)
				
				ack = BinaryProtocol.encode_ack(True, request_id)
				await websocket.send_bytes(ack)
			else:
				ack = BinaryProtocol.encode_ack(False, request_id, "not authorized")
				await websocket.send_bytes(ack)


video_sync = VideoSyncHandler()


@app.websocket("/videosync/")
async def websocket_endpoint(websocket: WebSocket):
	await websocket.accept()
	
	try:
		data = await websocket.receive_bytes()
	except WebSocketDisconnect:
		return
	except Exception as e:
		logger.error(f"WS auth receive error: {e}")
		return
	
	msg = BinaryProtocol.decode(data)
	if not msg or msg.get('type') != 'auth':
		logger.error("First message must be AUTH")
		ack = BinaryProtocol.encode_ack(False, 0, "auth required")
		await websocket.send_bytes(ack)
		await websocket.close(code=1008, reason="Auth required")
		return
	
	token = msg.get('token', '')
	
	if not token:
		logger.error("Missing token")
		ack = BinaryProtocol.encode_ack(False, 0, "missing token")
		await websocket.send_bytes(ack)
		await websocket.close(code=1008, reason="Missing token")
		return

	payload = jwt_auth.verify_token(token)
	if not payload:
		logger.error("Invalid token")
		ack = BinaryProtocol.encode_ack(False, 0, "invalid token")
		await websocket.send_bytes(ack)
		await websocket.close(code=1008, reason="Invalid token")
		return
	
	user = payload.get("sub", "")
	roomid = payload.get("roomid", "")

	if not (user and roomid):
		logger.error("Token missing user or room")
		ack = BinaryProtocol.encode_ack(False, 0, "invalid token data")
		await websocket.send_bytes(ack)
		await websocket.close(code=1008, reason="Invalid token data")
		return

	if not is_valid_roomid(roomid):
		logger.error("Invalid roomid format")
		ack = BinaryProtocol.encode_ack(False, 0, "invalid room format")
		await websocket.send_bytes(ack)
		await websocket.close(code=1008, reason="Invalid room format")
		return

	ack = BinaryProtocol.encode_ack(True, 0)
	await websocket.send_bytes(ack)
	logger.info(f"WS auth OK: {user}@{roomid}")

	try:
		if not await video_sync.handle_connect(websocket, user, roomid):
			return

		while True:
			try:
				data = await websocket.receive_bytes()
				if len(data) > MAX_WS_MESSAGE_SIZE:
					logger.error(f"Message too large from {user}: {len(data)}")
					continue
				if not ws_rate_limiter.is_allowed(f"ws:{user}:{roomid}"):
					logger.warn(f"Rate limited WS user: {user}")
					continue
				await video_sync.handle_message(websocket, data, user, roomid)
			except WebSocketDisconnect:
				break
			except Exception as e:
				logger.error(f"WS error for {user}: {e}")
				break

		await video_sync.handle_disconnect(user, roomid)
	except WebSocketDisconnect:
		await video_sync.handle_disconnect(user, roomid)
	except Exception as e:
		logger.error(f"WS exception: {e}")
		await video_sync.handle_disconnect(user, roomid)


@app.post('/login_user')
async def login_user(request: Request):
	client_ip = request.client.host if request.client else "unknown"
	if not rate_limiter.is_allowed(f"login:{client_ip}"):
		return {"status": False, "error": "Rate limited"}
	data = await request.json()
	user = str(data.get("user", ""))
	psw = str(data.get("psw", ""))
	logger.info(f"login_user: {user}")
	if not await async_db.check_user(user, psw):
		return {"status": False}
	access_token = jwt_auth.create_access_token(user)
	refresh_token = jwt_auth.create_refresh_token(user)
	return {"status": True, "access_token": access_token, "refresh_token": refresh_token, "user": user}

@app.post('/refresh_token')
async def refresh_token(request: Request):
	client_ip = request.client.host if request.client else "unknown"
	if not rate_limiter.is_allowed(f"login:{client_ip}"):
		return {"status": False, "error": "Rate limited"}
	data = await request.json()
	refresh_token = str(data.get("refresh_token", ""))
	roomid = str(data.get("roomid", "") or "")
	logger.info(f"refresh_token: roomid={roomid}")
	result = jwt_auth.refresh_access_token(refresh_token, roomid if roomid else None)
	if not result:
		return {"status": False, "error": "Invalid refresh token"}
	return {"status": True, "access_token": result["access_token"], "user": result["user"]}

@app.post('/login_room')
async def login_room(request: Request):
	client_ip = request.client.host if request.client else "unknown"
	if not rate_limiter.is_allowed(f"login:{client_ip}"):
		return {"status": False, "error": "Rate limited"}
	data = await request.json()
	room = str(data.get("room", ""))
	psw = str(data.get("psw", ""))
	user_token = str(data.get("token", ""))
	logger.info(f"login_room: {room}")
	user = jwt_auth.get_user_from_token(user_token)
	if not user:
		return {"status": False, "error": "Invalid user token"}
	if not await async_db.check_room(room, psw):
		return {"status": False}
	access_token = jwt_auth.create_access_token(user, room)
	return {"status": True, "access_token": access_token}

@app.post('/get_current_url')
async def get_current_url(request: Request):
	data = await request.json()
	token = str(data.get("token", "") or "")
	if not token:
		return {"status": False, "error": "Missing token"}
	payload = jwt_auth.verify_token(token)
	if not payload:
		return {"status": False, "error": "Invalid token"}
	room = payload.get("roomid")
	if not room:
		return {"status": False, "error": "Token missing room"}
	r = room_manager.get_room(room)
	url = r.state.url if r else ""
	return {"status": True, "url": url}

@app.post('/setvideourl_offline')
async def setvideourl_offline(request: Request):
	data = await request.json()
	token = str(data.get("token", "") or "")
	new_url = str(data.get("new_url", "") or "")
	
	if not token:
		return {"status": False, "error": "Missing token"}
	payload = jwt_auth.verify_token(token)
	if not payload:
		return {"status": False, "error": "Invalid token"}
	user = payload.get("sub")
	roomid = payload.get("roomid")
	if not (user and roomid):
		return {"status": False, "error": "Token missing user or room"}
	
	logger.info(f"setvideourl_offline: {user}@{roomid} url={new_url}")
	
	if not new_url:
		return {"status": False, "error": "Missing URL"}
	
	url_valid = check_url(new_url)
	if not url_valid:
		return {"status": False, "error": "Invalid URL"}
	
	last_url = await async_db.get_last_video_url(roomid)
	if last_url == new_url:
		logger.info(f"setvideourl_offline: same URL, skipping {user}@{roomid}")
		return {"status": False, "error": "URL is the same as the current one"}
	
	history_entry = await async_db.add_to_history(roomid, user, new_url, url_valid)
	
	room = room_manager.get_or_create_room(roomid)
	room.state.url = new_url
	room.state.time = 0
	room.state.is_playing = True
	room.state.subtitle_exist = False
	room.state.url_user = user
	room.mark_all_not_uptodate(user)
	delete_subtitle(roomid)
	
	broadcast_data = BinaryProtocol.encode_url(new_url, 0)
	await video_sync.broadcast(room, broadcast_data, exclude_user=user)
	
	return {"status": True, "history_entry": history_entry}

@app.post('/subtitle/upload')
async def upload_subtitle(request: Request):
	data = await request.json()
	token = str(data.get("token", "") or "")
	subtitle_data = str(data.get("subtitle_data", "") or "")
	filename = str(data.get("filename", "subtitle.vtt") or "subtitle.vtt")

	if not token:
		return {"status": False, "error": "Missing token"}
	payload = jwt_auth.verify_token(token)
	if not payload:
		return {"status": False, "error": "Invalid token"}
	user = payload.get("sub")
	roomid = payload.get("roomid")
	if not (user and roomid and subtitle_data):
		return {"status": False, "error": "Missing parameters"}

	if save_subtitle(roomid, subtitle_data, filename):
		room = room_manager.get_room(roomid)
		if room:
			room.state.subtitle_exist = True
			flag_data = BinaryProtocol.encode_subtitle_flag(True)
			await video_sync.broadcast(room, flag_data)
		return {"status": True}
	return {"status": False, "error": "Failed to save"}

@app.post('/subtitle/download')
async def download_subtitle(request: Request):
	data = await request.json()
	token = str(data.get("token", "") or "")

	if not token:
		return {"status": False, "error": "Missing token"}
	payload = jwt_auth.verify_token(token)
	if not payload:
		return {"status": False, "error": "Invalid token"}
	roomid = payload.get("roomid")
	if not roomid:
		return {"status": False, "error": "Token missing room"}

	subtitle_data = load_subtitle(roomid)
	if subtitle_data:
		return {"status": True, "subtitle_data": subtitle_data, "filename": f"{roomid}.vtt"}
	return {"status": False, "error": "No subtitle found"}

