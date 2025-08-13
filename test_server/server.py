from time import time
from traceback import print_exc
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from bcrypt import checkpw
from mysql.connector import pooling
from dotenv import load_dotenv
from os import getenv
import json
import signal
import sys
import atexit
load_dotenv()

app = FastAPI()


PLAYER_STATUS = {} # {roomid: {"is_playing": {}, "url": {}, "uptodate": {}, "time": {}}}}
 

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
	except:
		print_exc()
		print(f"Error checking room")
		return False
	finally:
		if cursor:
			cursor.close()
		conn.close()

def checkUser(userid: str, userpsw: str):
	conn = get_db_connection()
	if not conn:
		return False
	cursor = None
	try:
		cursor = conn.cursor()
		cursor.execute("SELECT password_hash FROM users WHERE user = %s", (userid,))
		result = cursor.fetchone()
		if result and checkpw(userpsw.encode(), result[0].encode()):
			return True
		return False
	except:
		print_exc()
		print(f"Error checking user")
		return False
	finally:
		if cursor:
			cursor.close()
		conn.close()

def get_player_status(roomid: str):
	global PLAYER_STATUS
	if roomid not in PLAYER_STATUS:
		PLAYER_STATUS[roomid] = {
			"is_playing": {},
			"url": {},
			"uptodate": {},
			"time": {}
		}
	return PLAYER_STATUS[roomid]

def update_player_status(roomid: str, **kwargs):
	global PLAYER_STATUS
	if roomid not in PLAYER_STATUS:
		PLAYER_STATUS[roomid] = {
			"is_playing": {},
			"url": {},
			"uptodate": {},
			"time": {}
		}
	
	for field, value in kwargs.items():
		if field in ['is_playing', 'url', 'uptodate', 'time']:
			PLAYER_STATUS[roomid][field] = value
	return True

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
			is_playing = json.dumps(status.get("is_playing", {}))
			url = json.dumps(status.get("url", {}))
			time_data = json.dumps(status.get("time", {}))

			cursor.execute("""
				UPDATE player_status 
				SET is_playing = %s, url = %s, time = %s,
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
				"is_playing": json.loads(is_playing) if is_playing else {},
				"url": json.loads(url) if url else {},
				"uptodate": {},  # Reset uptodate on startup
				"time": json.loads(time_data) if time_data else {}
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
	print("Server shutting down, saving player status...")
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
	print("FastAPI starting up, loading player status from database...")
	load_player_status_from_db()

@app.on_event("shutdown")
async def shutdown_event():
	print("FastAPI shutting down, saving player status to database...")
	save_player_status_to_db()


# gets

@app.post('/get_playerstatus')
async def get_playerstatus(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
	
	player_status = get_player_status(roomid)
	return {"status": True, "data": player_status}

# updates

def change_updatestatus_forall(roomid: str, except_user: str) -> bool:
	player_status = get_player_status(roomid)
	if not player_status or "uptodate" not in player_status:
		return False
		
	uptodate = player_status["uptodate"]
	for user in uptodate:
		if user == except_user: 
			continue
		uptodate[user] = False
	
	update_player_status(roomid, uptodate=uptodate)
	return True

def check_ifcan_update(roomid: str, user: str) -> bool:
	player_status = get_player_status(roomid)
	if not player_status or "uptodate" not in player_status:
		return False
	return player_status["uptodate"].get(user, False) == True


@app.post('/update_isplaying')
async def update_isplaying(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
	
	user = str(data["userid"])
	_is_playing = bool(data["is_playing"])
	new_time = int(data["new_time"])
	
	if check_ifcan_update(roomid, user):
		is_playing_data = {"user": user, "value": _is_playing}
		time_data = {"user": user, "value": new_time}
		
		update_player_status(roomid, is_playing=is_playing_data, time=time_data)
		change_updatestatus_forall(roomid, user)
		return {"status": True, "data": f"updated the video is_playing to: {_is_playing}"}
	return {"status": False, "error": "invalid or missing 'is_playing' parameter"}

@app.post('/update_time')
async def update_time(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
		
	user = str(data["userid"])
	new_time = int(data["new_time"])
	
	if check_ifcan_update(roomid, user):
		time_data = {"user": user, "value": new_time}
		update_player_status(roomid, time=time_data)
		change_updatestatus_forall(roomid, user)
		return {"status": True, "data": f"updated the video time to: {new_time}"}
	return {"status": False, "error": "invalid or missing 'new_time' parameter"}

@app.post('/join')
async def join(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
		
	user = str(data["userid"])
	player_status = get_player_status(roomid)
	uptodate = player_status.get("uptodate", {})
	if user in uptodate:
		return {"status": False, "data": "user already joined"}
	player_status = get_player_status(roomid)
	uptodate = player_status.get("uptodate", {})
	uptodate[user] = False
	
	update_player_status(roomid, uptodate=uptodate)
	return {"status": True, "data": f"joined to the party"}

@app.post('/leave')
async def leave(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
		
	user = str(data["userid"])

	player_status = get_player_status(roomid)
	uptodate = player_status.get("uptodate", {})
	uptodate.pop(user, None)
	
	update_player_status(roomid, uptodate=uptodate)
	return {"status": True, "data": f"left the party"}

@app.post('/imuptodate')
async def imuptodate(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
		
	user = str(data["userid"])
	
	player_status = get_player_status(roomid)
	uptodate = player_status.get("uptodate", {})
	if user in uptodate:
		uptodate[user] = True
		update_player_status(roomid, uptodate=uptodate)
		return {"status": True, "data": f"updated your status on the server"}
	return {"status": False, "data": f"could not updated your status on the server"}

@app.post('/update_url')
async def update_url(request: Request):
	data = await request.json()
	roomid = str(data["roomid"])
	roompsw = str(data["roompsw"])
	userid = str(data["userid"])
	userpsw = str(data["userpsw"])
	
	if not checkRoom(roomid, roompsw):
		return {"status": False, "data": "password is incorrect for room"}
	if not checkUser(userid, userpsw):
		return {"status": False, "data": "password is incorrect for user"}
		
	user = str(data["userid"])
	new_url = str(data["new_url"])
	
	if check_ifcan_update(roomid, user):
		time_data = {"user": user, "value": 0}
		is_playing_data = {"user": user, "value": True}
		url_data = {"user": user, "value": new_url}
		
		update_player_status(roomid, time=time_data, is_playing=is_playing_data, url=url_data)
		
		# player_status = get_player_status(roomid)
		
		change_updatestatus_forall(roomid, "")
		return {"status": True, "data": f"updated the video url to: {new_url}"}
	return {"status": False, "error": "invalid or missing 'new_url' parameter"}


# !!! JUST FOR DEV !!!
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