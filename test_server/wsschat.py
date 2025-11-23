import logging
from traceback import print_exc
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from asyncio import create_task, sleep, CancelledError
from starlette.websockets import WebSocketState
from fastapi.middleware.cors import CORSMiddleware
from json import loads, dumps
from json import JSONDecodeError
from time import time
from bcrypt import checkpw
from mysql.connector import pooling
from dotenv import load_dotenv
from os import getenv
load_dotenv()

logging.basicConfig(
	level=logging.DEBUG,
	format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger("wssChat")

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

def get_db_connection():
	try:
		return connection_pool.get_connection()
	except:
		print_exc()
		logger.error(f"Error getting connection from pool")
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
	except:
		print_exc()
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
		cursor.execute("SELECT password_hash, name FROM rooms WHERE roomid = %s", (roomid,))
		result = cursor.fetchone()
		if result and checkpw(roompsw.encode(), result[0].encode()):
			return result[1]
		return False
	except:
		print_exc()
		return False
	finally:
		if cursor:
			cursor.close()
		conn.close()


class ChatApp:
	def __init__(self):
		# {roomid: [{"websocket": websocket, "username": username}]}
		self.active_rooms = {}
		# {roomid: [{"username": username, "imageurl": imageurl}]}
		self.room_watchers = {}
		self.disconnect_tasks = {}
		self.presence_grace_seconds = 5
		self.keepalive_tasks = {}
		self.last_pong = {}
		self.keepalive_interval = 30
		self.keepalive_timeout = 90

	def _disconnect_key(self, roomid, user):
		return f"{roomid}:{user}"

	def cancel_pending_disconnect(self, roomid, user):
		key = self._disconnect_key(roomid, user)
		task = self.disconnect_tasks.pop(key, None)
		if task and not task.done():
			task.cancel()
			return True
		return False

	def schedule_disconnect_notice(self, roomid, user):
		key = self._disconnect_key(roomid, user)
		if key in self.disconnect_tasks:
			task = self.disconnect_tasks.pop(key)
			if task and not task.done():
				task.cancel()
		self.disconnect_tasks[key] = create_task(self._delayed_disconnect_notice(roomid, user))

	def start_keepalive(self, websocket):
		self.last_pong[websocket] = time()
		self.keepalive_tasks[websocket] = create_task(self._keepalive_loop(websocket))
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		logger.debug(f"keepalive started: user`{user}` roomid`{roomid}`")

	def stop_keepalive(self, websocket):
		task = self.keepalive_tasks.pop(websocket, None)
		if task and not task.done():
			task.cancel()
		self.last_pong.pop(websocket, None)
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		logger.debug(f"keepalive stopped: user`{user}` roomid`{roomid}`")

	async def _keepalive_loop(self, websocket):
		try:
			while True:
				await sleep(self.keepalive_interval)
				if not self.is_websocket_connected(websocket):
					break
				user = self.get_user_from_websocket(websocket)
				roomid = self.get_room_from_websocket(websocket)
				try:
					await websocket.send_text(dumps({"type": "server_ping", "ts": time()}))
					# logger.debug(f"server_ping sent: user`{user}` roomid`{roomid}`")
				except:
					print_exc()
					break
				last_seen = self.last_pong.get(websocket, time())
				if time() - last_seen > self.keepalive_timeout:
					try:
						await websocket.close(code=1011, reason="Server keepalive timeout")
						logger.debug(f"keepalive timeout close: user`{user}` roomid`{roomid}`")
					except:
						print_exc()
					break
		except CancelledError:
			return
		except:
			print_exc()
		finally:
			self.keepalive_tasks.pop(websocket, None)
			self.last_pong.pop(websocket, None)

	async def _delayed_disconnect_notice(self, roomid, user):
		try:
			await sleep(self.presence_grace_seconds)
			current_users = self.active_rooms.get(roomid, [])
			still_connected = any(u["username"] == user for u in current_users)
			if still_connected:
				return
			await self.send_message_to_room(roomid, f"{user} left.", no_history=True)
		except CancelledError:
			return
		except:
			print_exc()
		finally:
			key = self._disconnect_key(roomid, user)
			self.disconnect_tasks.pop(key, None)

	def get_user_from_websocket(self, websocket):
		for room_data in self.active_rooms.values():
			for user_data in room_data:
				if user_data["websocket"] == websocket:
					return user_data["username"]
		return None

	def get_room_from_websocket(self, websocket):
		for roomid, room_data in self.active_rooms.items():
			for user_data in room_data:
				if user_data["websocket"] == websocket:
					return roomid
		return None

	def is_websocket_connected(self, websocket):
		try:
			return (
				websocket.client_state == WebSocketState.CONNECTED and
				websocket.application_state == WebSocketState.CONNECTED
			)
		except:
			return False

	async def handle_watcher_update(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not user or not roomid:
			return
		
		is_watching = data.get("is_watching", False)
		current_time = data.get("current_time", 0)
		is_playing = data.get("is_playing", False)
		is_uptodate = data.get("is_uptodate", False)
		
		if roomid not in self.room_watchers:
			self.room_watchers[roomid] = []
		
		self.room_watchers[roomid] = [w for w in self.room_watchers[roomid] if w["username"] != user]
		
		self.room_watchers[roomid].append({
			"username": user,
			"current_time": current_time,
			"is_playing": is_playing,
			"is_uptodate": is_uptodate,
			"is_idle": not is_watching
		})
		
		await self.send_watchers_to_room(roomid)

	async def send_watchers_to_room(self, roomid):
		if roomid in self.active_rooms:
			watchers = self.room_watchers.get(roomid, [])
			data = {
				"type": "watchers_update",
				"watchers": watchers
			}

			for user_data in self.active_rooms[roomid]:
				websocket = user_data["websocket"]
				try:
					if self.is_websocket_connected(websocket):
						await websocket.send_text(dumps(data))
				except:
					print_exc()
					logger.error(f"Error sending watchers update to {user_data['username']}")

	async def handle_connect(self, websocket: WebSocket, user: str, roomid: str, lastMessageDate: float):
		if roomid not in self.active_rooms:
			self.active_rooms[roomid] = []

		logger.debug(f"handle_connect: user`{user}` roomid`{roomid}` lastMessageDate`{lastMessageDate}`")
		
		existing_user_data = None
		for user_data in self.active_rooms[roomid]:
			if user_data["username"] == user:
				existing_user_data = user_data
				break

		was_reconnect = existing_user_data is not None
		
		if existing_user_data:
			logger.info(f"Kicking existing user connection: user'{user}' roomid'{roomid}'")
			try:
				await existing_user_data["websocket"].close(code=1008, reason="New connection established")
			except:
				print_exc()
			self.stop_keepalive(existing_user_data["websocket"])
			
			self.active_rooms[roomid] = [
				user_data for user_data in self.active_rooms[roomid] 
				if user_data["username"] != user
			]
			
			if roomid in self.room_watchers:
				self.room_watchers[roomid] = [
					w for w in self.room_watchers[roomid] 
					if w["username"] != user
				]

		recently_left = self.cancel_pending_disconnect(roomid, user)
		
		self.active_rooms[roomid].append({"websocket": websocket, "username": user})
		self.start_keepalive(websocket)
		
		if roomid not in self.room_watchers:
			self.room_watchers[roomid] = []
		
		user_already_in_watchers = any(w["username"] == user for w in self.room_watchers[roomid])
		if not user_already_in_watchers:
			self.room_watchers[roomid].append({
				"username": user,
				"current_time": 0,
				"is_playing": False,
				"is_uptodate": False,
				"is_idle": True
			})
		
		if lastMessageDate > 0:
			await self.send_history_to_websocket(websocket, roomid, lastMessageDate)
		else:
			await self.send_history_to_websocket(websocket, roomid, limit=15)
		if not was_reconnect and not recently_left:
			await self.send_message_to_room(roomid, f"{user} joined.", no_history=True)
			logger.debug(f"join broadcast: user`{user}` roomid`{roomid}`")
		await self.send_watchers_to_room(roomid)

	async def handle_disconnect(self, websocket: WebSocket, close_code=None):
		roomid = self.get_room_from_websocket(websocket)
		user = self.get_user_from_websocket(websocket)
		if not user:
			logger.error(f"handle_disconnect: cant find user. roomid`{roomid}`")

		if roomid is None or roomid not in self.active_rooms:
			logger.error(f"handle_disconnect: room is not active. user`{user}`")
			return

		self.stop_keepalive(websocket)
		logger.debug(f"handle_disconnect: user`{user}` roomid`{roomid}` close_code`{close_code}`")
			
		self.schedule_disconnect_notice(roomid, user)
		if roomid in self.room_watchers:
			self.room_watchers[roomid] = [w for w in self.room_watchers[roomid] if w["username"] != user]

		self.active_rooms[roomid] = [user_data for user_data in self.active_rooms[roomid] if user_data["websocket"] != websocket]
		
		if not self.active_rooms[roomid]:
			del self.active_rooms[roomid]
			if roomid in self.room_watchers:
				del self.room_watchers[roomid]
		else:
			await self.send_watchers_to_room(roomid)
		
		logger.info(f"disconnected: user`{user}` roomid`{roomid}` close_code`{close_code}`")

	async def handle_message(self, websocket: WebSocket, data):
		if data.get("type") == "server_pong":
			self.last_pong[websocket] = time()
			user = self.get_user_from_websocket(websocket)
			roomid = self.get_room_from_websocket(websocket)
			# logger.debug(f"server_pong received: user`{user}` roomid`{roomid}`")
			return
		if data.get("type") == "watcher_update":
			await self.handle_watcher_update(websocket, data)
			return
		elif data.get("type") == "request_user_image":
			await self.handle_user_image_request(websocket, data)
			return
		elif data.get("type") == "new_reaction":
			await self.handle_reaction(websocket, data)
			return
		elif data.get("type") == "delete_message":
			await self.handle_message_deletion(websocket, data)
			return
		elif data.get("type") == "load_more_messages":
			await self.handle_load_more_messages(websocket, data)
			return
			
		message = data.get("message")
		reply_to = data.get("reply_to")
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		logger.info(f"handle_message: user`{user}` roomid`{roomid}` data`{data}`, reply_to`{reply_to}`")

		if not roomid:
			await self.send_message_to_websocket(websocket, "You are not in a room.")
			return
		if not user:
			await self.send_message_to_websocket(websocket, "User not found.")
			return
		await self.send_message_to_room(roomid, message, sender=user, reply_to_id=reply_to)

	async def handle_load_more_messages(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not roomid or not user:
			return
		
		before_message_id = data.get("before_message_id")
		if not before_message_id:
			return
		
		await self.send_history_to_websocket(websocket, roomid, before_message_id=before_message_id, limit=15)

	async def handle_reaction(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not roomid or not user:
			return
			
		emoji = data.get("emoji")
		reply_to = data.get("reply_to")
		
		if not emoji or not reply_to:
			return
			
		conn = get_db_connection()
		if not conn:
			return
			
		cursor = None
		try:
			cursor = conn.cursor()
			cursor.execute(
				"SELECT id, message, removed FROM messages WHERE roomid = %s AND user = %s AND message_type = 'new_reaction' AND reply_to = %s",
				(roomid, user, reply_to)
			)
			existing_reaction = cursor.fetchone()
			
			if existing_reaction:
				reaction_id = existing_reaction[0]
				existing_emoji = existing_reaction[1]
				is_removed = existing_reaction[2]
				
				if existing_emoji == emoji and not is_removed:
					cursor.execute(
						"UPDATE messages SET removed = 1 WHERE id = %s",
						(reaction_id,)
					)
					conn.commit()
					
					data = {
						"type": "reaction_removed",
						"id": reaction_id,
						"user": user,
						"message": emoji,
						"reply_to": reply_to,
						"date": time(),
						"message_type": "reaction_removed"
					}
					
					if roomid in self.active_rooms:
						for user_data in self.active_rooms[roomid]:
							websocket_user = user_data["websocket"]
							try:
								if self.is_websocket_connected(websocket_user):
									await websocket_user.send_text(dumps(data))
							except:
								print_exc()
								logger.error(f"Error sending reaction removal to {user_data['username']}")
					return
				else:
					cursor.execute(
						"UPDATE messages SET message = %s, removed = 0 WHERE id = %s",
						(emoji, reaction_id)
					)
			else:
				cursor.execute(
					"INSERT INTO messages (roomid, user, message, message_type, reply_to) VALUES (%s, %s, %s, %s, %s)",
					(roomid, user, emoji, "new_reaction", reply_to)
				)
				reaction_id = cursor.lastrowid
			
			conn.commit()
			
			data = {
				"type": "new_reaction",
				"id": reaction_id,
				"user": user,
				"message": emoji,
				"reply_to": reply_to,
				"date": time(),
				"message_type": "new_reaction"
			}
			
			if roomid in self.active_rooms:
				for user_data in self.active_rooms[roomid]:
					websocket_user = user_data["websocket"]
					try:
						if self.is_websocket_connected(websocket_user):
							await websocket_user.send_text(dumps(data))
					except:
						print_exc()
						logger.error(f"Error sending reaction to {user_data['username']}")
		except:
			print_exc()
		finally:
			if cursor:
				cursor.close()
			conn.close()

	async def handle_message_deletion(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not roomid or not user:
			return
			
		message_id = data.get("message_id")
		
		if not message_id:
			return
			
		conn = get_db_connection()
		if not conn:
			return
			
		cursor = None
		try:
			cursor = conn.cursor()
			cursor.execute(
				"SELECT user, removed FROM messages WHERE id = %s AND roomid = %s",
				(message_id, roomid)
			)
			result = cursor.fetchone()
			if not result:
				return
			message_owner, is_removed = result
			
			if message_owner != user:
				return
			if is_removed:
				return
			
			cursor.execute(
				"UPDATE messages SET removed = 1 WHERE id = %s",
				(message_id,)
			)
			
			cursor.execute(
				"UPDATE messages SET removed = 1 WHERE reply_to = %s AND message_type = 'new_reaction'",
				(message_id,)
			)
			
			conn.commit()
			
			data = {
				"type": "message_deleted",
				"message_id": message_id,
				"user": user,
				"date": time()
			}
			
			if roomid in self.active_rooms:
				for user_data in self.active_rooms[roomid]:
					websocket_user = user_data["websocket"]
					try:
						if self.is_websocket_connected(websocket_user):
							await websocket_user.send_text(dumps(data))
					except:
						print_exc()
						logger.error(f"Error sending message deletion to {user_data['username']}")
		except:
			print_exc()
		finally:
			if cursor:
				cursor.close()
			conn.close()

	async def send_history_to_websocket(self, websocket: WebSocket, roomid: str, lastMessageDate: float = 0, limit = 15, before_message_id = None):
		try:
			conn = get_db_connection()
			if not conn:
				logger.error("send_history_to_websocket: Failed to get database connection")
				return
			if limit > 15 or limit < 1:
				logger.error("send_history_to_websocket: limit error:", limit)
				return
			cursor = None
			try:
				cursor = conn.cursor()
				
				if lastMessageDate > 0:
					query = "SELECT id, user, message, message_type, date, reply_to, removed FROM messages \
						WHERE roomid = %s AND UNIX_TIMESTAMP(date) > %s ORDER BY id ASC"
					params = (roomid, lastMessageDate)
				elif before_message_id:
					query = """
						SELECT id, user, message, message_type, date, reply_to, removed 
						FROM messages 
						WHERE roomid = %s AND id < %s AND message_type = 'new_message'
						ORDER BY id DESC LIMIT %s
					"""
					params = (roomid, before_message_id, limit)
				else:
					query = """
						SELECT id, user, message, message_type, date, reply_to, removed 
						FROM messages 
						WHERE roomid = %s AND message_type = 'new_message'
						ORDER BY id DESC LIMIT %s
					"""
					params = (roomid, limit)
				
				cursor.execute(query, params)
				message_rows = cursor.fetchall()
				
				messages = []
				reaction_rows = []
				
				if message_rows:
					message_ids = [str(row[0]) for row in message_rows]
					if len(message_ids) > 0:
						placeholders = ','.join(['%s'] * len(message_ids))
						reaction_query = f"""
							SELECT id, user, message, message_type, date, reply_to, removed
							FROM messages 
							WHERE roomid = %s AND message_type = 'new_reaction' AND reply_to IN ({placeholders})
						"""
						cursor.execute(reaction_query, [roomid] + message_ids)
						reaction_rows = cursor.fetchall()
				
				all_rows = list(message_rows) + list(reaction_rows)
				all_rows.sort(key=lambda x: x[0])
				
				if before_message_id:
					all_rows = list(reversed(all_rows))
				
				for row in all_rows:
					thedate = row[4].timestamp()
					reply_to_data = None

					if row[5]: # reply_to field
						reply_cursor = conn.cursor()
						reply_cursor.execute(
							"SELECT user, message, removed FROM messages WHERE id = %s",
							(row[5],)
						)
						reply_result = reply_cursor.fetchone()
						if reply_result:
							if reply_result[2]: # if message is removed
								reply_to_data = {
									"id": row[5],
									"user": reply_result[0],
									"message": None,
									"is_deleted": True
								}
							else:
								reply_to_data = {
									"id": row[5],
									"user": reply_result[0],
									"message": reply_result[1],
									"is_deleted": False
								}
						reply_cursor.close()
					
					messages.append({
						"id": row[0],
						"user": row[1],
						"message": row[2],
						"message_type": row[3],
						"date": thedate,
						"reply_to": reply_to_data if not bool(row[6]) else None, # None if message is removed
						"is_deleted": bool(row[6]) # removed column
					})
				
				has_more = False
				if limit and len(message_rows) == limit:
					check_cursor = conn.cursor()
					if before_message_id:
						oldest_message_id = min(row[0] for row in message_rows)
						check_cursor.execute(
							"SELECT COUNT(*) FROM messages WHERE roomid = %s AND id < %s AND message_type = 'new_message'",
							(roomid, oldest_message_id)
						)
					else:
						oldest_message_id = min(row[0] for row in message_rows)
						check_cursor.execute(
							"SELECT COUNT(*) FROM messages WHERE roomid = %s AND id < %s AND message_type = 'new_message'",
							(roomid, oldest_message_id)
						)
					has_more = check_cursor.fetchone()[0] > 0
					check_cursor.close()
				
				data = {
					"type": "room_history",
					"messages": messages,
					"has_more": has_more,
					"is_pagination": before_message_id is not None
				}
				if self.is_websocket_connected(websocket):
					await websocket.send_text(dumps(data))
			finally:
				if cursor:
					cursor.close()
				conn.close()
		except:
			print_exc()

	async def send_message_to_websocket(self, websocket: WebSocket, message: str, sender: str = "system"):
		data = {
			"type": "new_message",
			"user": sender,
			"message": message,
			"date": time(),
		}
		try:
			if self.is_websocket_connected(websocket):
				await websocket.send_text(dumps(data))
		except:
			print_exc()

	async def send_message_to_room(self, roomid: str, message: str, sender: str = "system", no_history: bool = False, reply_to_id = None):
		if roomid in self.active_rooms:
			message_id = None
			reply_to_data = None
			
			if reply_to_id:
				conn = get_db_connection()
				if conn:
					cursor = None
					try:
						cursor = conn.cursor()
						cursor.execute(
							"SELECT user, message, removed FROM messages WHERE id = %s",
							(reply_to_id,)
						)
						reply_result = cursor.fetchone()
						if reply_result:
							if reply_result[2]: # if message is removed
								reply_to_data = {
									"id": reply_to_id,
									"user": reply_result[0],
									"message": None,
									"is_deleted": True
								}
							else:
								reply_to_data = {
									"id": reply_to_id,
									"user": reply_result[0],
									"message": reply_result[1],
									"is_deleted": False
								}
					except:
						print_exc()
					finally:
						if cursor:
							cursor.close()
						conn.close()
			
			if not no_history:
				conn = get_db_connection()
				if conn:
					cursor = None
					try:
						cursor = conn.cursor()
						cursor.execute(
							"INSERT INTO messages (roomid, user, message, message_type, reply_to) VALUES (%s, %s, %s, %s, %s)",
							(roomid, sender, message, "new_message", reply_to_id)
						)
						conn.commit()
						message_id = cursor.lastrowid # id of inserted
					except:
						print_exc()
					finally:
						if cursor:
							cursor.close()
						conn.close()

			data = {
				"type": "new_message",
				"id": message_id,
				"user": sender,
				"message": message,
				"date": time(),
				"reply_to": reply_to_data
			}

			for user_data in self.active_rooms[roomid]:
				websocket = user_data["websocket"]
				try:
					if self.is_websocket_connected(websocket):
						await websocket.send_text(dumps(data))
				except:
					print_exc()
					logger.error(f"send_message_to_room: Error sending message to {user_data['username']}")
			# maybe disconnect unavailable users?

	def get_user_image(self, username: str):
		if not username:
			return ""
		conn = get_db_connection()
		if not conn:
			return ""
		cursor = None
		try:
			cursor = conn.cursor()
			cursor.execute("SELECT imageurl FROM users WHERE user = %s", (username,))
			result = cursor.fetchone()
			if result and result[0]:
				return result[0]
			return ""
		except:
			print_exc()
			return ""
		finally:
			if cursor:
				cursor.close()
			conn.close()

	async def handle_user_image_request(self, websocket: WebSocket, data):
		target_user = data.get("username")
		if not target_user:
			return
		imageurl = self.get_user_image(target_user)
		response = {
			"type": "user_image",
			"username": target_user,
			"imageurl": imageurl
		}
		try:
			if self.is_websocket_connected(websocket):
				await websocket.send_text(dumps(response))
		except:
			print_exc()
					


chat = ChatApp()


@app.websocket("/")
async def websocket_endpoint(
	websocket: WebSocket,
	user: str = Query(...),
	psw: str = Query(...),
	roomid: str = Query(...),
	roompsw: str = Query(...),
	lastMessageDate: float = Query(0),
):

	await websocket.accept()

	if not (user and psw and roomid and roompsw):
		logger.error("Missing required parameters")
		await websocket.close(code=1008, reason="Missing required parameters")
		return

	if not checkUser(user, psw):
		logger.error("Invalid user credentials")
		await websocket.close(code=1008, reason="Invalid user credentials")
		return

	room_name = checkRoom(roomid, roompsw)
	if not room_name:
		logger.error("Invalid room credentials")
		await websocket.close(code=1008, reason="Invalid room credentials")
		return
	
	logger.info(f"accepted connection: user`{user}` roomid`{roomid}`")
	
	try:
		if chat.is_websocket_connected(websocket):
			await websocket.send_text(dumps({
				"type": "room_info",
				"room_name": room_name,
				"message": f"Connected to room: {room_name}"
			}))
	except:
		print_exc()

	disconnect_code = None
	try:
		await chat.handle_connect(websocket, user, roomid, lastMessageDate)

		while True:
			try:
				data = await websocket.receive_text()
				try:
					message_data = loads(data)

					if message_data.get("type") == "ping":
						try:
							if chat.is_websocket_connected(websocket):
								await websocket.send_text(dumps({"type": "pong", "ts": time()}))
								# logger.debug(f"client ping received, pong sent: user`{user}` roomid`{roomid}`")
						except:
							print_exc()
						continue

					if message_data.get("type") in ["send_message", "watcher_update", "request_user_image", "new_reaction", "delete_message", "load_more_messages", "server_pong"]:
						await chat.handle_message(websocket, message_data)
				except JSONDecodeError:
					try:
						if chat.is_websocket_connected(websocket):
							await chat.send_message_to_websocket(websocket, "Invalid message format")
					except:
						print_exc()
				except:
					logger.error(f"Error handling message from {user}")
					print_exc()
			except WebSocketDisconnect as e:
				disconnect_code = e.code
				logger.warning(f"receive_text disconnect: user`{user}` roomid`{roomid}` code`{disconnect_code}`")
				break
			except:
				logger.error(f"WebSocket error for {user}")
				print_exc()
				disconnect_code = getattr(websocket, "close_code", None)
				break
	except WebSocketDisconnect as e:
		disconnect_code = e.code
		logger.warning(f"outer disconnect: user`{user}` roomid`{roomid}` code`{disconnect_code}`")
	except:
		print_exc()
		if disconnect_code is None:
			disconnect_code = getattr(websocket, "close_code", None)
		logger.error(f"outer websocket error: user`{user}` roomid`{roomid}` code`{disconnect_code}`")
	finally:
		if disconnect_code is None:
			disconnect_code = getattr(websocket, "close_code", None)
		await chat.handle_disconnect(websocket, close_code=disconnect_code)