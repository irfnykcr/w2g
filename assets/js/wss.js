const logger = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[${timestamp}] [ERROR]`, ...args)
	},
	debug: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[${timestamp}] [DEBUG]`, ...args)
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	const chatRoomName = document.querySelector("#chat-roomname")
	const inputRoomName = document.querySelector("#input-roomname")


	const SERVER_ENDPOINT = await window.electronAPI.getServerEndpoint()
	let USER 
	let USER_PSW
	await window.electronAPI.getUser().then((r)=>{
		logger.debug(r)
		USER = r.user
		USER_PSW = r.psw
	})
	let ROOM_ID
	let ROOM_PSW 
	await window.electronAPI.getRoom().then(async (r)=>{
		logger.debug(r)
		if (r === false){
			logger.info("asking for room creds")
			// redirect to room_join.html
		} else {
			ROOM_ID = r.room
			ROOM_PSW = r.psw
			logger.debug("already have creds",r, ROOM_ID, ROOM_PSW)
		}
		if (ROOM_ID === null || ROOM_ID === undefined){
			logger.info("reload1")
			window.electronAPI.gotoRoomJoin()
		}
	}).catch((err)=>{
		logger.info("reload2")
		window.electronAPI.gotoRoomJoin()
	})
	const joinquery = new URLSearchParams({
		user: USER,
		psw: USER_PSW,
		roomid: ROOM_ID,
		roompsw: ROOM_PSW,
	}).toString()

	const socket = new WebSocket(`wss://${SERVER_ENDPOINT}/wss/?${joinquery}`)

	socket.onopen = () => {
		logger.info("WebSocket connection established")
	}

	socket.onmessage = (r) => {
		const data = JSON.parse(r.data)
		logger.debug("Message received", data)

		if (data.type == "room_info") {
			chatRoomName.innerHTML = `Chat - ${data.room_name}`
			inputRoomName.innerHTML = `Watch Video - ${data.room_name}`
		} else if (data.type == "new_message") {
			addMessage(data)
		} else if (data.type == "room_history") {
			data.messages.forEach((message) => {
				addMessage(message)
			})
		} else {
			logger.warn("couldnt match the type.", data.type)
		}
	}

	socket.onclose = () => {
		logger.info("WebSocket connection closed")
	}

	socket.onerror = (error) => {
		logger.error("WebSocket error:", error)
	}

	const messages = document.getElementById("chat-content")
	const messageButton = document.getElementById("send-chatmessage")
	const messageInput = document.getElementById("input-chatmessage")

	function sendMessage() {
		const message = messageInput.value.trim()
		if (message) {
			socket.send(
				JSON.stringify({
					type: "send_message",
					message: message,
				}),
			)
			messageInput.value = ""
		}
	}

	function addMessage(data) {
		logger.debug(data)
		const user = data.user
		const text = data.message
		const date = new Date(data.date * 1000).toLocaleString()

		const messageDiv = document.createElement("div")
		messageDiv.className = "mb-3 p-3 bg-dark-hover rounded-md border-l-4 border-turkuazz"
		messageDiv.innerHTML = `
		<div class="flex justify-between items-start mb-2">
			<span class="font-semibold ${user === "system" ? "text-admin" : "text-turkuazz"} text-sm break-words">${user}</span>
			<span class="text-xs text-gray-500 ml-2 flex-shrink-0">${date}</span>
		</div>
		<p class="text-gray-300 text-sm break-words">${text}</p>
	`

		messages.appendChild(messageDiv)
		messages.scrollTop = messages.scrollHeight
	}

	messageInput.addEventListener("keypress", (e) => {
		if (e.key === "Enter") sendMessage()
	})

	messageButton.addEventListener("click", () => {
		sendMessage()
	})
})
