const loggerIndex = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[INDEX] [${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[INDEX] [${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[INDEX] [${timestamp}] [ERROR]`, ...args)
	},
	debug: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[INDEX] [${timestamp}] [DEBUG]`, ...args)
	}
}

window.electronAPI.onVideoSyncStatus((data) => {
	const toggleButton = document.getElementById("video-mode-toggle-button")
	if (toggleButton) {
		toggleButton.classList.remove("bg-gray-600", "bg-blue-600")
		if (data.connected) {
			toggleButton.classList.add("bg-blue-600")
		} else {
			toggleButton.classList.add("bg-gray-600")
		}
	}
})

document.addEventListener("DOMContentLoaded", () => {
	const videourl = document.querySelector("#urlof-thevideo")
	const setthevideo = document.querySelector("#set-thevideo")
	const playthevideo = document.querySelector("#play-thevideo")
	const videoPlayer = document.querySelector("#video-player")

	playthevideo.addEventListener("click", async () => {
		try {
			if (isInlineMode) {
				await startInlineVideo()
			} else {
				await window.electronAPI.openVLC()
			}
		} catch (error) {
			loggerIndex.error("Error starting video:", error)
		}
	})

	setthevideo.addEventListener("click", async () => {
		const url = videourl.value.trim()
		if (!url) return
		
		try {
			if (isInlineMode) {
				await setInlineVideo(url)
			} else {
				await window.electronAPI.setvideoVLC(url)
			}
		} catch (error) {
			loggerIndex.error("Error setting video:", error)
		}
	})

	const main = document.querySelector("main")
	const leftPanel = document.getElementById("left-panel")
	const urlSection = document.getElementById("url-section")
	const videoSection = document.getElementById("video-section")
	const chatSection = document.getElementById("chat-section")
	const urlToggleButton = document.getElementById("toggle-url-section")
	const videoToggleButton = document.getElementById("toggle-video-section")
	const chatToggleButton = document.getElementById("toggle-chat-section")
	const collapsedToggles = document.getElementById("collapsed-toggles")
	const expandUrlButton = document.getElementById("expand-url")
	const expandVideoButton = document.getElementById("expand-video")
	const expandChatButton = document.getElementById("expand-chat")
	const horizontalResizer = document.getElementById("horizontal-resizer")
	const verticalResizer = document.getElementById("vertical-resizer")
	const toggleWatchersButton = document.getElementById("toggle-watchers")
	const watchersSection = document.getElementById("watchers-section")
	const closeWatchersSectionButton = document.getElementById("close-watchers-section")

	let isUrlExpanded = true
	let isChatExpanded = true
	let isVideoExpanded = false
	let isInlineMode = false
	let isResizing = false
	let resizeType = null
	let inlineVideoInterval = null
	let isInlineWatching = false
	let isWatchersPanelOpen = true

	function isMobile() {
		return window.innerWidth < 850
	}

	const startInlineVideo = async () => {
		if (isInlineWatching) return false
		
		try {
			return await window.electronAPI.startInlineVideo()
		} catch (error) {
			loggerIndex.error("Failed to start inline video:", error)
			return false
		}
	}

	const setInlineVideo = async (url) => {
		try {
			return await window.electronAPI.setInlineVideo(url)
		} catch (error) {
			loggerIndex.error("Failed to set inline video:", error)
			return false
		}
	}

	const stopInlineVideo = async () => {
		isInlineWatching = false
		
		if (inlineVideoInterval) {
			clearInterval(inlineVideoInterval)
			inlineVideoInterval = null
		}
		
		if (videoPlayer) {
			videoPlayer.pause()
			videoPlayer.src = ""
			videoPlayer.load()
		}
		
		await window.electronAPI.stopInlineVideo()
	}

	const setupInlineVideoSync = () => {
		window.electronAPI.onInlineVideoStart((data) => {
			if (!videoPlayer) return
			videoPlayer.src = data.url
			videoPlayer.currentTime = data.time
			if (data.isPlaying) {
				videoPlayer.play()
			} else {
				videoPlayer.pause()
			}
			isInlineWatching = true
		})
		
		window.electronAPI.onInlineVideoSet((data) => {
			if (!videoPlayer) return
			videoPlayer.src = data.url
			videoPlayer.currentTime = 0
		})
		
		window.electronAPI.onInlineVideoStop(() => {
			isInlineWatching = false
			if (inlineVideoInterval) {
				clearInterval(inlineVideoInterval)
				inlineVideoInterval = null
			}
			if (videoPlayer) {
				videoPlayer.pause()
				videoPlayer.src = ""
				videoPlayer.load()
			}
		})
		
		window.electronAPI.onInlineVideoSyncTime((data) => {
			if (!videoPlayer) return
			if (Math.abs(videoPlayer.currentTime - data.time) > 2) {
				videoPlayer.currentTime = data.time
			}
		})
		
		window.electronAPI.onInlineVideoSyncPlaying((data) => {
			if (!videoPlayer) return
			if (data.isPlaying && videoPlayer.paused) {
				videoPlayer.play()
			} else if (!data.isPlaying && !videoPlayer.paused) {
				videoPlayer.pause()
			}
		})
		
		window.electronAPI.onInlineVideoGetStatusSync(() => {
			if (!isInlineWatching || !isInlineMode || !videoPlayer) return
			
			const currentTime = Math.floor(videoPlayer.currentTime || 0)
			const isPlaying = !videoPlayer.paused
			const currentVideo = videoPlayer.src
			
			window.electronAPI.sendInlineVideoStatusSync({
				currentTime,
				isPlaying,
				currentVideo
			})
		})
	}

	setupInlineVideoSync()

	function startResize(e, type) {
		e.preventDefault()
		isResizing = true
		resizeType = type
		document.body.style.cursor = type === "horizontal" ? "row-resize" : "col-resize"
		document.body.style.userSelect = "none"
	}

	function doResize(e) {
		if (!isResizing || !leftPanel) return
		
		if (resizeType === "horizontal") {
			const rect = leftPanel.getBoundingClientRect()
			const y = e.clientY - rect.top
			const percent = (y / rect.height) * 100
			
			if (urlSection) urlSection.style.flex = percent
			if (videoSection) videoSection.style.flex = (100 - percent)
		} else {
			const rect = main.getBoundingClientRect()
			const x = e.clientX - rect.left
			const percent = (x / rect.width) * 100
			
			if (leftPanel) leftPanel.style.flex = percent
			if (chatSection) chatSection.style.flex = (100 - percent)
		}
	}

	function stopResize() {
		isResizing = false
		resizeType = null
		document.body.style.cursor = ""
		document.body.style.userSelect = ""
	}

	if (horizontalResizer) horizontalResizer.onmousedown = (e) => startResize(e, "horizontal")
	if (verticalResizer) verticalResizer.onmousedown = (e) => startResize(e, "vertical")
	document.onmousemove = doResize
	document.onmouseup = stopResize

	function updateLayout() {
		const hasCollapsed = !isUrlExpanded || !isVideoExpanded || !isChatExpanded

		if (hasCollapsed && collapsedToggles) {
			collapsedToggles.classList.remove("hidden")
			if (expandUrlButton) expandUrlButton.classList.toggle("hidden", isUrlExpanded)
			if (expandVideoButton) expandVideoButton.classList.toggle("hidden", isVideoExpanded || !isInlineMode)
			if (expandChatButton) expandChatButton.classList.toggle("hidden", isChatExpanded)
		} else if (collapsedToggles) {
			collapsedToggles.classList.add("hidden")
			if (expandUrlButton) expandUrlButton.classList.add("hidden")
			if (expandVideoButton) expandVideoButton.classList.add("hidden")
			if (expandChatButton) expandChatButton.classList.add("hidden")
		}

		if (isInlineMode) {
			const openLeftSections = [isUrlExpanded, isVideoExpanded].filter(Boolean).length
			const leftPanelVisible = openLeftSections > 0
			
			if (leftPanelVisible && isChatExpanded) {
				if (leftPanel) leftPanel.style.flex = "1"
				if (chatSection) chatSection.style.flex = "1"
			} else if (leftPanelVisible) {
				if (leftPanel) leftPanel.style.flex = "1"
				if (chatSection) chatSection.style.flex = "0"
			} else if (isChatExpanded) {
				if (leftPanel) leftPanel.style.flex = "0"
				if (chatSection) chatSection.style.flex = "1"
			}
		} else {
			if (isUrlExpanded && isChatExpanded) {
				if (leftPanel) leftPanel.style.flex = "1"
				if (chatSection) chatSection.style.flex = "1"
			} else if (isUrlExpanded) {
				if (leftPanel) leftPanel.style.flex = "1"
				if (chatSection) chatSection.style.flex = "0"
			} else if (isChatExpanded) {
				if (leftPanel) leftPanel.style.flex = "0"
				if (chatSection) chatSection.style.flex = "1"
			}
		}

		if (horizontalResizer) {
			horizontalResizer.style.display = (isUrlExpanded && isVideoExpanded && isInlineMode && !isMobile()) ? "block" : "none"
		}
		if (verticalResizer) {
			verticalResizer.style.display = ((isUrlExpanded || (isVideoExpanded && isInlineMode)) && isChatExpanded && !isMobile()) ? "block" : "none"
		}
	}

	if (urlToggleButton) {
		urlToggleButton.addEventListener("click", () => {
			isUrlExpanded = false
			if (urlSection) urlSection.style.display = "none"
			updateLayout()
		})
	}

	if (videoToggleButton) {
		videoToggleButton.addEventListener("click", () => {
			isVideoExpanded = false
			if (videoSection) videoSection.style.display = "none"
			updateLayout()
		})
	}

	if (chatToggleButton) {
		chatToggleButton.addEventListener("click", () => {
			isChatExpanded = false
			if (chatSection) chatSection.style.display = "none"
			updateLayout()
		})
	}

	if (expandUrlButton) {
		expandUrlButton.addEventListener("click", () => {
			isUrlExpanded = true
			if (urlSection) urlSection.style.display = "flex"
			updateLayout()
		})
	}

	if (expandVideoButton) {
		expandVideoButton.addEventListener("click", () => {
			isVideoExpanded = true
			if (videoSection) videoSection.style.display = "flex"
			updateLayout()
		})
	}

	if (expandChatButton) {
		expandChatButton.addEventListener("click", () => {
			isChatExpanded = true
			if (chatSection) chatSection.style.display = "flex"
			updateLayout()
		})
	}

	function toggleWatchersPanel() {
		isWatchersPanelOpen = !isWatchersPanelOpen
		const icon = toggleWatchersButton ? toggleWatchersButton.querySelector('i') : null
		
		if (isWatchersPanelOpen) {
			if (watchersSection) watchersSection.classList.add('open')
			if (icon) icon.className = 'fas fa-chevron-down text-lg'
			if (toggleWatchersButton) toggleWatchersButton.style.display = 'none'
		} else {
			if (watchersSection) watchersSection.classList.remove('open')
			if (icon) icon.className = 'fas fa-chevron-up text-lg'
			if (toggleWatchersButton) toggleWatchersButton.style.display = 'flex'
		}
	}

	if (toggleWatchersButton) {
		toggleWatchersButton.addEventListener("click", toggleWatchersPanel)
	}
	if (closeWatchersSectionButton) {
		closeWatchersSectionButton.addEventListener("click", toggleWatchersPanel)
	}

	if (watchersSection) watchersSection.classList.add('open')
	const initialIcon = toggleWatchersButton ? toggleWatchersButton.querySelector('i') : null
	if (initialIcon) initialIcon.className = 'fas fa-chevron-down text-lg'
	if (toggleWatchersButton) toggleWatchersButton.style.display = 'none'

	const initVideoSyncStatus = () => {
		const toggleButton = document.getElementById("video-mode-toggle-button")
		if (toggleButton) {
			toggleButton.classList.remove("bg-blue-600")
			if (!toggleButton.classList.contains("bg-gray-600")) {
				toggleButton.classList.add("bg-gray-600")
			}
		}
	}

	window.updateVideoMode = async (inlineMode) => {
		isInlineMode = inlineMode
		
		if (inlineMode) {
			await window.electronAPI.stopVLC()
			if (videoPlayer) {
				videoPlayer.pause()
				videoPlayer.src = ""
				videoPlayer.load()
			}
			isVideoExpanded = true
			if (videoSection) {
				videoSection.style.display = "flex"
			}
		} else {
			await stopInlineVideo()
			isVideoExpanded = false
			if (videoSection) {
				videoSection.style.display = "none"
			}
		}
		updateLayout()
	}

	initVideoSyncStatus()
	updateLayout()

	window.addEventListener('resize', updateLayout)
})
