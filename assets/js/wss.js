const SERVER_ENDPOINT = localStorage.getItem("server_endpoint")
const USER = localStorage.getItem("user")
const USER_PSW = localStorage.getItem("userpsw")
const ROOM = localStorage.getItem("room")
const ROOM_PSW = localStorage.getItem("roompsw")

document.addEventListener("DOMContentLoaded", () => {
	const joinquery = new URLSearchParams({
		user: USER,
		psw: USER_PSW,
		room: ROOM,
		roompsw: ROOM_PSW,
	}).toString()

	const socket = new WebSocket(`wss://${SERVER_ENDPOINT}/wss/?${joinquery}`)

	socket.onopen = () => {
		console.log("WebSocket connection established")
	}

	socket.onmessage = (r) => {
		const data = JSON.parse(r.data)
		console.log("Message received", data)
		if (data.type == "new_message"){
			addMessage(data)
		} else if (data.type == "room_history") {
			data.messages.forEach((message) => {
				addMessage(message)
			})
		} else {
			console.log("couldnt match the type.", data.type)
		}
	}

	socket.onclose = () => {
		console.log("WebSocket connection closed")
	}

	socket.onerror = (error) => {
		console.error("WebSocket error:", error)
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
				})
			)
			messageInput.value = ""
		}
	}


	function addMessage(data) {
		console.log(data)
		const user = data.user
		const text = data.message
		const date = new Date(data.date * 1000).toLocaleString()
		const div = document.createElement('div')
		div.innerHTML = `
			<div class="flex-1 bg-dark-bg rounded-md p-4 overflow-y-auto border border-gray-700 mb-4 flex flex-col gap-2 break-words">
				<div class="text-gray-300 flex justify-between items-center">
					<span class="${user === 'system' ? 'font-semibold' : ''} ${user === 'system' ? 'text-admin' : 'text-turkuazz'}">${user}</span>
					<span class="text-xs text-gray-500">${date}</span>
				</div>
				<p>${text}</p>
			</div>
		`
		messages.appendChild(div)
		messages.scrollTop = messages.scrollHeight
	}

	messageInput.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') sendMessage()
	})
	messageButton.addEventListener('click', () => {
		sendMessage()
	})

})