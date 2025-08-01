from json import loads
from time import time
from flask import Flask, request, jsonify

app = Flask(__name__)

PLAYER_STATUS:dict = {
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
}


# gets

@app.route('/get_playerstatus', methods=['POST'])
def get_playerstatus():
	global PLAYER_STATUS
	return jsonify({"status": True, "data": PLAYER_STATUS})

# updates

def change_updatestatus_forall(except_user:str) -> bool:
	global PLAYER_STATUS
	for user in PLAYER_STATUS["users"]["value"]:
		if user == except_user: continue
		PLAYER_STATUS["users"]["value"][user] = {
			"uptodate": 0,
			"date": int(time())
		}
		PLAYER_STATUS["users"]["date"] = int(time())
	return True

def check_ifcan_update(user:str) -> bool:
	return PLAYER_STATUS["users"]["value"][user]["uptodate"]


@app.route('/update_isplaying', methods=['POST'])
def update_isplaying():
	global PLAYER_STATUS
	data = loads(request.data)
	user = str(data["userid"])
	_is_playing = bool(data["is_playing"])
	new_time = int(data["new_time"])
	if check_ifcan_update(user):
		PLAYER_STATUS["is_playing"] = {
			"user": user,
			"value": _is_playing,
			"date": int(time())
		}
		PLAYER_STATUS["time"] = {
			"user": user,
			"value": new_time,
			"date": int(time())
		}
		change_updatestatus_forall(user)
		return jsonify({"status": True, "data": f"updated the video is_playing to: {_is_playing}"})
	return jsonify({"status": False, "error": "invalid or missing 'is_playing' parameter"})

@app.route('/update_time', methods=['POST'])
def update_time():
	global PLAYER_STATUS
	data = loads(request.data)
	user = str(data["userid"])
	new_time = int(data["new_time"])
	if check_ifcan_update(user):
		PLAYER_STATUS["time"] = {
			"user": user,
			"value": new_time,
			"date": int(time())
		}
		change_updatestatus_forall(user)
		return jsonify({"status": True, "data": f"updated the video time to: {new_time}"})
	return jsonify({"status": False, "error": "invalid or missing 'new_time' parameter"})

@app.route('/join', methods=['POST'])
def join():
	global PLAYER_STATUS
	data = loads(request.data)
	user = str(data["userid"])
	PLAYER_STATUS["users"]["value"][user] = {
		"uptodate": 0,
		"date": int(time())
	}
	PLAYER_STATUS["users"]["date"] = int(time())
	return jsonify({"status": True, "data": f"joined to the party"})

@app.route('/leave', methods=['POST'])
def leave():
	global PLAYER_STATUS
	data = loads(request.data)
	user = str(data["userid"])
	PLAYER_STATUS["users"]["value"].pop(user, None)
	PLAYER_STATUS["users"]["date"] = int(time())
	return jsonify({"status": True, "data": f"left the party"})

@app.route('/imuptodate', methods=['POST'])
def imuptodate():
	global PLAYER_STATUS
	data = loads(request.data)
	user = str(data["userid"])
	if user in PLAYER_STATUS["users"]["value"]:
		PLAYER_STATUS["users"]["value"][user] = {
			"uptodate": 1,
			"date": int(time())
		}
		PLAYER_STATUS["users"]["date"] = int(time())
		return jsonify({"status": True, "data": f"updated your status on the server"})
	return jsonify({"status": False, "data": f"could not updated your status on the server"})

if __name__ == '__main__':
	app.run(host="127.0.0.1", port=5000, debug=True)