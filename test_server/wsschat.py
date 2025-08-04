from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from json import loads, dumps
from json import JSONDecodeError
from time import time
from bcrypt import checkpw

app = FastAPI()

# Add CORS middleware
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

ROOMS = {
	"room1": {
		"users": [],  # [{"websocket": websocket, "username": username},]
		"history": [],  # [{"user": username, "message": "hi", "date": time()},]
		"psw": b"$2b$10$B6D7uWWalTqRhuLywfLRueI.mRZRYZXpqspGyI8PzIeTmJ5tMx8tq",
	}
}


def checkUser(user, psw):
	return True


def checkRoom(roomname: str, roompsw: str):
	if checkpw(roompsw.encode(), ROOMS[roomname]["psw"]):
		return True
	return False


class ChatApp:
	def __init__(self):
		...

	def get_user_from_websocket(self, websocket):
		for room_data in ROOMS.values():
			for user_data in room_data["users"]:
				if user_data["websocket"] == websocket:
					return user_data["username"]
		return None

	def get_room_from_websocket(self, websocket):
		for room_name, room_data in ROOMS.items():
			for user_data in room_data["users"]:
				if user_data["websocket"] == websocket:
					return room_name
		return None

	async def handle_connect(self, websocket: WebSocket, user: str, room: str):
		ROOMS[room]["users"].append({"websocket": websocket, "username": user})
		await self.send_history_to_websocket(websocket, room)
		await self.send_message_to_room(room, f"{user} joined.", no_history=True)

	async def handle_disconnect(self, websocket: WebSocket):
		room = self.get_room_from_websocket(websocket)
		if room is None or room not in ROOMS:
			print("WebSocket not associated with any room.")
			return
		ROOMS[room]["users"] = [user_data for user_data in ROOMS[room]["users"] if user_data["websocket"] != websocket]

		user = self.get_user_from_websocket(websocket)
		if user:
			await self.send_message_to_room(room, f"{user} left.", no_history=True)

	async def handle_message(self, websocket: WebSocket, data):
		message = data.get("message")
		user = self.get_user_from_websocket(websocket)
		room = self.get_room_from_websocket(websocket)

		if not room:
			await self.send_message_to_websocket(websocket, "You are not in a room.")
			return
		if not user:
			await self.send_message_to_websocket(websocket, "User not found.")
			return
		await self.send_message_to_room(room, message, sender=user)

	async def send_history_to_websocket(self, websocket: WebSocket, room: str):
		try:
			data = {
				"type": "room_history",
				"messages": ROOMS[room]["history"],
			}
			await websocket.send_text(dumps(data))
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

	async def send_message_to_room(self, room: str, message: str, sender: str = "system", no_history: bool = False):
		if room in ROOMS:
			data = {
				"type": "new_message",
				"user": sender,
				"message": message,
				"date": time(),
			}
			if not no_history:
				ROOMS[room]["history"].append(data)

			disconnected_websockets = []
			for user_data in ROOMS[room]["users"]:
				websocket = user_data["websocket"]
				try:
					await websocket.send_text(dumps(data))
				except Exception as e:
					print(f"Error sending message to {user_data['username']}: {e}")
					disconnected_websockets.append(websocket)

			for websocket in disconnected_websockets:
				await self.handle_disconnect(websocket)


chat = ChatApp()


@app.websocket("/")
async def websocket_endpoint(
	websocket: WebSocket,
	user: str = Query(...),
	psw: str = Query(...),
	room: str = Query(...),
	roompsw: str = Query(...),
):
	if not user or not psw or not room or not roompsw:
		await websocket.close(code=1008, reason="Missing required parameters")
		return

	if not checkUser(user, psw):
		await websocket.close(code=1008, reason="Invalid user credentials")
		return

	if not checkRoom(room, roompsw):
		await websocket.close(code=1008, reason="Invalid room credentials")
		return

	await websocket.accept()

	try:
		await chat.handle_connect(websocket, user, room)

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
