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
	pool_size=5,
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
			return result[1]  # Return room name
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

	async def handle_connect(self, websocket: WebSocket, user: str, roomid: str):
		if roomid not in self.active_rooms:
			self.active_rooms[roomid] = []
		self.active_rooms[roomid].append({"websocket": websocket, "username": user})
		await self.send_history_to_websocket(websocket, roomid)
		await self.send_message_to_room(roomid, f"{user} joined.", no_history=True)

	async def handle_disconnect(self, websocket: WebSocket):
		roomid = self.get_room_from_websocket(websocket)
		user = self.get_user_from_websocket(websocket)

		if roomid is None or roomid not in self.active_rooms:
			print("WebSocket not associated with any room.")
			return
		if user:
			await self.send_message_to_room(roomid, f"{user} left.", no_history=True)

		self.active_rooms[roomid] = [user_data for user_data in self.active_rooms[roomid] if user_data["websocket"] != websocket]
		
		if not self.active_rooms[roomid]:
			del self.active_rooms[roomid]

	async def handle_message(self, websocket: WebSocket, data):
		message = data.get("message")
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)

		if not roomid:
			await self.send_message_to_websocket(websocket, "You are not in a room.")
			return
		if not user:
			await self.send_message_to_websocket(websocket, "User not found.")
			return
		await self.send_message_to_room(roomid, message, sender=user)

	async def send_history_to_websocket(self, websocket: WebSocket, roomid: str):
		try:
			conn = get_db_connection()
			if not conn:
				print("Failed to get database connection")
				return
			cursor = None
			try:
				cursor = conn.cursor()
				cursor.execute(
					"SELECT user, message, message_type, date FROM messages WHERE roomid = %s ORDER BY id ASC",
					(roomid,)
				)
				messages = []
				for row in cursor.fetchall():
					thedate = row[3].timestamp()
					messages.append({
						"user": row[0],
						"message": row[1],
						"message_type": row[2],
						"date": thedate
					})
				
				data = {
					"type": "room_history",
					"messages": messages,
				}
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
			await websocket.send_text(dumps(data))
		except Exception as e:
			print(f"Error sending message: {e}")

	async def send_message_to_room(self, roomid: str, message: str, sender: str = "system", no_history: bool = False):
		if roomid in self.active_rooms:
			data = {
				"type": "new_message",
				"user": sender,
				"message": message,
				"date": time(),
			}
			
			if not no_history:
				conn = get_db_connection()
				if conn:
					cursor = None
					try:
						cursor = conn.cursor()
						cursor.execute(
							"INSERT INTO messages (roomid, user, message, message_type) VALUES (%s, %s, %s, %s)",
							(roomid, sender, message, "new_message")
						)
						conn.commit()
					except Exception as e:
						print(f"Error saving message to database: {e}")
					finally:
						if cursor:
							cursor.close()
						conn.close()

			for user_data in self.active_rooms[roomid]:
				websocket = user_data["websocket"]
				try:
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
):
	print("connection")
	if not user or not psw or not roomid or not roompsw:
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
		await chat.handle_connect(websocket, user, roomid)

		while True:
			data = await websocket.receive_text()
			try:
				message_data = loads(data)
				if message_data.get("type") == "send_message":
					await chat.handle_message(websocket, message_data)
			except JSONDecodeError:
				await chat.send_message_to_websocket(websocket, "Invalid message format")
			except Exception as e:
				print(f"Error handling message: {e}")

	except WebSocketDisconnect:
		await chat.handle_disconnect(websocket)
	except Exception as e:
		print(f"WebSocket error: {e}")
		await chat.handle_disconnect(websocket)
