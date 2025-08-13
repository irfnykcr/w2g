const loggerWss = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[WSS] [${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[WSS] [${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[WSS] [${timestamp}] [ERROR]`, ...args)
	},
	debug: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[WSS] [${timestamp}] [DEBUG]`, ...args)
	}
}

let replyState = {
    isReplying: false,
    replyToId: null,
    replyToUser: null,
    replyToMessage: null,
    originalMessageElement: null
}

let messagesById = new Map()
let ws

function getUserImageUrl() {
	const messages = Array.from(messagesById.values())
	const userMessages = messages.filter(msg => {
		const userSpan = msg.querySelector('span.font-semibold')
		return userSpan && !userSpan.classList.contains('text-admin')
	})
	
	for (let i = userMessages.length - 1; i >= 0; i--) {
		const messageContent = userMessages[i].querySelector('div:last-child')
		if (messageContent) {
			const gifImg = messageContent.querySelector('img[src*="tenor.com"]')
			if (gifImg) {
				return gifImg.src
			}
		}
	}
	
	return ''
}

function initializeReplySystem() {
    const closeReplyBtn = document.getElementById('close-reply')
    if (closeReplyBtn) {
        closeReplyBtn.addEventListener('click', closeReply)
    }
}

function setReplyMode(messageId, user, message, messageElement) {
    replyState.isReplying = true
    replyState.replyToId = messageId
    replyState.replyToUser = user
    replyState.replyToMessage = message
    replyState.originalMessageElement = messageElement
    
    const replyPreview = document.getElementById('reply-preview')
    const replyToUser = document.getElementById('reply-to-user')
    const replyToMessage = document.getElementById('reply-to-message')
    
    if (replyPreview && replyToUser && replyToMessage) {
        replyToUser.textContent = user
        replyToMessage.textContent = message
        replyPreview.classList.remove('hidden')
    }
    
    const inputField = document.getElementById('input-chatmessage')
    if (inputField) {
        inputField.focus()
    }
    
    loggerWss.info(`Reply mode activated for message from ${user} (ID: ${messageId})`)
}

function closeReply() {
    replyState.isReplying = false
    replyState.replyToId = null
    replyState.replyToUser = null
    replyState.replyToMessage = null
    replyState.originalMessageElement = null
    
    const replyPreview = document.getElementById('reply-preview')
    if (replyPreview) {
        replyPreview.classList.add('hidden')
    }
    
    loggerWss.info('Reply mode deactivated')
}

function scrollToMessage(messageId) {
    const messageElement = messagesById.get(messageId)
    if (messageElement) {
        messageElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        })
        
        messageElement.style.backgroundColor = 'rgba(100, 205, 138, 0.2)'
        setTimeout(() => {
            messageElement.style.backgroundColor = ''
        }, 2000)
    }
}

function updateWatchersList(watchers) {
    const watchersContainer = document.getElementById('watchers-list')
    if (!watchersContainer) return
    
    watchersContainer.innerHTML = ''
    
    if (watchers.length === 0) {
        watchersContainer.innerHTML = '<div class="text-gray-500 text-lg">No one is watching</div>'
        return
    }
    
    watchers.forEach(watcher => {
		const watcherElement = document.createElement('div')
		watcherElement.className = 'flex items-center gap-3 p-2 sm:p-3 bg-dark-hover rounded text-base sm:text-lg'

		let imageHtml = ''
		if (watcher.imageurl) {
			imageHtml = `
			<img 
				src="${watcher.imageurl}" 
				alt="${watcher.username}" 
				class="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border border-gray-600 flex-shrink-0"
				onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
			/>
			<div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-600 items-center justify-center text-base sm:text-lg font-bold text-turkuazz flex-shrink-0" style="display: none;">
				${watcher.username.charAt(0).toUpperCase()}
			</div>
			`
		} else {
			imageHtml = `
			<div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-600 flex items-center justify-center text-base sm:text-lg font-bold text-turkuazz flex-shrink-0">
				${watcher.username.charAt(0).toUpperCase()}
			</div>
			`
		}

		watcherElement.innerHTML = `
			${imageHtml}
			<span class="text-gray-300 truncate text-base sm:text-lg font-semibold">${watcher.username}</span>
		`
        watchersContainer.appendChild(watcherElement)
    })
}

function sendWatcherUpdate(isWatching, imageurl = '') {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const finalImageUrl = imageurl || getUserImageUrl()
        
        const data = {
            type: 'watcher_update',
            is_watching: isWatching,
            imageurl: finalImageUrl
        }
        ws.send(JSON.stringify(data))
        // loggerWss.debug('Sent watcher update:', data)
    }
}

document.addEventListener("DOMContentLoaded", async () => {
	const chatRoomName = document.querySelector("#chat-roomname")
	const inputRoomName = document.querySelector("#input-roomname")


	const SERVER_ENDPOINT = await window.electronAPI.getServerEndpoint()
	let USER 
	let USER_PSW
	await window.electronAPI.getUser().then((r)=>{
		loggerWss.debug(r)
		USER = r.user
		USER_PSW = r.psw
	})
	let ROOM_ID
	let ROOM_PSW 
	await window.electronAPI.getRoom().then(async (r)=>{
		loggerWss.debug(r)
		if (r === false){
			loggerWss.info("asking for room creds")
			window.electronAPI.gotoRoomJoin()
		} else {
			ROOM_ID = r.room
			ROOM_PSW = r.psw
			loggerWss.debug("already have creds",r, ROOM_ID, ROOM_PSW)
		}
		if (ROOM_ID === null || ROOM_ID === undefined){
			loggerWss.info("reload1")
			window.electronAPI.gotoRoomJoin()
		}
	}).catch((err)=>{
		loggerWss.info("reload2")
		window.electronAPI.gotoRoomJoin()
	})

	const joinquery = new URLSearchParams({
		user: USER,
		psw: USER_PSW,
		roomid: ROOM_ID,
		roompsw: ROOM_PSW,
	}).toString()
	

	let reconnectAttempts = 0

	function connectWebSocket(reconnectDelay=0, history="0") {
		const maxReconnectAttempts = 10
		if (reconnectAttempts < maxReconnectAttempts) {
			reconnectAttempts++
			loggerWss.info(`Attempting to connect... (${reconnectAttempts}/${maxReconnectAttempts})`)
			setTimeout(() => {
				const newSocket = new WebSocket(`wss://${SERVER_ENDPOINT}/wss/?${joinquery}&history=${history}`)
				attachSocketEvents(newSocket)
			}, reconnectDelay)
		} else {
			loggerWss.error("Max reconnect attempts reached. Could not reconnect to WebSocket.")
		}
	}


	function attachSocketEvents(socket) {
		socket.onopen = () => {
			loggerWss.info("WebSocket connection established")
			
			setTimeout(() => {
				window.electronAPI.getVLCStatus().then((vlcData) => {
					if (vlcData && (vlcData.status === 'playing' || vlcData.status === 'paused')) {
						isCurrentlyWatching = true
						sendWatcherUpdate(true)
						loggerWss.debug("Restored watcher status from existing VLC session")
					}
				}).catch(() => {
					loggerWss.debug("No existing VLC session found")
				})
			}, 1000)
		}

		socket.onmessage = (r) => {
			const data = JSON.parse(r.data)
			loggerWss.debug("Message received", data)

			if (data.type == "room_info") {
				chatRoomName.innerHTML = `Chat - ${data.room_name}`
				inputRoomName.innerHTML = `Watch Video - ${data.room_name}`
			} else if (data.type == "new_message") {
				addMessage(data)
			} else if (data.type == "room_history") {
				data.messages.forEach((message) => {
					addMessage(message)
				})
			} else if (data.type == "watchers_update") {
				updateWatchersList(data.watchers)
			} else {
				loggerWss.warn("couldnt match the type.", data.type)
			}
		}

		socket.onclose = () => {
			loggerWss.info("WebSocket connection closed")
			connectWebSocket(2000)
		}

		socket.onerror = (error) => {
			loggerWss.error("WebSocket error:", error)
		}

		ws = socket
	}

	connectWebSocket(0, "1")

	const messages = document.getElementById("chat-content")
	const messageButton = document.getElementById("send-chatmessage")
	const messageInput = document.getElementById("input-chatmessage")

	function sendMessage() {
		const message = messageInput.value.trim()
		if (message) {
			const messageData = {
				type: "send_message",
				message: message,
			}

			if (replyState.isReplying && replyState.replyToId) {
				messageData.reply_to = replyState.replyToId
			}

			ws.send(JSON.stringify(messageData))
			messageInput.value = ""
			
			if (replyState.isReplying) {
				closeReply()
			}
		}
	}

	function addMessage(data) {
		const messageId = data.id
		const user = data.user
		const text = data.message
		const date = new Date(data.date * 1000).toLocaleString()
		const replyTo = data.reply_to || null

		const messageDiv = document.createElement("div")
		messageDiv.className = "mb-3 p-3 bg-dark-hover rounded-md border-l-4 border-turkuazz"
		messageDiv.setAttribute('data-message-id', messageId)
		
		let replyContent = ''
		if (replyTo) {
			replyContent = `
				<div class="mb-2 p-2 bg-gray-700 rounded border-l-2 border-gray-500 text-xs cursor-pointer hover:bg-gray-600 transition-colors duration-200" 
					 onclick="scrollToMessage(${replyTo.id})" 
					 title="Click to scroll to original message">
					<div class="text-gray-400">Replying to <span class="text-turkuazz font-semibold">${replyTo.user}</span></div>
					<div class="text-gray-300 mt-1">${replyTo.message}</div>
				</div>
			`
		}

		const processedContent = window.processMessageContent ? window.processMessageContent(text) : text
		
		messageDiv.innerHTML = `
			${replyContent}
			<div class="flex justify-between items-start mb-2">
				<span class="font-semibold ${user === "system" ? "text-admin" : "text-turkuazz"} text-sm break-words">${user}</span>
				<div class="flex items-center gap-2 text-xs text-gray-500 ml-2 flex-shrink-0">
					<span>${date}</span>
					${user !== "system" && messageId ?
						`<button class="reply-btn hover:text-dark-turkuazz text-turkuazz transition-colors duration-200" title="Reply">
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-reply" viewBox="0 0 16 16">
								<path d="M6.598 5.013a.144.144 0 0 1 .202.134V6.3a.5.5 0 0 0 .5.5c.667 0 2.013.005 3.3.822.984.624 1.99 1.76 2.595 3.876-1.02-.983-2.185-1.516-3.205-1.799a8.7 8.7 0 0 0-1.921-.306 7 7 0 0 0-.798.008h-.013l-.005.001h-.001L7.3 9.9l-.05-.498a.5.5 0 0 0-.45.498v1.153c0 .108-.11.176-.202.134L2.614 8.254l-.042-.028a.147.147 0 0 1 0-.252l.042-.028zM7.8 10.386q.103 0 .223.006c.434.02 1.034.086 1.7.271 1.326.368 2.896 1.202 3.94 3.08a.5.5 0 0 0 .933-.305c-.464-3.71-1.886-5.662-3.46-6.66-1.245-.79-2.527-.942-3.336-.971v-.66a1.144 1.144 0 0 0-1.767-.96l-3.994 2.94a1.147 1.147 0 0 0 0 1.946l3.994 2.94a1.144 1.144 0 0 0 1.767-.96z"/>
							</svg>
						</button>`
					: ''}
				</div>
			</div>
			<div class="text-gray-300 text-sm break-words">${processedContent}</div>
		`

		if (messageId) {
			messagesById.set(messageId, messageDiv)
		}

		if (user !== "system" && messageId) {
			const replyBtn = messageDiv.querySelector('.reply-btn')
			if (replyBtn) {
				replyBtn.addEventListener('click', () => {
					setReplyMode(messageId, user, text, messageDiv)
				})
			}
		}

		messages.appendChild(messageDiv)
		messages.scrollTop = messages.scrollHeight
	}

	messageInput.addEventListener("keypress", (e) => {
		if (e.key === "Enter") sendMessage()
	})

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && replyState.isReplying) {
			closeReply()
		}
	})

	messageButton.addEventListener("click", () => {
		sendMessage()
	})

	initializeReplySystem()
	
	if (window.initializeGifPicker) {
		window.initializeGifPicker()
	}

	let isCurrentlyWatching = false
	
	window.electronAPI.onVLCstatus((data) => {
		const isWatching = data.status === 'playing' || data.status === 'paused'
		const isClosed = data.status === 'closed' || data.status === 'error'
		
		if (isClosed && isCurrentlyWatching) {
			isCurrentlyWatching = false
			sendWatcherUpdate(false)
		} else if (isWatching !== isCurrentlyWatching) {
			isCurrentlyWatching = isWatching
			sendWatcherUpdate(isWatching)
		}
	})

	const playVideoButton = document.getElementById('play-thevideo')
	if (playVideoButton) {
		playVideoButton.addEventListener('click', () => {
			setTimeout(() => {
				sendWatcherUpdate(true)
			}, 3000)
		})
	}

	window.scrollToMessage = scrollToMessage
	window.sendWatcherUpdate = sendWatcherUpdate
})
