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

	let isUrlExpanded = true
	let isVideoExpanded = false
	let isChatExpanded = true
	let isResizing = false
	let resizeType = null
	let isInlineMode = false
	let inlineVideoInterval = null
	let isInlineWatching = false

	function isMobile() {
		return window.innerWidth < 850
	}

	window.updateVideoMode = async (inlineMode) => {
		isInlineMode = inlineMode
		
		if (inlineMode) {
			await window.electronAPI.stopVLC()
			videoPlayer.pause()
			videoPlayer.src = ""
			videoPlayer.load()
			isVideoExpanded = true
			videoSection.style.display = "flex"
		} else {
			await stopInlineVideo()
			isVideoExpanded = false
			videoSection.style.display = "none"
		}
		updateLayout()
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
		
		videoPlayer.pause()
		videoPlayer.src = ""
		videoPlayer.load()
		
		await window.electronAPI.stopInlineVideo()
	}

	const setupInlineVideoSync = () => {
		window.electronAPI.onInlineVideoStart((data) => {
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
			videoPlayer.src = data.url
			videoPlayer.currentTime = 0
		})
		
		window.electronAPI.onInlineVideoStop(() => {
			isInlineWatching = false
			if (inlineVideoInterval) {
				clearInterval(inlineVideoInterval)
				inlineVideoInterval = null
			}
			videoPlayer.pause()
			videoPlayer.src = ""
			videoPlayer.load()
		})
		
		window.electronAPI.onInlineVideoSyncTime((data) => {
			if (Math.abs(videoPlayer.currentTime - data.time) > 2) {
				videoPlayer.currentTime = data.time
			}
		})
		
		window.electronAPI.onInlineVideoSyncPlaying((data) => {
			if (data.isPlaying && videoPlayer.paused) {
				videoPlayer.play()
			} else if (!data.isPlaying && !videoPlayer.paused) {
				videoPlayer.pause()
			}
		})
		
		window.electronAPI.onInlineVideoGetStatusSync(() => {
			if (!isInlineWatching || !isInlineMode) return
			
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
		if (!isResizing) return
		
		if (resizeType === "horizontal") {
			const rect = leftPanel.getBoundingClientRect()
			const y = e.clientY - rect.top
			const percent = (y / rect.height) * 100
			
			urlSection.style.flex = percent
			videoSection.style.flex = (100 - percent)
		} else {
			const rect = main.getBoundingClientRect()
			const x = e.clientX - rect.left
			const percent = (x / rect.width) * 100
			
			leftPanel.style.flex = percent
			chatSection.style.flex = (100 - percent)
		}
	}

	function stopResize() {
		isResizing = false
		resizeType = null
		document.body.style.cursor = ""
		document.body.style.userSelect = ""
	}

	horizontalResizer.onmousedown = (e) => startResize(e, "horizontal")
	verticalResizer.onmousedown = (e) => startResize(e, "vertical")
	document.onmousemove = doResize
	document.onmouseup = stopResize

	function updateLayout() {
		const hasCollapsed = !isUrlExpanded || !isVideoExpanded || !isChatExpanded

		if (hasCollapsed) {
			collapsedToggles.classList.remove("hidden")
			expandUrlButton.classList.toggle("hidden", isUrlExpanded)
			expandVideoButton.classList.toggle("hidden", isVideoExpanded || !isInlineMode)
			expandChatButton.classList.toggle("hidden", isChatExpanded)
		} else {
			collapsedToggles.classList.add("hidden")
			expandUrlButton.classList.add("hidden")
			expandVideoButton.classList.add("hidden")
			expandChatButton.classList.add("hidden")
		}

		horizontalResizer.style.display = (isUrlExpanded && isVideoExpanded && isInlineMode && !isMobile()) ? "block" : "none"
		verticalResizer.style.display = ((isUrlExpanded || (isVideoExpanded && isInlineMode)) && isChatExpanded && !isMobile()) ? "block" : "none"
	}

	urlToggleButton.addEventListener("click", () => {
		isUrlExpanded = false
		urlSection.style.display = "none"
		updateLayout()
	})

	videoToggleButton.addEventListener("click", () => {
		isVideoExpanded = false
		videoSection.style.display = "none"
		updateLayout()
	})

	chatToggleButton.addEventListener("click", () => {
		isChatExpanded = false
		chatSection.style.display = "none"
		updateLayout()
	})

	expandUrlButton.addEventListener("click", () => {
		isUrlExpanded = true
		urlSection.style.display = "flex"
		updateLayout()
	})

	expandVideoButton.addEventListener("click", () => {
		isVideoExpanded = true
		videoSection.style.display = "flex"
		updateLayout()
	})

	expandChatButton.addEventListener("click", () => {
		isChatExpanded = true
		chatSection.style.display = "flex"
		updateLayout()
	})

	updateLayout()
})
