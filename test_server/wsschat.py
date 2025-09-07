from traceback import print_exc
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from json import loads, dumps
from json import JSONDecodeError
from time import time
from bcrypt import checkpw
from mysql.connector import pooling
from dotenv import load_dotenv
from os import getenv
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
	pool_size=32,
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
		cursor.execute("SELECT password_hash, name FROM rooms WHERE roomid = %s", (roomid,))
		result = cursor.fetchone()
		if result and checkpw(roompsw.encode(), result[0].encode()):
			return result[1]
		return False
	except Exception as e:
		print(f"Error checking room: {e}")
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

	async def handle_watcher_update(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not user or not roomid:
			return
		
		is_watching = data.get("is_watching", False)
		provided_imageurl = data.get("imageurl", "")
		current_time = data.get("current_time", 0)
		is_playing = data.get("is_playing", False)
		is_uptodate = data.get("is_uptodate", False)
		
		user_imageurl = ""
		if provided_imageurl:
			user_imageurl = provided_imageurl
		else:
			conn = get_db_connection()
			if conn:
				cursor = None
				try:
					cursor = conn.cursor()
					cursor.execute("SELECT imageurl FROM users WHERE user = %s", (user,))
					result = cursor.fetchone()
					if result and result[0]:
						user_imageurl = result[0]
				except Exception as e:
					print(f"Error fetching user imageurl: {e}")
				finally:
					if cursor:
						cursor.close()
					conn.close()
		
		if roomid not in self.room_watchers:
			self.room_watchers[roomid] = []
		
		self.room_watchers[roomid] = [w for w in self.room_watchers[roomid] if w["username"] != user]
		
		if is_watching:
			self.room_watchers[roomid].append({
				"username": user,
				"imageurl": user_imageurl,
				"current_time": current_time,
				"is_playing": is_playing,
				"is_uptodate": is_uptodate
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
					if websocket.client_state.value == 1:  # CONNECTED state
						await websocket.send_text(dumps(data))
				except Exception as e:
					print(f"Error sending watchers update to {user_data['username']}: {e}")

	async def handle_connect(self, websocket: WebSocket, user: str, roomid: str, lastMessageDate: float):
		if roomid not in self.active_rooms:
			self.active_rooms[roomid] = []
		self.active_rooms[roomid].append({"websocket": websocket, "username": user})
		if lastMessageDate > 0:
			await self.send_history_to_websocket(websocket, roomid, lastMessageDate)
		else:
			await self.send_history_to_websocket(websocket, roomid, limit=15)
		await self.send_message_to_room(roomid, f"{user} joined.", no_history=True)
		await self.send_watchers_to_room(roomid)

	async def handle_disconnect(self, websocket: WebSocket):
		roomid = self.get_room_from_websocket(websocket)
		user = self.get_user_from_websocket(websocket)

		if roomid is None or roomid not in self.active_rooms:
			print("room is not active.")
			return
			
		if user:
			await self.send_message_to_room(roomid, f"{user} left.", no_history=True)
			if roomid in self.room_watchers:
				self.room_watchers[roomid] = [w for w in self.room_watchers[roomid] if w["username"] != user]

		self.active_rooms[roomid] = [user_data for user_data in self.active_rooms[roomid] if user_data["websocket"] != websocket]
		
		if not self.active_rooms[roomid]:
			del self.active_rooms[roomid]
			if roomid in self.room_watchers:
				del self.room_watchers[roomid]
		else:
			await self.send_watchers_to_room(roomid)

	async def handle_message(self, websocket: WebSocket, data):
		if data.get("type") == "watcher_update":
			await self.handle_watcher_update(websocket, data)
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
		print(data, reply_to)
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)

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
								if websocket_user.client_state.value == 1:  # CONNECTED state
									await websocket_user.send_text(dumps(data))
							except Exception as e:
								print(f"Error sending reaction removal to {user_data['username']}: {e}")
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
						if websocket_user.client_state.value == 1:  # CONNECTED state
							await websocket_user.send_text(dumps(data))
					except Exception as e:
						print(f"Error sending reaction to {user_data['username']}: {e}")
		except Exception as e:
			print(f"Error handling reaction: {e}")
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
						if websocket_user.client_state.value == 1:  # CONNECTED state
							await websocket_user.send_text(dumps(data))
					except Exception as e:
						print(f"Error sending message deletion to {user_data['username']}: {e}")
		except Exception as e:
			print(f"Error handling message deletion: {e}")
		finally:
			if cursor:
				cursor.close()
			conn.close()

	async def send_history_to_websocket(self, websocket: WebSocket, roomid: str, lastMessageDate: float = 0, limit = 15, before_message_id = None):
		try:
			conn = get_db_connection()
			if not conn:
				print("Failed to get database connection")
				return
			if limit > 15 or limit < 1:
				print("limit error:", limit)
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
				if websocket.client_state.value == 1:  # CONNECTED state
					await websocket.send_text(dumps(data))
			finally:
				if cursor:
					cursor.close()
				conn.close()
		except Exception as e:
			print(f"Error sending history: {e}")

	async def send_message_to_websocket(self, websocket: WebSocket, message: str, sender: str = "system"):
		data = {
			"type": "new_message",
			"user": sender,
			"message": message,
			"date": time(),
		}
		try:
			if websocket.client_state.value == 1:  # CONNECTED state
				await websocket.send_text(dumps(data))
		except Exception as e:
			print(f"Error sending message: {e}")

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
					except Exception as e:
						print(f"Error fetching reply message: {e}")
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
					except Exception as e:
						print(f"Error saving message to database: {e}")
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
					if websocket.client_state.value == 1:  # CONNECTED state
						await websocket.send_text(dumps(data))
				except Exception as e:
					print(f"Error sending message to {user_data['username']}: {e}")
			# maybe disconnect unavailable users?
					


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
	print("connection")
	if not (user and psw and roomid and roompsw):
		print("Missing required parameters")
		await websocket.close(code=1008, reason="Missing required parameters")
		return

	if not checkUser(user, psw):
		print("Invalid user credentials")
		await websocket.close(code=1008, reason="Invalid user credentials")
		return

	room_name = checkRoom(roomid, roompsw)
	if not room_name:
		print("Invalid room credentials")
		await websocket.close(code=1008, reason="Invalid room credentials")
		return

	await websocket.accept()
	
	try:
		await websocket.send_text(dumps({
			"type": "room_info",
			"room_name": room_name,
			"message": f"Connected to room: {room_name}"
		}))
	except Exception as e:
		print(f"Error sending room info: {e}")

	try:
		await chat.handle_connect(websocket, user, roomid, lastMessageDate)

		while True:
			try:
				data = await websocket.receive_text()
				try:
					message_data = loads(data)
					if message_data.get("type") in ["send_message", "watcher_update", "new_reaction", "delete_message", "load_more_messages"]:
						await chat.handle_message(websocket, message_data)
				except JSONDecodeError:
					await chat.send_message_to_websocket(websocket, "Invalid message format")
				except Exception as e:
					print(f"Error handling message: {e}")
			except WebSocketDisconnect:
				break
			except Exception as e:
				print(f"Error receiving message: {e}")
				break
		await chat.handle_disconnect(websocket)

	except WebSocketDisconnect:
		await chat.handle_disconnect(websocket)
	except Exception as e:
		print(f"WebSocket error: {e}")
		await chat.handle_disconnect(websocket)