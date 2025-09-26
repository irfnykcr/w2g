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
let messageReactions = new Map()
let userColors = new Map()
let wss
let USER 
let hasMoreMessages = true
let isLoadingMessages = false
let oldestMessageId = null
let isConnecting = false
let reconnectTimeout = null
let connectionTimeout = null 

const availableColors = [
	'#ffe119', '#4363d8', '#f58231', '#911eb4',
	'#46f0f0', '#f032e6', '#bcf60c', '#008080', '#e6beff',
	'#9a6324', '#aaffc3',
	'#000075', '#ffffff', '#000000'
]

function simpleHash(str) {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = ((hash << 5) - hash) + char
		hash = hash & hash
	}
	return Math.abs(hash)
}

function getUserColor(username) {
	if (username === 'system') return '#FF4444'
	if (userColors.has(username)) {
		return userColors.get(username)
	}
	const hash = simpleHash(username)
	const colorIndex = hash % availableColors.length
	const color = availableColors[colorIndex]
	userColors.set(username, color)
	return color
} 

// focus tracking and notification system
let isWindowFocused = true
let hasUnreadMessages = false
let notificationSound = null
let messageHandlers = new Map()


// heartbeat
let heartbeatInterval = null
let lastPong = Date.now()

function sendSafe(data) {
	if (!wss || wss.readyState !== WebSocket.OPEN) {
		loggerWss.warn('sendSafe: websocket not open')
		return false
	}
	try {
		wss.send(JSON.stringify(data))
		return true
	} catch (err) {
		loggerWss.error('sendSafe: failed to send', err)
		return false
	}
}

window.addEventListener('focus', () => {
	const wasUnfocused = !isWindowFocused
	isWindowFocused = true
	if (wasUnfocused && hasUnreadMessages) {
		clearNotificationGlow()
	}
})

window.addEventListener('blur', () => {
	isWindowFocused = false
})

function clearNotificationGlow() {
	hasUnreadMessages = false
	const glowElement = document.getElementById('chat-notification-glow')
	if (glowElement) {
		glowElement.classList.add('hidden')
		loggerWss.debug("clearNotificationGlow: glow element found and hidden class added")
	} else {
		loggerWss.error("clearNotificationGlow: glow element not found!")
	}
}

function showNotificationGlow() {
	loggerWss.debug("showNotificationGlow: showing glow")
	hasUnreadMessages = true
	const glowElement = document.getElementById('chat-notification-glow')
	if (glowElement) {
		glowElement.classList.remove('hidden')
		loggerWss.debug("showNotificationGlow: glow element found and hidden class removed")
	} else {
		loggerWss.error("showNotificationGlow: glow element not found!")
	}
}

function playNotificationSound() {
	if (!isWindowFocused && notificationSound) {
		notificationSound.play().catch(err => {
			loggerWss.debug('Could not play notification sound:', err.message)
		})
	}
}

function chatStatus(status) {
	const chatRoomName = document.querySelector("#chat-roomname")
	if (chatRoomName) {
		chatRoomName.textContent = chatRoomName.textContent.replace(/( \(connecting\.\.\)| \(device is offline\)| \(connection failed!\))/g, "")
	}
	if (status === "connecting") {
		chatRoomName.textContent += " (connecting..)"
	} else if (status === "offline") {
		chatRoomName.textContent += " (device is offline)"
	} else if (status === "failed") {
		chatRoomName.textContent += " (connection failed!)"
	}
}


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
		replyToUser.style.color = getUserColor(user)
        replyToMessage.textContent = message
		
        replyPreview.className = `mx-4 sm:mx-6 mb-2 p-3 bg-gray-700 rounded-md border-l-4 border-[${getUserColor(user)}]`

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

function sendReaction(messageId, emoji) {
	if (!messageId || !emoji){
		loggerWss.info(`sendReaction: something went wrong. messageId'${messageId}' emoji'${emoji}'`)
		return
	}
    if (wss && wss.readyState === WebSocket.OPEN) {
        const data = {
            type: "new_reaction",
            emoji: emoji,
            reply_to: messageId
        }
		if (sendSafe(data)) {
			loggerWss.debug(`Sent reaction ${emoji} to message ${messageId}`)
		} else {
			loggerWss.error('sendReaction: failed to send reaction')
		}
    }
}

function handleReactionRemoval(data) {
    const targetMessageId = data.reply_to
    const emoji = data.message
    const user = data.user
    
    if (!messageReactions.has(targetMessageId)) {
        return
    }
    
    const reactions = messageReactions.get(targetMessageId)
    
    if (reactions[emoji]) {
        const userIndex = reactions[emoji].users.indexOf(user)
        if (userIndex > -1) {
            reactions[emoji].users.splice(userIndex, 1)
            reactions[emoji].count--
            
            if (reactions[emoji].count === 0) {
                delete reactions[emoji]
            }
        }
    }
    
    updateMessageReactions(targetMessageId)
    loggerWss.debug(`Removed reaction ${emoji} from user ${user} on message ${targetMessageId}`)
}

function showMessageContextMenu(event, messageId, messageUser, messageText, messageElement) {
    const existingMenu = document.querySelector('.message-context-menu')
    if (existingMenu) {
        existingMenu.remove()
    }
    
    const isDeleted = messageElement.style.opacity === '0.5' && messageElement.style.filter === 'grayscale(100%)'
    
    const menu = document.createElement('div')
    menu.className = 'message-context-menu absolute bg-dark-card border border-gray-600 rounded-lg py-1 z-50 shadow-lg min-w-32'
    
    if (!isDeleted) {
        const replyItem = document.createElement('div')
        replyItem.className = 'px-3 py-2 text-sm text-gray-300 hover:bg-dark-hover cursor-pointer flex items-center gap-2'
        replyItem.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M6.598 5.013a.144.144 0 0 1 .202.134V6.3a.5.5 0 0 0 .5.5c.667 0 2.013.005 3.3.822.984.624 1.99 1.76 2.595 3.876-1.02-.983-2.185-1.516-3.205-1.799a8.7 8.7 0 0 0-1.921-.306 7 7 0 0 0-.798.008h-.013l-.005.001h-.001L7.3 9.9l-.05-.498a.5.5 0 0 0-.45.498v1.153c0 .108-.11.176-.202.134L2.614 8.254l-.042-.028a.147.147 0 0 1 0-.252l.042-.028zM7.8 10.386q.103 0 .223.006c.434.02 1.034.086 1.7.271 1.326.368 2.896 1.202 3.94 3.08a.5.5 0 0 0 .933-.305c-.464-3.71-1.886-5.662-3.46-6.60-1.245-.79-2.527-.942-3.336-.971v-.66a1.144 1.144 0 0 0-1.767-.96l-3.994 2.94a1.147 1.147 0 0 0 0 1.946l3.994 2.94a1.144 1.144 0 0 0 1.767-.96z"/>
            </svg>
            Reply
        `
        replyItem.addEventListener('click', () => {
            setReplyMode(messageId, messageUser, messageText, messageElement)
            menu.remove()
        })
        menu.appendChild(replyItem)
    }
    
    if (messageUser === USER && !isDeleted) {
        if (menu.children.length > 0) {
            const separator = document.createElement('div')
            separator.className = 'border-t border-gray-600 my-1'
            menu.appendChild(separator)
        }
        
        const deleteItem = document.createElement('div')
        deleteItem.className = 'px-3 py-2 text-sm text-red-400 hover:bg-dark-hover cursor-pointer flex items-center gap-2'
        deleteItem.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
            Delete
        `
        deleteItem.addEventListener('click', () => {
            deleteMessage(messageId)
            menu.remove()
        })
        menu.appendChild(deleteItem)
    }
    
    if (menu.children.length === 0) {
        return
    }
    
    menu.style.position = 'fixed'
    menu.style.left = `${event.clientX}px`
    menu.style.top = `${event.clientY}px`
    
    document.body.appendChild(menu)
    
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove()
            document.removeEventListener('click', closeMenu)
        }
    }
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu)
    }, 100)
    
    setTimeout(() => {
        const menuRect = menu.getBoundingClientRect()
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = `${event.clientY - menuRect.height}px`
        }
        if (menuRect.right > window.innerWidth) {
            menu.style.left = `${event.clientX - menuRect.width}px`
        }
    }, 10)
}

function deleteMessage(messageId) {
    if (wss && wss.readyState === WebSocket.OPEN) {
        const data = {
            type: "delete_message",
            message_id: messageId
        }
		try {
			sendSafe(data)
			loggerWss.debug(`Sent delete request for message ${messageId}`)
		} catch (err) {
			loggerWss.error('deleteMessage: failed to send delete request', err)
		}
    }
}

function handleMessageDeletion(data) {
    const messageId = data.message_id
    const messageElement = messagesById.get(messageId)
    
    if (messageElement) {
        messageElement.style.opacity = '0.5'
        messageElement.style.filter = 'grayscale(100%)'
        
        const messageContent = messageElement.querySelector('.text-gray-300.text-sm.break-words')
        if (messageContent) {
            messageContent.innerHTML = '<em class="text-gray-500">This message was deleted</em>'
        } else {
            const fallbackContent = messageElement.querySelector('.text-gray-300')
            if (fallbackContent) {
                fallbackContent.innerHTML = '<em class="text-gray-500">This message was deleted</em>'
            }
        }
        
        const replyBtn = messageElement.querySelector('.reply-btn')
        if (replyBtn) {
            replyBtn.remove()
        }
        
        const actionsContainer = messageElement.querySelector('.flex.justify-end')
        if (actionsContainer) {
            actionsContainer.remove()
        }

        const messageHeader = messageElement.querySelector('.message-header')
        if (messageHeader) {
            messageHeader.style.display = 'flex'
        }
        
        const wasMiddleOrLast = messageElement.classList.contains('message-middle') || messageElement.classList.contains('message-last')
        
        messageElement.style.marginBottom = '12px'
        messageElement.style.borderRadius = '8px'
        
        if (wasMiddleOrLast) {
            const prevSibling = messageElement.previousElementSibling
            const prevIsDeleted = prevSibling && (prevSibling.style.opacity === '0.5')
            
            if (!prevIsDeleted) {
                messageElement.style.marginTop = '12px'
            }
        }
        
        const previousSibling = messageElement.previousElementSibling
        if (previousSibling) {
            previousSibling.classList.remove('message-middle', 'message-first')
            previousSibling.classList.add('message-last')
            previousSibling.style.borderRadius = '4px 4px 8px 8px'
            previousSibling.style.marginBottom = '12px'
        }
        
        const nextSibling = messageElement.nextElementSibling
        if (nextSibling) {
            const nextUser = nextSibling.getAttribute('data-message-user')
            const deletedUser = messageElement.getAttribute('data-message-user')
            
            if (nextUser === deletedUser) {
                const nextHeader = nextSibling.querySelector('.message-header')
                if (nextHeader) {
                    nextHeader.style.display = 'flex'
                }
                nextSibling.classList.remove('message-middle', 'message-last')
                nextSibling.classList.add('message-first')
                nextSibling.style.borderRadius = '8px 8px 4px 4px'
            }
        }
        
		if (messageHandlers.has(messageId)) {
			const stored = messageHandlers.get(messageId)
			const el = stored.element
			const h = stored.handlers
			if (h.dblclick) el.removeEventListener('dblclick', h.dblclick)
			if (h.contextmenu) el.removeEventListener('contextmenu', h.contextmenu)
			if (h.replyClick) {
				const replyBtn = el.querySelector('.reply-btn')
				if (replyBtn) replyBtn.removeEventListener('click', h.replyClick)
			}
			if (h.reactionClick) {
				const reactionBtn = el.querySelector('.reaction-add-btn')
				if (reactionBtn) reactionBtn.removeEventListener('click', h.reactionClick)
			}
			messageHandlers.delete(messageId)
		} else {
			try { messageElement.removeEventListener('dblclick', () => {}) } catch(e){}
			try { messageElement.removeEventListener('contextmenu', () => {}) } catch(e){}
		}
        
        if (messageReactions.has(messageId)) {
            messageReactions.delete(messageId)
            const reactionsContainer = messageElement.querySelector('.reactions-container')
            if (reactionsContainer) {
                reactionsContainer.remove()
            }
        }

        messagesById.forEach((element, id) => {
            const replyDiv = element.querySelector('[onclick*="scrollToMessage(' + messageId + ')"]')
            if (replyDiv) {
                updateReplyToDeletedMessage(replyDiv)
            }
        })
        
        loggerWss.debug(`Message ${messageId} marked as deleted`)
    }
}

function updateReplyToDeletedMessage(replyDiv) {
    const replyMessageDiv = replyDiv.querySelector('.text-gray-300')
    if (replyMessageDiv) {
        replyMessageDiv.innerHTML = '<em class="text-gray-500">Original message was deleted</em>'
    }
    
    replyDiv.removeAttribute('onclick')
    replyDiv.style.cursor = 'default'
    replyDiv.title = 'Original message was deleted'
}

function updateMessageReactions(messageId) {
    const messageElement = messagesById.get(messageId)
    if (!messageElement) return
    
    const reactions = messageReactions.get(messageId) || {}
    let reactionsContainer = messageElement.querySelector('.reactions-container')
    
    if (Object.keys(reactions).length === 0) {
        if (reactionsContainer) {
            reactionsContainer.remove()
        }
        return
    }
    
    if (!reactionsContainer) {
        reactionsContainer = document.createElement('div')
        reactionsContainer.className = 'reactions-container flex flex-wrap gap-1'
        
        const reactionsArea = messageElement.querySelector('.message-reactions-area')
        if (reactionsArea) {
            reactionsArea.appendChild(reactionsContainer)
        } else {
            const emojiButtonContainer = messageElement.querySelector('.reaction-add-btn')?.parentNode
            if (emojiButtonContainer) {
                emojiButtonContainer.insertBefore(reactionsContainer, emojiButtonContainer.firstChild)
            } else {
                messageElement.appendChild(reactionsContainer)
            }
        }
    }
    
    reactionsContainer.innerHTML = ''
    
    Object.entries(reactions).forEach(([emoji, data]) => {
        const reactionBtn = document.createElement('button')
        reactionBtn.className = 'reaction-btn bg-dark-card hover:bg-dark-hover border border-gray-600 rounded-full px-2 py-1 text-xs flex items-center gap-1 transition-colors duration-200'
        reactionBtn.innerHTML = `<span>${emoji}</span><span class="text-gray-400">${data.count}</span>`
        reactionBtn.title = `${data.users.join(', ')} reacted with ${emoji}`
        
        reactionBtn.addEventListener('click', () => {
            sendReaction(messageId, emoji)
        })
        
        reactionsContainer.appendChild(reactionBtn)
    })
}

function showReactionModal(button, messageId) {
    const existingModal = document.querySelector('.reaction-modal')
    if (existingModal) {
        existingModal.remove()
    }
    
    const modal = document.createElement('div')
    modal.className = 'reaction-modal absolute bg-dark-card border border-gray-600 rounded-lg p-2 flex gap-2 z-50 shadow-lg'
    
    const emojis = ['😄', '😍', '😔', '😎', '👍', '👎', '💗']
    
    emojis.forEach(emoji => {
        const emojiBtn = document.createElement('button')
        emojiBtn.className = 'hover:bg-dark-hover rounded p-1 transition-colors duration-200 text-lg'
        emojiBtn.textContent = emoji
        emojiBtn.addEventListener('click', () => {
            sendReaction(messageId, emoji)
            modal.remove()
        })
        modal.appendChild(emojiBtn)
    })
    
    const buttonRect = button.getBoundingClientRect()
    modal.style.position = 'fixed'
    modal.style.top = `${buttonRect.top - modal.offsetHeight - 10}px`
    modal.style.left = `${buttonRect.left}px`
    
    document.body.appendChild(modal)
    
    const closeModal = (e) => {
        if (!modal.contains(e.target) && e.target !== button) {
            modal.remove()
            document.removeEventListener('click', closeModal)
        }
    }
    
    setTimeout(() => {
        document.addEventListener('click', closeModal)
    }, 100)
    
    setTimeout(() => {
        const modalRect = modal.getBoundingClientRect()
        if (modalRect.bottom > window.innerHeight) {
            modal.style.top = `${buttonRect.bottom + 10}px`
        }
        if (modalRect.right > window.innerWidth) {
            modal.style.left = `${window.innerWidth - modalRect.width - 10}px`
        }
    }, 10)
}

function updateWatchersList(watchers) {
    const watchersContainer = document.getElementById('watchers-list')
    if (!watchersContainer) return
    
    const noWatchersMsg = watchersContainer.querySelector('.no-watchers-message')
    if (noWatchersMsg) {
        noWatchersMsg.remove()
    }
    
    if (watchers.length === 0) {
        const existingElements = watchersContainer.querySelectorAll('[data-watcher]')
        existingElements.forEach(el => el.remove())
        
        watchersContainer.innerHTML = '<div class="text-gray-500 text-sm no-watchers-message">No one is watching</div>'
        return
    }
    
    const existingElements = new Map()
    watchersContainer.querySelectorAll('[data-watcher]').forEach(el => {
        existingElements.set(el.dataset.watcher, el)
    })
    
    const processedWatchers = new Set()
    
    watchers.forEach(watcher => {
        processedWatchers.add(watcher.username)
        
        const noWatchersMsg = watchersContainer.querySelector('.no-watchers-message')
        if (noWatchersMsg) {
            noWatchersMsg.remove()
        }
        
        let watcherElement = existingElements.get(watcher.username)
        const isNewElement = !watcherElement
        
        if (isNewElement) {
            watcherElement = document.createElement('div')
            watcherElement.className = 'flex items-center gap-2 p-2 bg-dark-hover rounded-lg text-sm border-l-4 transition-all duration-200 min-w-0 flex-shrink-0'
            watcherElement.setAttribute('data-watcher', watcher.username)
        }
        
        const syncStatus = watcher.is_uptodate
        const newBorderClass = syncStatus ? `border-[${getUserColor(watcher.username)}]` : 'border-red-500'
        const currentBorderClass = watcherElement.classList.contains(`border-[${getUserColor(watcher.username)}]`) ? `border-[${getUserColor(watcher.username)}]` : 'border-red-500'
        
        if (newBorderClass !== currentBorderClass) {
            watcherElement.classList.remove(`border-[${getUserColor(watcher.username)}]`, 'border-red-500')
            watcherElement.classList.add(newBorderClass)
        }
        
        const formatTime = (seconds) => {
            const mins = Math.floor(seconds / 60)
            const secs = seconds % 60
            return `${mins}:${secs.toString().padStart(2, '0')}`
        }
        
        const statusIcon = watcher.is_playing ? '▶️' : '⏸️'
        const syncIcon = watcher.is_uptodate ? '✅' : '⚠️'
        const formattedTime = formatTime(watcher.current_time || 0)
        const syncText = watcher.is_uptodate ? 'Synced' : 'Behind'
        
        if (isNewElement) {
            let imageHtml = ''
            if (watcher.imageurl) {
                imageHtml = `
                <img 
                    src="${watcher.imageurl}" 
                    alt="${watcher.username}" 
                    class="w-6 h-6 rounded-full object-cover border border-gray-600 flex-shrink-0 watcher-image"
                    onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                />
                <div class="w-6 h-6 rounded-full bg-gray-600 items-center justify-center text-xs font-bold text-[${getUserColor(watcher.username)}] flex-shrink-0 watcher-fallback" style="display: none;">
                    ${watcher.username.charAt(0).toUpperCase()}
                </div>
                `
            } else {
                imageHtml = `
                <div class="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold text-[${getUserColor(watcher.username)}] flex-shrink-0 watcher-fallback">
                    ${watcher.username.charAt(0).toUpperCase()}
                </div>
                `
            }

            watcherElement.innerHTML = `
                ${imageHtml}
                <div class="flex flex-col min-w-0 flex-1">
                    <div class="font-medium text-[${getUserColor(watcher.username)}] truncate text-xs watcher-username">${watcher.username}</div>
                    <div class="flex items-center gap-1 text-xs text-gray-400">
                        <span class="watcher-status">${statusIcon} ${formattedTime}</span>
                        <span class="watcher-sync">${syncIcon}</span>
                    </div>
                </div>
            `
            
            watchersContainer.appendChild(watcherElement)
        } else {
            const statusSpan = watcherElement.querySelector('.watcher-status')
            const syncSpan = watcherElement.querySelector('.watcher-sync')
            
            if (statusSpan) {
                const newStatusText = `${statusIcon} ${formattedTime}`
                if (statusSpan.textContent !== newStatusText) {
                    statusSpan.textContent = newStatusText
                }
            }
            
            if (syncSpan) {
                const newSyncText = `${syncIcon} ${syncText}`
                if (syncSpan.textContent !== newSyncText) {
                    syncSpan.textContent = newSyncText
                }
            }
            
            const watcherImage = watcherElement.querySelector('.watcher-image')
            
            if (watcher.imageurl && watcherImage && watcherImage.src !== watcher.imageurl) {
                watcherImage.src = watcher.imageurl
            }
        }
    })
    
    existingElements.forEach((element, username) => {
        if (!processedWatchers.has(username)) {
            element.style.opacity = '0'
            element.style.transform = 'scale(0.95)'
            setTimeout(() => {
                if (element.parentNode) {
                    element.remove()
                }
            }, 200)
        }
    })
}

function sendWatcherUpdate(isWatching, imageurl = '', currentTime = 0, isPlaying = false, isUptodate = false) {
    if (wss && wss.readyState === WebSocket.OPEN) {
        const finalImageUrl = imageurl || getUserImageUrl()
        
        const data = {
            type: 'watcher_update',
            is_watching: isWatching,
            imageurl: finalImageUrl,
            current_time: currentTime,
            is_playing: isPlaying,
            is_uptodate: isUptodate
        }
		if (!sendSafe(data)) {
			loggerWss.error('sendWatcherUpdate: failed to send watcher update')
		}
    }
}

document.addEventListener("DOMContentLoaded", async () => {
	notificationSound = document.getElementById('notification-sound')
	const chatRoomName = document.querySelector("#chat-roomname")
	const inputRoomName = document.querySelector("#input-roomname")


	const SERVER_ENDPOINT = await window.electronAPI.getServerEndpoint()
	let USER_PSW
	await window.electronAPI.getUser().then((r)=>{
		USER = r.user
		USER_PSW = r.psw
	})
	let ROOM_ID
	let ROOM_PSW 
	await window.electronAPI.getRoom().then(async (r)=>{
		if (r === false){
			loggerWss.info("asking for room creds")
			window.electronAPI.gotoRoomJoin()
		} else {
			ROOM_ID = r.room
			ROOM_PSW = r.psw
			// loggerWss.debug("already have creds",r, ROOM_ID, ROOM_PSW)
			loggerWss.debug("already have creds")
		}
		if (ROOM_ID === null || ROOM_ID === undefined){
			loggerWss.info("reload1")
			window.electronAPI.gotoRoomJoin()
		}
	}).catch((err)=>{
		loggerWss.info("reload2")
		window.electronAPI.gotoRoomJoin()
	})
	

	let reconnectAttempts = 0
	let lastMessageDate = 0
	let waitingForMessage = 0

	function connectWebSocket(reconnectDelay=0) {
		if (isConnecting) {
			loggerWss.warn('Connection attempt already in progress')
			return
		}
		
		if (wss && (wss.readyState === WebSocket.CONNECTING || wss.readyState === WebSocket.OPEN)) {
			loggerWss.warn('WebSocket already connecting or connected')
			return
		}

		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout)
			reconnectTimeout = null
		}

		isConnecting = true
		chatStatus("connecting")
		
		const maxReconnectAttempts = 25
		if (reconnectAttempts < maxReconnectAttempts) {
			reconnectAttempts++
			loggerWss.info(`Attempting to connect... (${reconnectAttempts}/${maxReconnectAttempts})`)
			
			reconnectTimeout = setTimeout(() => {
				reconnectTimeout = null
				
				if (!navigator.onLine) {
					loggerWss.warn('Device is offline, delaying connection')
					isConnecting = false
					reconnectTimeout = setTimeout(() => connectWebSocket(1000), 5000)
					return
				}
				
				const queryParams = new URLSearchParams({
					user: USER,
					psw: USER_PSW,
					roomid: ROOM_ID,
					roompsw: ROOM_PSW,
					lastMessageDate: lastMessageDate
				}).toString()
				
				try {
					const newSocket = new WebSocket(`wss://${SERVER_ENDPOINT}/wss/?${queryParams}`)
					
					connectionTimeout = setTimeout(() => {
						if (newSocket.readyState === WebSocket.CONNECTING) {
							loggerWss.warn('Connection timeout, closing socket')
							newSocket.close()
						}
					}, 10000)
					
					attachSocketEvents(newSocket)
				} catch (err) {
					loggerWss.error('connectWebSocket: failed to create socket', err)
					isConnecting = false
					reconnectTimeout = setTimeout(() => connectWebSocket(2000), 2000)
				}
			}, reconnectDelay)
		} else {
			isConnecting = false
			loggerWss.error("Max reconnect attempts reached. Could not reconnect to WebSocket.")
			chatStatus("failed")
		}
	}


	function attachSocketEvents(socket) {
		socket.onopen = () => {
			loggerWss.info("WebSocket connection established")
			
			if (connectionTimeout) {
				clearTimeout(connectionTimeout)
				connectionTimeout = null
			}
			
			isConnecting = false
			reconnectAttempts = 0
			
			chatStatus("connecting")

			lastPong = Date.now()
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval)
				heartbeatInterval = null
			}
			
			heartbeatInterval = setInterval(() => {
				if (!wss || wss.readyState !== WebSocket.OPEN){
					loggerWss.warn(`heartbeatInterval: wss.readyState'${wss ? wss.readyState : 'null'}'`)
					if (heartbeatInterval) {
						clearInterval(heartbeatInterval)
						heartbeatInterval = null
					}
					return
				}
				
				const lastpong_relative = Date.now() - lastPong
				if (lastpong_relative > 12000) {
					loggerWss.warn('heartbeatInterval: No response, forcing close')
					if (heartbeatInterval) { 
						clearInterval(heartbeatInterval) 
						heartbeatInterval = null 
					}
					
					try {
						if (!navigator.onLine) {
							if (wss.terminate) {
								wss.terminate()
							} else {
								wss.close()
							}
						} else {
							wss.close(3001, 'heartbeat_timeout')
						}
						wss = null
					} catch(e) {
						loggerWss.debug('Error closing in heartbeat:', e)
					}
					return
				}
				
				if (lastpong_relative < 4000) {
					return
				}
				
				sendSafe({ type: 'ping', ts: Date.now() })
			}, 5000)
			
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
			let data = null
			try {
				data = JSON.parse(r.data)
			} catch (err) {
				loggerWss.error('Failed to parse incoming message:', err)
				return
			}

			if (data && data.type === 'pong') {
				// loggerWss.debug('Got pong')
				lastPong = Date.now()
				return
			}
			lastPong = Date.now()

			waitingForMessage = 0
			// loggerWss.debug("Message received", data)

			if (data.type == "room_info") {
				if (chatRoomName) chatRoomName.innerHTML = `Chat - ${data.room_name}`
				if (inputRoomName) inputRoomName.innerHTML = `Watch Video - ${data.room_name}`
			} else if (data.type == "new_message") {
				addMessage(data)
			} else if (data.type == "new_reaction") {
				addMessage(data)
			} else if (data.type == "reaction_removed") {
				handleReactionRemoval(data)
			} else if (data.type == "message_deleted") {
				handleMessageDeletion(data)
			} else if (data.type == "room_history") {
				const isPagination = data.is_pagination || false
				hasMoreMessages = data.has_more || false
				
				if (isPagination) {
					const messagesContainer = document.getElementById("chat-content")
					let scrollTop = 0
					let scrollHeight = 0
					if (messagesContainer) {
						scrollTop = messagesContainer.scrollTop
						scrollHeight = messagesContainer.scrollHeight
					}
					
					data.messages.forEach((message) => {
						if (message.message_type === "new_reaction") {
							const targetMessageId = message.reply_to?.id
							if (targetMessageId) {
								if (!messageReactions.has(targetMessageId)) {
									messageReactions.set(targetMessageId, {})
								}
								
								const reactions = messageReactions.get(targetMessageId)
								const emoji = message.message
								const user = message.user
								
								if (!reactions[emoji]) {
									reactions[emoji] = { users: [], count: 0 }
								}
								reactions[emoji].users.push(user)
								reactions[emoji].count++
							}
						}
						addMessage(message, true, true)
					})
					
					messageReactions.forEach((reactions, messageId) => {
						updateMessageReactions(messageId)
					})
					
					const newScrollHeight = messagesContainer.scrollHeight
					messagesContainer.scrollTop = scrollTop + (newScrollHeight - scrollHeight)
				} else {
					data.messages.forEach((message) => {
						if (message.message_type === "new_reaction") {
							const targetMessageId = message.reply_to?.id
							if (targetMessageId) {
								if (!messageReactions.has(targetMessageId)) {
									messageReactions.set(targetMessageId, {})
								}
								
								const reactions = messageReactions.get(targetMessageId)
								const emoji = message.message
								const user = message.user
								
								if (!reactions[emoji]) {
									reactions[emoji] = { users: [], count: 0 }
								}
								reactions[emoji].users.push(user)
								reactions[emoji].count++
							}
						}
						addMessage(message, true)
					})
					
					messageReactions.forEach((reactions, messageId) => {
						updateMessageReactions(messageId)
					})
				}
				
				if (data.messages.length > 0) {
					const actualMessages = data.messages.filter(msg => msg.message_type === "new_message")
					
					if (actualMessages.length > 0) {
						if (isPagination) {
							const oldestActualMessage = actualMessages.reduce((oldest, msg) => 
								msg.id < oldest.id ? msg : oldest
							)
							if (!oldestMessageId || oldestActualMessage.id < oldestMessageId) {
								oldestMessageId = oldestActualMessage.id
							}
						} else {
							const firstActualMessage = actualMessages[0]
							oldestMessageId = firstActualMessage.id
						}
					}
				}
				
				isLoadingMessages = false
			} else if (data.type == "watchers_update") {
				updateWatchersList(data.watchers)
			} else {
				loggerWss.warn("couldnt match the type.", data.type)
			}
		}
		
		socket.onclose = (ev) => {
			loggerWss.info("WebSocket connection closed", `code:${ev.code}`, `reason:${ev.reason || 'none'}`)
			
			if (heartbeatInterval) { 
				clearInterval(heartbeatInterval)
				heartbeatInterval = null 
			}
			if (connectionTimeout) {
				clearTimeout(connectionTimeout)
				connectionTimeout = null
			}
			
			if (wss){
				if (wss === socket) {
					if (wss.close){
						wss.close()
					}
					wss = null
				}
			}
			if (socket){
				if (socket.close){
					socket.close()
				}
				socket = null
			}
			
			isConnecting = false
			
			if (ev.code !== 1000) {
				const delay = navigator.onLine ? 2000 : 5000
				reconnectTimeout = setTimeout(() => connectWebSocket(1000), delay)
			}
		}

		socket.onerror = (error) => {
			loggerWss.error("WebSocket error:", error)

			if (heartbeatInterval) { 
				clearInterval(heartbeatInterval)
				heartbeatInterval = null 
			}
			if (connectionTimeout) {
				clearTimeout(connectionTimeout)
				connectionTimeout = null
			}
			if (wss){
				if (wss === socket) {
					if (wss.close){
						wss.close()
					}
					wss = null
				}
			}
			if (socket){
				if (socket.close){
					socket.close()
				}
				socket = null
			}
			
			isConnecting = false
		}

		wss = socket
	}

	connectWebSocket(0)

	const messages = document.getElementById("chat-content")
	const messageButton = document.getElementById("send-chatmessage")
	const messageInput = document.getElementById("input-chatmessage")

	document.body.addEventListener('click', () => {
		if (hasUnreadMessages) {
			clearNotificationGlow()
		}
	})

	if (messages) {
		let isManualScroll = true
		messages.addEventListener('scroll', () => {
			if (isManualScroll && hasUnreadMessages) {
				clearNotificationGlow()
			}
			
			if (messages.scrollTop === 0 && hasMoreMessages && !isLoadingMessages) {
				loadMoreMessages()
			}
		})
		
		window.scrollMessagesToBottom = () => {
			isManualScroll = false
			messages.scrollTop = messages.scrollHeight
			setTimeout(() => { isManualScroll = true }, 100)
		}
	}
	if (messageInput) {
		messageInput.addEventListener('focus', () => {
			if (hasUnreadMessages) {
				clearNotificationGlow()
			}
		})
		messageInput.addEventListener('input', () => {
			if (hasUnreadMessages) {
				clearNotificationGlow()
			}
		})
	}

	function loadMoreMessages() {
		if (!oldestMessageId || isLoadingMessages || !hasMoreMessages) {
			return
		}
		
		isLoadingMessages = true
		
		if (wss && wss.readyState === WebSocket.OPEN) {
			const data = {
				type: "load_more_messages",
				before_message_id: oldestMessageId
			}
			if (sendSafe(data)) {
				loggerWss.debug(`Loading more messages before ID: ${oldestMessageId}`)
			} else {
				loggerWss.error('loadMoreMessages: failed to request more messages')
			}
		}
	}

	function sendMessage() {
		if (!messageInput) {
			loggerWss.error("something went wrong while sending message: no messageInput")
			return
		}
		const message = messageInput.value.trim()
		if (message) {
			const messageData = {
				type: "send_message",
				message: message,
			}

			if (replyState.isReplying && replyState.replyToId) {
				messageData.reply_to = replyState.replyToId
			}

			if (!sendSafe(messageData)) {
				loggerWss.error('sendMessage: failed to send message')
			}
			waitingForMessage++
			const sentMessage = waitingForMessage
			setTimeout(() => {
				if (waitingForMessage === sentMessage){
					loggerWss.error(`WSS TIMEOUT! waitingForMessage'${waitingForMessage}' sentMessage'${sentMessage}'`)
					if (heartbeatInterval) { 
						clearInterval(heartbeatInterval) 
						heartbeatInterval = null 
					}
					try { 
						wss.terminate() 
					} catch(e) { 
						try { 
							wss.close(3001, 'message_timeout') 
						} catch(e2) {
							loggerWss.warn(`message timeout: could not terminate/close wss. e:${e} e2:${e2}`)
						}
					}
					wss = null
					connectWebSocket(2000)
				}
			}, 3000);
			messageInput.value = ""
			
			if (replyState.isReplying) {
				closeReply()
			}
		}
	}

	function shouldGroupWithPrevious(currentUser, previousElement, hasReply = false, isDeleted = false) {
		if (!previousElement) return false
		const previousUser = previousElement.getAttribute('data-message-user')
		const isCurrentDeleted = currentUser === 'system' || isDeleted
		const isPreviousDeleted = previousElement.style.opacity === '0.5' || previousElement.querySelector('.text-gray-500 em')
		const previousHasReply = previousElement.querySelector('[onclick*="scrollToMessage"]') !== null
		if (isCurrentDeleted || isPreviousDeleted || hasReply || previousHasReply) return false
		return previousUser === currentUser && currentUser !== 'system'
	}

	function shouldGroupWithNext(currentUser, nextElement, hasReply = false, isDeleted = false) {
		if (!nextElement) return false
		const nextUser = nextElement.getAttribute('data-message-user')
		const isCurrentDeleted = currentUser === 'system' || isDeleted
		const isNextDeleted = nextElement.style.opacity === '0.5' || nextElement.querySelector('.text-gray-500 em')
		const nextHasReply = nextElement.querySelector('[onclick*="scrollToMessage"]') !== null
		if (isCurrentDeleted || isNextDeleted || hasReply || nextHasReply) return false
		return nextUser === currentUser && currentUser !== 'system'
	}

	function updateMessageGrouping(messageElement, isFirst, isLast) {
		messageElement.classList.remove('message-first', 'message-middle', 'message-last', 'message-single')
		const messageHeader = messageElement.querySelector('.message-header')
		
		if (isFirst && isLast) {
			messageElement.classList.add('message-single')
			messageElement.style.marginBottom = '12px'
			messageElement.style.borderRadius = '8px'
			if (messageHeader) messageHeader.style.display = 'flex'
		} else if (isFirst) {
			messageElement.classList.add('message-first')
			messageElement.style.marginBottom = '-24px'
			messageElement.style.borderRadius = '8px 8px 4px 4px'
			if (messageHeader) messageHeader.style.display = 'flex'
		} else if (isLast) {
			messageElement.classList.add('message-last')
			messageElement.style.marginBottom = '12px'
			messageElement.style.borderRadius = '4px 4px 8px 8px'
			if (messageHeader) messageHeader.style.display = 'none'
		} else {
			messageElement.classList.add('message-middle')
			messageElement.style.marginBottom = '-24px'
			messageElement.style.borderRadius = '4px'
			if (messageHeader) messageHeader.style.display = 'none'
		}
	}

	function addMessage(data, isHistoryMessage = false, isPagination = false) {
		const messageId = data.id
		const user = data.user
		const text = data.message
		const messageType = data.message_type || "new_message"
		const isDeleted = data.is_deleted || false
		
		if (data.date && data.date > lastMessageDate) {
			lastMessageDate = data.date
		}
		
		const date = new Date(data.date * 1000).toLocaleString()
		const replyTo = data.reply_to || null

		if (messageType === "new_message" && user !== USER && !isDeleted && !isHistoryMessage) {
			if (!isWindowFocused) {
				playNotificationSound()
			}
			showNotificationGlow()
		}

		if (messageType === "new_reaction") {
			const targetMessageId = data.reply_to
			const emoji = data.message
			
			if (!messageReactions.has(targetMessageId)) {
				messageReactions.set(targetMessageId, {})
			}
			
			const reactions = messageReactions.get(targetMessageId)
			
			let userAlreadyReacted = false
			Object.keys(reactions).forEach(existingEmoji => {
				const userIndex = reactions[existingEmoji].users.indexOf(user)
				if (userIndex > -1) {
					reactions[existingEmoji].users.splice(userIndex, 1)
					reactions[existingEmoji].count--
					if (reactions[existingEmoji].count === 0) {
						delete reactions[existingEmoji]
					}
					if (existingEmoji === emoji) {
						userAlreadyReacted = true
					}
				}
			})
			
			if (!userAlreadyReacted) {
				if (!reactions[emoji]) {
					reactions[emoji] = { users: [], count: 0 }
				}
				reactions[emoji].users.push(user)
				reactions[emoji].count++
			}
			
			updateMessageReactions(targetMessageId)
			return
		}

		const messageDiv = document.createElement("div")
		const userColor = getUserColor(user)
		messageDiv.className = "p-3 bg-dark-hover rounded-md border-l-4 message-container"
		messageDiv.style.borderLeftColor = userColor
		messageDiv.setAttribute('data-message-id', messageId)
		messageDiv.setAttribute('data-message-user', user)
		
		let replyContent = ''
		if (replyTo) {
			if (replyTo.is_deleted) {
				replyContent = `
					<div class="mb-2 p-2 bg-gray-700 rounded border-l-2 border-gray-500 text-xs" 
						 title="Original message was deleted">
						<div class="text-gray-400">Replying to <span class="text-[${getUserColor(replyTo.user)}] font-semibold">${replyTo.user}</span></div>
						<div class="text-gray-500 mt-1"><em>Original message was deleted</em></div>
					</div>
				`
			} else {
				let reply_txt = ""
				if (replyTo.message.length > 25){
					reply_txt = `${replyTo.message.substring(0, 25)}...`
				} else {
					reply_txt = replyTo.message
				}
				replyContent = `
					<div class="mb-2 p-2 bg-gray-700 rounded border-l-2 border-gray-500 text-xs cursor-pointer hover:bg-gray-600 transition-colors duration-200" 
						 onclick="scrollToMessage(${replyTo.id})" 
						 title="Click to scroll to original message">
						<div class="text-gray-400">Replying to <span class="text-[${getUserColor(replyTo.user)}] font-semibold">${replyTo.user}</span></div>
						<div class="text-gray-300 mt-1">${reply_txt}</div>
					</div>
				`
			}
		}

		const processedContent = window.processMessageContent ? window.processMessageContent(text) : text
		
		messageDiv.innerHTML = `
			${replyContent}
			<div class="message-header flex justify-between items-start mb-2">
				<span class="font-semibold ${user === "system" ? "text-admin" : ""} text-sm break-words" style="${user !== "system" ? `color: ${userColor}` : ""}">${user}</span>
				<div class="message-actions flex items-center gap-2 text-xs text-gray-500 ml-2 flex-shrink-0">
					<span class="message-date">${date}</span>
					${user !== "system" && messageId ?
						`<button class="reply-btn hover:text-[${getUserColor(user)}] transition-colors duration-200" title="Reply">
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-reply" viewBox="0 0 16 16">
								<path d="M6.598 5.013a.144.144 0 0 1 .202.134V6.3a.5.5 0 0 0 .5.5c.667 0 2.013.005 3.3.822.984.624 1.99 1.76 2.595 3.876-1.02-.983-2.185-1.516-3.205-1.799a8.7 8.7 0 0 0-1.921-.306 7 7 0 0 0-.798.008h-.013l-.005.001h-.001L7.3 9.9l-.05-.498a.5.5 0 0 0-.45.498v1.153c0 .108-.11.176-.202.134L2.614 8.254l-.042-.028a.147.147 0 0 1 0-.252l.042-.028zM7.8 10.386q.103 0 .223.006c.434.02 1.034.086 1.7.271 1.326.368 2.896 1.202 3.94 3.08a.5.5 0 0 0 .933-.305c-.464-3.71-1.886-5.662-3.46-6.66-1.245-.79-2.527-.942-3.336-.971v-.66a1.144 1.144 0 0 0-1.767-.96l-3.994 2.94a1.147 1.147 0 0 0 0 1.946l3.994 2.94a1.144 1.144 0 0 0 1.767-.96z"/>
							</svg>
						</button>`
					: ''}
				</div>
			</div>
			<div class="flex flex-wrap items-end gap-2">
				<div class="text-gray-300 text-sm break-words flex-1 min-w-0">${processedContent}</div>
				${user !== "system" && messageId ?
					`<button class="reaction-add-btn hover:text-[${getUserColor(user)}] transition-colors duration-200 opacity-70 hover:opacity-100 flex-shrink-0 self-end" title="Add reaction">
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
							<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
							<path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.5 3.5 0 0 0 8 11.5a3.5 3.5 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.5 4.5 0 0 1 8 12.5a4.5 4.5 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683M7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5m4 0c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S9.448 5 10 5s1 .672 1 1.5"/>
						</svg>
					</button>`
				: ''}
			</div>
			${user !== "system" && messageId ?
				`<div class="message-reactions-area mt-2"></div>`
			: ''}
		`

		if (messageId) {
			messagesById.set(messageId, messageDiv)
		}

		if (user !== "system" && messageId) {
			let reply_txt = ""
			if (text.length > 25){
				reply_txt = `${text.substring(0, 25)}...`
			} else {
				reply_txt = text
			}

			// register handlers so they can be removed later
			const handlers = {}

			handlers.dblclick = () => {
				const isDeleted = messageDiv.style.opacity === '0.5' && messageDiv.style.filter === 'grayscale(100%)'
				if (!isDeleted) {
					setReplyMode(messageId, user, reply_txt, messageDiv)
				}
			}
			messageDiv.addEventListener('dblclick', handlers.dblclick)

			handlers.contextmenu = (e) => {
				e.preventDefault()
				showMessageContextMenu(e, messageId, user, reply_txt, messageDiv)
			}
			messageDiv.addEventListener('contextmenu', handlers.contextmenu)

			const replyBtn = messageDiv.querySelector('.reply-btn')
			if (replyBtn) {
				handlers.replyClick = () => setReplyMode(messageId, user, reply_txt, messageDiv)
				replyBtn.addEventListener('click', handlers.replyClick)
			}

			const reactionBtn = messageDiv.querySelector('.reaction-add-btn')
			if (reactionBtn) {
				handlers.reactionClick = (e) => {
					e.stopPropagation()
					showReactionModal(reactionBtn, messageId)
				}
				reactionBtn.addEventListener('click', handlers.reactionClick)
			}

			messageHandlers.set(messageId, { element: messageDiv, handlers })
		}

		if (isPagination) {
			if (messages) {
				messages.insertBefore(messageDiv, messages.firstChild)
				
				const nextSibling = messageDiv.nextElementSibling
				const hasReply = replyTo !== null
				const isGroupedWithNext = shouldGroupWithNext(user, nextSibling, hasReply, isDeleted)
				const isFirst = true
				
				updateMessageGrouping(messageDiv, isFirst, !isGroupedWithNext)
				
				if (isGroupedWithNext) {
					const nextHasReply = nextSibling.querySelector('[onclick*="scrollToMessage"]') !== null
					const nextIsDeleted = nextSibling.style.opacity === '0.5' || nextSibling.querySelector('.text-gray-500 em')
					const isNextFirst = !shouldGroupWithNext(nextSibling.getAttribute('data-message-user'), nextSibling.nextElementSibling, nextHasReply, nextIsDeleted)
					updateMessageGrouping(nextSibling, false, isNextFirst)
				}
			}
		} else {
			if (messages) {
				const previousSibling = messages.lastElementChild
				const hasReply = replyTo !== null
				const isGroupedWithPrevious = shouldGroupWithPrevious(user, previousSibling, hasReply, isDeleted)
				
				messages.appendChild(messageDiv)
				
				const isLast = true
				updateMessageGrouping(messageDiv, !isGroupedWithPrevious, isLast)
				
				if (isGroupedWithPrevious) {
					const previousHasReply = previousSibling.querySelector('[onclick*="scrollToMessage"]') !== null
					const previousIsDeleted = previousSibling.style.opacity === '0.5' || previousSibling.querySelector('.text-gray-500 em')
					const isPreviousLast = !shouldGroupWithPrevious(previousSibling.getAttribute('data-message-user'), previousSibling.previousElementSibling, previousHasReply, previousIsDeleted)
					updateMessageGrouping(previousSibling, isPreviousLast, false)
				}
			}
		}
		
		// deleted styling
		if (isDeleted) {
			messageDiv.style.opacity = '0.5'
			messageDiv.style.filter = 'grayscale(100%)'
			
			const messageContent = messageDiv.querySelector('.text-gray-300.text-sm.break-words')
			if (messageContent) {
				messageContent.innerHTML = '<em class="text-gray-500">This message was deleted</em>'
			}
			
			const replyBtn = messageDiv.querySelector('.reply-btn')
			if (replyBtn) {
				replyBtn.remove()
			}
			
			const actionsContainer = messageDiv.querySelector('.flex.justify-end.gap-2')
			if (actionsContainer) {
				actionsContainer.remove()
			}
		}
		
		if (!isPagination) {
			if (window.scrollMessagesToBottom) {
				window.scrollMessagesToBottom()
			} else if (messages) {
				messages.scrollTop = messages.scrollHeight
			}
		}
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
	let lastVLCData = null
	
	async function getDetailedWatcherInfo() {
		try {
			const vlcStatus = await window.electronAPI.getVLCStatus()
			return {
				current_time: vlcStatus.current_time || 0,
				is_playing: vlcStatus.isPlaying || false,
				is_uptodate: vlcStatus.is_uptodate || false
			}
		} catch (error) {
			loggerWss.warn('Failed to get detailed watcher info:', error)
			return {
				current_time: 0,
				is_playing: false,
				is_uptodate: false
			}
		}
	}
	
	window.electronAPI.onVLCstatus(async (data) => {
		const isWatching = data.status === 'playing' || data.status === 'paused'
		const isClosed = data.status === 'closed' || data.status === 'error' || data.status === 'stopped'
		
		lastVLCData = data
		// loggerWss.debug('VLC status received:', data)
		
		if (isClosed && isCurrentlyWatching) {
			isCurrentlyWatching = false
			sendWatcherUpdate(false)
			loggerWss.info('VLC closed, removing from watchers')
		} else if (isWatching !== isCurrentlyWatching) {
			isCurrentlyWatching = isWatching
			loggerWss.info('Watcher status changed to:', isWatching)
			
			if (isWatching) {
				const detailedInfo = await getDetailedWatcherInfo()
				sendWatcherUpdate(
					true, 
					'', 
					detailedInfo.current_time,
					data.isPlaying || false,
					detailedInfo.is_uptodate
				)
				loggerWss.info('Sent watcher update - watching:', detailedInfo)
			} else {
				sendWatcherUpdate(false)
				loggerWss.info('Sent watcher update - not watching')
			}
		} else if (isWatching) {
			const detailedInfo = await getDetailedWatcherInfo()
			sendWatcherUpdate(
				true, 
				'', 
				detailedInfo.current_time,
				data.isPlaying || false,
				detailedInfo.is_uptodate
			)
		}
	})

	const playVideoButton = document.getElementById('play-thevideo')
	if (playVideoButton) {
		playVideoButton.addEventListener('click', async () => {
			setTimeout(async () => {
				const detailedInfo = await getDetailedWatcherInfo()
				sendWatcherUpdate(
					true, 
					'', 
					detailedInfo.current_time,
					detailedInfo.is_playing,
					detailedInfo.is_uptodate
				)
			}, 2000)
		})
	}

	window.scrollToMessage = scrollToMessage
	window.sendWatcherUpdate = sendWatcherUpdate
	
	let watcherUpdateInterval = setInterval(async () => {
		if (isCurrentlyWatching && lastVLCData && lastVLCData.status !== 'closed' && lastVLCData.status !== 'error' && lastVLCData.status !== 'stopped') {
			const detailedInfo = await getDetailedWatcherInfo()
			sendWatcherUpdate(
				true, 
				'', 
				detailedInfo.current_time,
				lastVLCData.isPlaying || false,
				detailedInfo.is_uptodate
			)
		}
	}, 2000)
	
	window.addEventListener('online', () => {
		loggerWss.info('Device back online')
		if (!wss || wss.readyState !== WebSocket.OPEN) {
			reconnectAttempts = Math.max(0, reconnectAttempts - 2)
			connectWebSocket(500)
		}
	})

	window.addEventListener('offline', () => {
		loggerWss.warn('Device went offline - force closing connection')
		chatStatus("offline")
		
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval)
			heartbeatInterval = null
		}
		
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout)
			reconnectTimeout = null
		}
		
		if (connectionTimeout) {
			clearTimeout(connectionTimeout)
			connectionTimeout = null
		}
		
		if (wss) {
			try {
				if (wss.terminate) {
					wss.terminate()
				} else {
					wss.close()
				}
			} catch(e) {
				loggerWss.debug('Error force closing:', e)
			}
			wss = null
		}
		
		isConnecting = false
	})

	window.addEventListener('beforeunload', () => {
		if (watcherUpdateInterval) {
			clearInterval(watcherUpdateInterval)
		}
		
		if (heartbeatInterval) {
			clearInterval(heartbeatInterval)
			heartbeatInterval = null
		}
		
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout)
			reconnectTimeout = null
		}
		
		if (connectionTimeout) {
			clearTimeout(connectionTimeout)
			connectionTimeout = null
		}

		try { document.removeEventListener('click', bodyClickHandler) } catch(e){}
		try { document.removeEventListener('keydown', globalKeydownHandler) } catch(e){}
		try { const messagesEl = document.getElementById('chat-content'); if (messagesEl) messagesEl.removeEventListener('scroll', messagesScrollHandler) } catch(e){}

		messageHandlers.forEach((val, id) => {
			const el = val.element
			const h = val.handlers
			try { if (h.dblclick) el.removeEventListener('dblclick', h.dblclick) } catch(e){}
			try { if (h.contextmenu) el.removeEventListener('contextmenu', h.contextmenu) } catch(e){}
			try { const replyBtn = el.querySelector('.reply-btn'); if (replyBtn && h.replyClick) replyBtn.removeEventListener('click', h.replyClick) } catch(e){}
			try { const reactionBtn = el.querySelector('.reaction-add-btn'); if (reactionBtn && h.reactionClick) reactionBtn.removeEventListener('click', h.reactionClick) } catch(e){}
		})
		messageHandlers.clear()

		try {
			if (wss && wss.readyState === WebSocket.OPEN) {
				wss.close(1000, 'page_unload')
			}
		} catch(e){}
		wss = null
		isConnecting = false
	})
})
