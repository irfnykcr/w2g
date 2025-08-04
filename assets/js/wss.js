import { io } from "https://cdn.socket.io/4.8.1/socket.io.esm.min.js";
const USERID = localStorage.getItem("user")
const PSW = "123"


document.addEventListener("DOMContentLoaded", () => {
	const socket = io("http://127.0.0.1:33229", {
		extraHeaders: {
			"user": USERID,
			"psw": PSW
		}
	})
	const messages = document.getElementById('chat-content')
	const messageButton = document.getElementById('send-chatmessage')
	const messageInput = document.getElementById('input-chatmessage')

	socket.on('user_joined', (data) => {
		addMessage(data)
	})

	socket.on('user_left', (data) => {
		addMessage(data)
	})

	socket.on('new_message', (data) => {
		addMessage(data)
	})

	function addMessage(data) {
		const user = data.user
		const text = data.message
		const div = document.createElement('div')
		div.innerHTML = `
			<div class="flex-1 bg-dark-bg rounded-md p-4 overflow-y-auto border border-gray-700 mb-4 flex flex-col gap-2 break-words">
				<div class="text-gray-300">
					<span class="font-semibold text-turkuazz">${user}</span> ${text}
				</div>
			</div>
		`
		messages.appendChild(div)
		messages.scrollTop = messages.scrollHeight
	}

	function sendMessage() {
		const message = messageInput.value.trim()
		if (message) {
			socket.emit('send_message', {message})
			messageInput.value = ''
		}
	}

	messageInput.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') sendMessage()
	})
	messageButton.addEventListener('click', () => {
		sendMessage()
	})

})