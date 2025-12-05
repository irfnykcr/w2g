import logging
from traceback import print_exc
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from asyncio import create_task, sleep, CancelledError
from starlette.websockets import WebSocketState
from fastapi.middleware.cors import CORSMiddleware
from json import loads, dumps
from json import JSONDecodeError
from time import time
from dotenv import load_dotenv
import async_db
load_dotenv()

logging.basicConfig(
	level=logging.DEBUG,
	format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger("wssChat")

app = FastAPI()

@app.on_event("startup")
async def startup():
	await async_db.init_pool()

@app.on_event("shutdown")
async def shutdown():
	await async_db.close_pool()

app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


class ChatApp:
	def __init__(self):
		# {roomid: [{"websocket": websocket, "username": username}]}
		self.active_rooms = {}
		# {roomid: [{"username": username, "imageurl": imageurl}]}
		self.room_watchers = {}
		# {roomid: {username: timestamp}}
		self.typing_users = {}
		self.disconnect_tasks = {}
		self.presence_grace_seconds = 5
		self.keepalive_tasks = {}
		self.last_pong = {}
		self.keepalive_interval = 20
		self.keepalive_timeout = 50

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

	async def send_video_history_to_websocket(self, websocket: WebSocket, roomid: str):
		history = await async_db.get_video_history(roomid)
		try:
			if self.is_websocket_connected(websocket):
				await websocket.send_text(dumps({
					"type": "video_history",
					"history": history
				}))
		except:
			print_exc()

	async def broadcast_video_history_update(self, roomid: str, entry: dict):
		logger.info(f"broadcast_video_history_update: roomid`{roomid}` entry`{entry}`")
		if roomid not in self.active_rooms:
			logger.warn(f"broadcast_video_history_update: room not active")
			return
		data = {
			"type": "video_history_update",
			"entry": entry
		}
		for user_data in self.active_rooms[roomid]:
			websocket = user_data["websocket"]
			try:
				if self.is_websocket_connected(websocket):
					await websocket.send_text(dumps(data))
			except:
				print_exc()

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
		await self.send_video_history_to_websocket(websocket, roomid)
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
		msg_type = data.get("type")
		if msg_type == "server_pong" or msg_type == "pong":
			self.last_pong[websocket] = time()
			return
		if msg_type == "ping":
			self.last_pong[websocket] = time()
			try:
				await websocket.send_text(dumps({"type": "pong", "ts": time()}))
			except:
				pass
			return
		if msg_type == "watcher_update":
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
		elif data.get("type") == "video_history_update":
			roomid = self.get_room_from_websocket(websocket)
			entry = data.get("entry")
			logger.info(f"video_history_update received: roomid`{roomid}` entry`{entry}`")
			if roomid and entry:
				await self.broadcast_video_history_update(roomid, entry)
			return
		elif data.get("type") == "typing_start":
			await self.handle_typing(websocket, True)
			return
		elif data.get("type") == "typing_stop":
			await self.handle_typing(websocket, False)
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

	async def handle_typing(self, websocket: WebSocket, is_typing: bool):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		if not roomid or not user:
			return
		if roomid not in self.typing_users:
			self.typing_users[roomid] = {}
		if is_typing:
			self.typing_users[roomid][user] = time()
		else:
			self.typing_users[roomid].pop(user, None)
		await self.broadcast_typing_status(roomid, user)

	async def broadcast_typing_status(self, roomid: str, exclude_user: str):
		if roomid not in self.typing_users:
			return
		now = time()
		active_typers = [u for u, t in self.typing_users[roomid].items() if now - t < 10]
		self.typing_users[roomid] = {u: t for u, t in self.typing_users[roomid].items() if now - t < 10}
		for user_data in self.active_rooms.get(roomid, []):
			if user_data["username"] != exclude_user:
				try:
					await user_data["websocket"].send_text(dumps({
						"type": "typing_status",
						"users": [u for u in active_typers if u != user_data["username"]]
					}))
				except:
					pass

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
			
		try:
			existing_reaction = await async_db.get_existing_reaction(roomid, user, reply_to)
			
			if existing_reaction:
				reaction_id = existing_reaction[0]
				existing_emoji = existing_reaction[1]
				is_removed = existing_reaction[2]
				
				if existing_emoji == emoji and not is_removed:
					await async_db.mark_message_removed(reaction_id)
					
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
					await async_db.update_reaction(reaction_id, emoji)
			else:
				reaction_id = await async_db.insert_message(roomid, user, emoji, "new_reaction", reply_to)
			
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

	async def handle_message_deletion(self, websocket: WebSocket, data):
		user = self.get_user_from_websocket(websocket)
		roomid = self.get_room_from_websocket(websocket)
		
		if not roomid or not user:
			return
			
		message_id = data.get("message_id")
		
		if not message_id:
			return
			
		try:
			result = await async_db.get_message_owner(message_id, roomid)
			if not result:
				return
			message_owner, is_removed = result
			
			if message_owner != user:
				return
			if is_removed:
				return
			
			await async_db.mark_message_removed(message_id)
			
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

	async def send_history_to_websocket(self, websocket: WebSocket, roomid: str, lastMessageDate: float = 0, limit = 15, before_message_id = None):
		try:
			if limit > 15 or limit < 1:
				logger.error("send_history_to_websocket: limit error:", limit)
				return
			
			messages, has_more, is_pagination = await async_db.get_messages_history(roomid, lastMessageDate, before_message_id, limit)
			
			data = {
				"type": "room_history",
				"messages": messages,
				"has_more": has_more,
				"is_pagination": is_pagination
			}
			if self.is_websocket_connected(websocket):
				await websocket.send_text(dumps(data))
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
				try:
					reply_result = await async_db.get_message_by_id(reply_to_id)
					if reply_result:
						if reply_result[2]:
							reply_to_data = {"id": reply_to_id, "user": reply_result[0], "message": None, "is_deleted": True}
						else:
							reply_to_data = {"id": reply_to_id, "user": reply_result[0], "message": reply_result[1], "is_deleted": False}
				except:
					print_exc()
			
			if not no_history:
				try:
					message_id = await async_db.insert_message(roomid, sender, message, "new_message", reply_to_id)
				except:
					print_exc()

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

	async def handle_user_image_request(self, websocket: WebSocket, data):
		target_user = data.get("username")
		if not target_user:
			return
		imageurl = await async_db.get_user_image(target_user)
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

	if not await async_db.check_user(user, psw):
		logger.error("Invalid user credentials")
		await websocket.close(code=1008, reason="Invalid user credentials")
		return

	room_name = await async_db.check_room_get_name(roomid, roompsw)
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

					if message_data.get("type") in ["send_message", "watcher_update", "request_user_image", "new_reaction", "delete_message", "load_more_messages", "server_pong", "pong", "video_history_update", "typing_start", "typing_stop"]:
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