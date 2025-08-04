from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = "123123213"
socketio = SocketIO(app, cors_allowed_origins="*")

def checkUser(user, psw):
	return True

class ChatApp:
	def __init__(self):
		self.users = {}

	def handle_connect(self, sid, user, psw):
		if not checkUser(user, psw): return False
		self.users[sid] = user
		data = {
			"user": "system",
			"message": f"{self.users[sid]} joined."
		}
		emit("user_joined", data, broadcast=True)

	def handle_disconnect(self, sid):
		user = self.users.pop(sid, None)
		data = {
			"user": "system",
			"message": f"{user} left."
		}
		if user:
			emit("user_left", data, broadcast=True)

	def handle_message(self, sid, data):
		data = {
			"user": self.users.get(sid, "Unknown"),
			"message": data["message"]
		}
		emit("new_message", data, broadcast=True)

chat = ChatApp()

@socketio.on("connect")
def on_connect():
	user = request.headers.get("user")
	psw = request.headers.get("psw")
	chat.handle_connect(request.sid, user, psw)

@socketio.on("disconnect")
def on_disconnect():
	chat.handle_disconnect(request.sid)

@socketio.on("send_message")
def on_message(data):
	chat.handle_message(request.sid, data)

if __name__ == "__main__":
	socketio.run(app, host="127.0.0.1", port=33229, debug=True)