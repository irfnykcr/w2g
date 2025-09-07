from traceback import print_exc
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from json import loads, dumps
from json import JSONDecodeError
from time import time
from bcrypt import checkpw
from mysql.connector import pooling
from dotenv import load_dotenv
from os import getenv
import signal
import sys
import atexit
load_dotenv()

app = FastAPI()

app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

connection_pool = pooling.MySQLConnectionPool(
	pool_name="mypool", 
	pool_size=10,
	pool_reset_session=True,
	host=getenv("MYSQL_HOST"),
	user=getenv("MYSQL_USER"),
	password=getenv("MYSQL_PASSWORD"),
	database=getenv("MYSQL_DATABASE")
)

PLAYER_STATUS = {}

def get_db_connection():
	try:
		return connection_pool.get_connection()
	except:
		print_exc()
		print(f"Error getting connection from pool")
		return None

def checkUser(user, psw):
	conn = get_db_connection()
	if not conn:
		return False
	cursor = None
	try:
		cursor = conn.cursor()
		cursor.execute("SELECT password_hash FROM users WHERE user = %s", (user,))
		result = cursor.fetchone()
		if result and checkpw(psw.encode(), result[0].encode()):
			return True
		return False
	except Exception as e:
		print(f"Error checking user: {e}")
		return False
	finally:
		if cursor:
			cursor.close()
		conn.close()

def checkRoom(roomid: str, roompsw: str):
	conn = get_db_connection()
	if not conn:
		return False
	cursor = None
	try:
		cursor = conn.cursor()
		cursor.execute("SELECT password_hash FROM rooms WHERE roomid = %s", (roomid,))
		result = cursor.fetchone()
		if result and checkpw(roompsw.encode(), result[0].encode()):
			return True
		return False
	except Exception as e:
		print(f"Error checking room: {e}")
		return False
	finally:
		if cursor:
			cursor.close()
		conn.close()

def get_player_status(roomid: str):
	global PLAYER_STATUS
	if roomid not in PLAYER_STATUS:
		PLAYER_STATUS[roomid] = {
			"is_playing": {"user": "", "value": False},
			"url": {"user": "", "value": ""},
			"uptodate": {},
			"time": {"user": "", "value": 0}
		}
	return PLAYER_STATUS[roomid]

def update_player_status(roomid: str, **kwargs):
	global PLAYER_STATUS
	if roomid not in PLAYER_STATUS:
		PLAYER_STATUS[roomid] = {
			"is_playing": {"user": "", "value": False},
			"url": {"user": "", "value": ""},
			"uptodate": {},
			"time": {"user": "", "value": 0}
		}
	
	for field, value in kwargs.items():
		if field in ['is_playing', 'url', 'uptodate', 'time']:
			PLAYER_STATUS[roomid][field] = value
	return True

def change_updatestatus_forall(roomid: str, except_user: str) -> bool:
	player_status = get_player_status(roomid)
	if not player_status or "uptodate" not in player_status:
		return False
		
	uptodate = player_status["uptodate"]
	
	for user in uptodate:
		if user == except_user: 
			uptodate[user] = True
		else:
			uptodate[user] = False
	
	update_player_status(roomid, uptodate=uptodate)
	return True

def check_ifcan_update(roomid: str, user: str) -> bool:
	player_status = get_player_status(roomid)
	if not player_status or "uptodate" not in player_status:
		return False
	uptodate = player_status["uptodate"]
	return uptodate.get(user, False)

def save_player_status_to_db():
	global PLAYER_STATUS
	conn = get_db_connection()
	if not conn:
		print("Failed to save player status to database")
		return
	
	cursor = None
	try:
		cursor = conn.cursor()
		
		for roomid, status in PLAYER_STATUS.items():
			is_playing = dumps(status.get("is_playing", {}))
			url = dumps(status.get("url", {}))
			time_data = dumps(status.get("time", {}))

			cursor.execute("""
				UPDATE player_status 
				SET is_playing = %s, url = %s, time = %s
				WHERE roomid = %s
			""", (is_playing, url, time_data, roomid))
		conn.commit()
		print(f"Saved player status for {len(PLAYER_STATUS)} rooms to database")
		
	except Exception as e:
		print(f"Error saving player status to database: {e}")
		print_exc()
	finally:
		if cursor:
			cursor.close()
		conn.close()

def load_player_status_from_db():
	global PLAYER_STATUS
	conn = get_db_connection()
	if not conn:
		print("Failed to load player status from database")
		return
	
	cursor = None
	try:
		cursor = conn.cursor()
		cursor.execute("SELECT roomid, is_playing, url, time FROM player_status")
		results = cursor.fetchall()
		
		for roomid, is_playing, url, time_data in results:
			PLAYER_STATUS[roomid] = {
				"is_playing": loads(is_playing) if is_playing else {"user": "", "value": False},
				"url": loads(url) if url else {"user": "", "value": ""},
				"uptodate": {},
				"time": loads(time_data) if time_data else {"user": "", "value": 0}
			}
		
		print(f"Loaded player status for {len(PLAYER_STATUS)} rooms from database")
		
	except Exception as e:
		print(f"Error loading player status from database: {e}")
		print_exc()
	finally:
		if cursor:
			cursor.close()
		conn.close()

def cleanup_and_save():
	print("Video sync server shutting down, saving player status...")
	save_player_status_to_db()

atexit.register(cleanup_and_save)
def signal_handler(sig, frame):
	print(f"Received signal {sig}")
	cleanup_and_save()
	sys.exit(0)
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

@app.on_event("startup")
async def startup_event():
	print("Video sync server starting up, loading player status from database...")
	load_player_status_from_db()

@app.on_event("shutdown")
async def shutdown_event():
	print("Video sync server shutting down, saving player status to database...")
	save_player_status_to_db()

class VideoSyncApp:
	def __init__(self):
		self.active_connections = {}

	def get_user_from_websocket(self, websocket):
		for room_data in self.active_connections.values():
			for user_data in room_data:
				if user_data["websocket"] == websocket:
					return user_data["user"]
		return None

	def get_room_from_websocket(self, websocket):
		for roomid, room_data in self.active_connections.items():
			for user_data in room_data:
				if user_data["websocket"] == websocket:
					return roomid
		return None

	async def broadcast_to_room(self, roomid, message, exclude_user=None):
		if roomid in self.active_connections:
			for user_data in self.active_connections[roomid]:
				if exclude_user and user_data["user"] == exclude_user:
					continue
				try:
					await user_data["websocket"].send_text(dumps(message))
				except Exception as e:
					print(f"Error sending to {user_data['user']}: {e}")

	async def handle_connect(self, websocket: WebSocket, user: str, roomid: str):
		if roomid not in self.active_connections:
			self.active_connections[roomid] = []
		
		self.active_connections[roomid].append({
			"websocket": websocket, 
			"user": user
		})
		
		player_status = get_player_status(roomid)
		uptodate = player_status.get("uptodate", {})
		
		uptodate[user] = False
		update_player_status(roomid, uptodate=uptodate)
		
		await websocket.send_text(dumps({
			"type": "initial_state",
			"url": player_status.get("url", {}).get("value", ""),
			"time": player_status.get("time", {}).get("value", 0),
			"is_playing": player_status.get("is_playing", {}).get("value", False),
			"url_user": player_status.get("url", {}).get("user", ""),
			"time_user": player_status.get("time", {}).get("user", ""),
			"playing_user": player_status.get("is_playing", {}).get("user", "")
		}))

	async def handle_disconnect(self, websocket: WebSocket):
		roomid = self.get_room_from_websocket(websocket)
		user = self.get_user_from_websocket(websocket)

		if not roomid or roomid not in self.active_connections:
			return
			
		if user:
			player_status = get_player_status(roomid)
			uptodate = player_status.get("uptodate", {})
			uptodate.pop(user, None)
			update_player_status(roomid, uptodate=uptodate)

		self.active_connections[roomid] = [
			user_data for user_data in self.active_connections[roomid] 
			if user_data["websocket"] != websocket
		]
		
		if not self.active_connections[roomid]:
			del self.active_connections[roomid]

	async def handle_message(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not user or not roomid:
			return
			
		message_type = data.get("type")
		print("got type:", message_type)
		request_id = data.get("requestId")
		
		if message_type == "get_playerstatus":
			player_status = get_player_status(roomid)
			await websocket.send_text(dumps({
				"type": "playerstatus_response",
				"data": player_status,
				"requestId": request_id
			}))
			
		elif message_type == "update_url":
			new_url = data.get("new_url")
			if check_ifcan_update(roomid, user):
				time_data = {"user": user, "value": 0}
				is_playing_data = {"user": user, "value": True}
				url_data = {"user": user, "value": new_url}
				
				update_player_status(roomid, time=time_data, is_playing=is_playing_data, url=url_data)
				change_updatestatus_forall(roomid, user)
				
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": True,
						"requestId": request_id
					}))
				
				await self.broadcast_to_room(roomid, {
					"type": "url_updated",
					"url": new_url,
					"user": user,
					"time": 0,
					"is_playing": True
				}, exclude_user=user)
			else:
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": False,
						"error": "user not authorized to update",
						"requestId": request_id
					}))
				
		elif message_type == "update_time":
			new_time = data.get("new_time")
			if check_ifcan_update(roomid, user):
				time_data = {"user": user, "value": new_time}
				update_player_status(roomid, time=time_data)
				change_updatestatus_forall(roomid, user)
				
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": True,
						"requestId": request_id
					}))
				
				await self.broadcast_to_room(roomid, {
					"type": "time_updated",
					"time": new_time,
					"user": user
				}, exclude_user=user)
			else:
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": False,
						"error": "user not authorized to update",
						"requestId": request_id
					}))
				
		elif message_type == "update_isplaying":
			is_playing = data.get("is_playing")
			new_time = data.get("new_time")
			if check_ifcan_update(roomid, user):
				is_playing_data = {"user": user, "value": is_playing}
				time_data = {"user": user, "value": new_time}
				
				update_player_status(roomid, is_playing=is_playing_data, time=time_data)
				change_updatestatus_forall(roomid, user)
				
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": True,
						"requestId": request_id
					}))
				
				await self.broadcast_to_room(roomid, {
					"type": "playing_updated",
					"is_playing": is_playing,
					"time": new_time,
					"user": user
				}, exclude_user=user)
			else:
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": False,
						"error": "user not authorized to update",
						"requestId": request_id
					}))
				
		elif message_type == "imuptodate":
			player_status = get_player_status(roomid)
			uptodate = player_status.get("uptodate", {})
			if user in uptodate:
				uptodate[user] = True
				update_player_status(roomid, uptodate=uptodate)
				
				if request_id:
					await websocket.send_text(dumps({
						"type": "update_response",
						"success": True,
						"requestId": request_id
					}))

video_sync = VideoSyncApp()

@app.websocket("/videosync/")
async def websocket_endpoint(
	websocket: WebSocket,
	user: str = Query(...),
	psw: str = Query(...),
	roomid: str = Query(...),
	roompsw: str = Query(...),
):
	if not (user and psw and roomid and roompsw):
		await websocket.close(code=1008, reason="Missing required parameters")
		return

	if not checkUser(user, psw):
		await websocket.close(code=1008, reason="Invalid user credentials")
		return

	if not checkRoom(roomid, roompsw):
		await websocket.close(code=1008, reason="Invalid room credentials")
		return

	await websocket.accept()
	
	try:
		await video_sync.handle_connect(websocket, user, roomid)

		while True:
			try:
				data = await websocket.receive_text()
				try:
					message_data = loads(data)
					await video_sync.handle_message(websocket, message_data)
				except JSONDecodeError:
					await websocket.send_text(dumps({
						"type": "error",
						"message": "Invalid message format"
					}))
				except Exception as e:
					print(f"Error handling message: {e}")
			except WebSocketDisconnect:
				break
			except Exception as e:
				print(f"Error receiving message: {e}")
				break
		await video_sync.handle_disconnect(websocket)
	except WebSocketDisconnect:
		await video_sync.handle_disconnect(websocket)
	except Exception as e:
		print(f"WebSocket error: {e}")
		await video_sync.handle_disconnect(websocket)


@app.post('/login_user')
async def login_user(request: Request):
	data = await request.json()
	user = str(data["user"])
	psw = str(data["psw"])
	return {"status": checkUser(user, psw)}
@app.post('/login_room')
async def login_room(request: Request):
	data = await request.json()
	room = str(data["room"])
	psw = str(data["psw"])
	return {"status": checkRoom(room, psw)}