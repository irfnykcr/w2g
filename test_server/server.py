from time import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from bcrypt import checkpw

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PLAYER_STATUS:dict = {
	"room1":{
		"video_info":{
			"time":{
				"user": "",
				"value": 0,
				"date": 0
			},
			"is_playing":{
				"user": "",
				"value": 1,
				"date": 0
			},
			"url":{
				"user": "",
				"value": "https://www.sample-videos.com/video321/mp4/240/big_buck_bunny_240p_30mb.mp4",
				"date": 0
			},
			"users":{
				"value": {},
				"date": 0
			}
		},
		"room_info":{
			"password":{
				"value": b"$2b$10$B6D7uWWalTqRhuLywfLRueI.mRZRYZXpqspGyI8PzIeTmJ5tMx8tq",
				"date":0
			},
			"host":{
				"value":"0",
				"date":0
			},
		},
	}
}


# gets

@app.post('/get_playerstatus')
async def get_playerstatus(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	return {"status": True, "data": PLAYER_STATUS[roomname]["video_info"]}

# updates

def change_updatestatus_forall(roomname: str, except_user: str) -> bool:
	global PLAYER_STATUS
	for user in PLAYER_STATUS[roomname]["video_info"]["users"]["value"]:
		if user == except_user: 
			continue
		PLAYER_STATUS[roomname]["video_info"]["users"]["value"][user] = {
			"uptodate": 0,
			"date": int(time())
		}
		PLAYER_STATUS[roomname]["video_info"]["users"]["date"] = int(time())
	return True

def check_ifcan_update(roomname: str, user: str) -> bool:
	global PLAYER_STATUS
	return PLAYER_STATUS[roomname]["video_info"]["users"]["value"][user]["uptodate"]


@app.post('/update_isplaying')
async def update_isplaying(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	_is_playing = bool(data["is_playing"])
	new_time = int(data["new_time"])
	if check_ifcan_update(roomname, user):
		PLAYER_STATUS[roomname]["video_info"]["is_playing"] = {
			"user": user,
			"value": _is_playing,
			"date": int(time())
		}
		PLAYER_STATUS[roomname]["video_info"]["time"] = {
			"user": user,
			"value": new_time,
			"date": int(time())
		}
		change_updatestatus_forall(roomname, user)
		return {"status": True, "data": f"updated the video is_playing to: {_is_playing}"}
	return {"status": False, "error": "invalid or missing 'is_playing' parameter"}

@app.post('/update_time')
async def update_time(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	new_time = int(data["new_time"])
	if check_ifcan_update(roomname, user):
		PLAYER_STATUS[roomname]["video_info"]["time"] = {
			"user": user,
			"value": new_time,
			"date": int(time())
		}
		change_updatestatus_forall(roomname, user)
		return {"status": True, "data": f"updated the video time to: {new_time}"}
	return {"status": False, "error": "invalid or missing 'new_time' parameter"}

@app.post('/join')
async def join(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	PLAYER_STATUS[roomname]["video_info"]["users"]["value"][user] = {
		"uptodate": 0,
		"date": int(time())
	}
	PLAYER_STATUS[roomname]["video_info"]["users"]["date"] = int(time())
	return {"status": True, "data": f"joined to the party"}

@app.post('/leave')
async def leave(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	PLAYER_STATUS[roomname]["video_info"]["users"]["value"].pop(user, None)
	PLAYER_STATUS[roomname]["video_info"]["users"]["date"] = int(time())
	return {"status": True, "data": f"left the party"}

@app.post('/imuptodate')
async def imuptodate(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	if user in PLAYER_STATUS[roomname]["video_info"]["users"]["value"]:
		PLAYER_STATUS[roomname]["video_info"]["users"]["value"][user] = {
			"uptodate": 1,
			"date": int(time())
		}
		PLAYER_STATUS[roomname]["video_info"]["users"]["date"] = int(time())
		return {"status": True, "data": f"updated your status on the server"}
	return {"status": False, "data": f"could not updated your status on the server"}

@app.post('/update_url')
async def update_url(request: Request):
	global PLAYER_STATUS
	data = await request.json()
	roomname = str(data["roomname"])
	roompsw = str(data["roompsw"])
	if not checkpw(roompsw.encode(), PLAYER_STATUS[roomname]["room_info"]["password"]["value"]):
		return {"status": False, "data": "password is incorrect"}
	user = str(data["userid"])
	new_url = str(data["new_url"])
	if check_ifcan_update(roomname, user):
		PLAYER_STATUS[roomname]["video_info"]["time"] = {
			"user": user,
			"value": 0,
			"date": int(time())
		}
		PLAYER_STATUS[roomname]["video_info"]["is_playing"] = {
			"user": user,
			"value": 1,
			"date": int(time())
		}
		PLAYER_STATUS[roomname]["video_info"]["url"] = {
			"user": user,
			"value": new_url,
			"date": int(time())
		}
		print(PLAYER_STATUS[roomname]["video_info"])
		change_updatestatus_forall(roomname, "")
		return {"status": True, "data": f"updated the video url to: {new_url}"}
	return {"status": False, "error": "invalid or missing 'new_url' parameter"}