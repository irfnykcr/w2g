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

	updateButtonVisibility(false)

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

	const addSubtitleButton = document.querySelector("#add-subtitle")
	const updateSubtitle = document.querySelector("#update-subtitle")
	const subtitleFileInput = document.querySelector("#subtitle-file")

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
		
		updateButtonVisibility(data.connected)
	})

	function updateButtonVisibility(isWatching) {
		// const setVideoContainer = document.querySelector("#set-thevideo")?.parentElement
		const addSubtitleContainer = document.querySelector("#add-subtitle")?.parentElement
		const watchVideoButton = document.getElementById("play-thevideo")
		
		if (isWatching) {
			// if (setVideoContainer) setVideoContainer.style.display = "flex"
			if (addSubtitleContainer) addSubtitleContainer.style.display = "flex"
			if (watchVideoButton) watchVideoButton.style.display = "none"
		} else {
			// if (setVideoContainer) setVideoContainer.style.display = "none"
			if (addSubtitleContainer) addSubtitleContainer.style.display = "none"
			if (watchVideoButton) watchVideoButton.style.display = "block"
		}
	}

	updateSubtitle.addEventListener("click", async ()=>{
		const r = await window.electronAPI.requestSubtitles()
		loggerIndex.info("requested subtitle:", r)
	})

	addSubtitleButton.addEventListener("click", () => {
		subtitleFileInput.click()
	})

	subtitleFileInput.addEventListener("change", async (e) => {
		const file = e.target.files[0]
		if (!file){
			loggerIndex.warn("file not found.")
			return
		}

		try {
			const arrayBuffer = await file.arrayBuffer()
			
			const result = await window.electronAPI.uploadSubtitle(arrayBuffer, file.name)
			
			if (result.success) {
				addAvailableSubtitle(file.name)
				
				addSubtitleButton.innerHTML = '<i class="fas fa-check"></i> Subtitle Added'
				addSubtitleButton.classList.remove('bg-gray-700', 'hover:bg-gray-600')
				addSubtitleButton.classList.add('bg-green-600', 'hover:bg-green-500')
				
				setTimeout(() => {
					addSubtitleButton.innerHTML = '<i class="fas fa-check"></i> Subtitle Available'
					addSubtitleButton.classList.remove('bg-green-600', 'hover:bg-green-500')
					addSubtitleButton.classList.add('bg-blue-600', 'hover:bg-blue-500')
					updateSubtitle.classList.remove("hidden")
					subtitleFileInput.value = ""
				}, 1000)
			} else {
				throw new Error(result.error || 'Failed to upload subtitle')
			}
		} catch (error) {
			loggerIndex.error("Error uploading subtitle:", error)
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
	const mobileHorizontalResizer = document.getElementById("mobile-horizontal-resizer")
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
			
			videoPlayer.addEventListener('error', (e) => {
				loggerIndex.error("Video load error:", e.target.error, "URL:", data.url)
				videoPlayer.style.display = "none"
				
				let errorDiv = document.getElementById('video-error-message')
				if (!errorDiv) {
					errorDiv = document.createElement('div')
					errorDiv.id = 'video-error-message'
					errorDiv.style.cssText = 'padding: 20px; text-align: center; color: #ff6b6b; background: rgba(255,107,107,0.1); border-radius: 8px; margin: 10px;'
					videoPlayer.parentNode.insertBefore(errorDiv, videoPlayer.nextSibling)
				}
				errorDiv.innerHTML = `<strong>Video Load Error</strong><br>This URL is not compatible with inline video mode.<br>Try using VLC mode instead.`
				errorDiv.style.display = "block"
			}, { once: true })
			
			videoPlayer.addEventListener('loadeddata', () => {
				loggerIndex.info("Video loaded successfully:", data.url)
				videoPlayer.style.display = "block"
				const errorDiv = document.getElementById('video-error-message')
				if (errorDiv) errorDiv.style.display = "none"
			}, { once: true })
			
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

		window.electronAPI.onSubtitleReceived((data) => {
			addAvailableSubtitle(data.filename)
		})

		window.electronAPI.onSubtitleStatus((data) => {
			if (addSubtitleButton) {
				if (data.subtitle_exist) {
					addSubtitleButton.innerHTML = '<i class="fas fa-check"></i> Subtitle Available'
					addSubtitleButton.classList.remove('bg-gray-700', 'hover:bg-gray-600')
					addSubtitleButton.classList.add('bg-blue-600', 'hover:bg-blue-500')
					updateSubtitle.classList.remove("hidden")
				} else {
					addSubtitleButton.innerHTML = '<i class="fas fa-closed-captioning"></i> Add Subtitle'
					addSubtitleButton.classList.remove('bg-blue-600', 'hover:bg-blue-500', 'bg-green-600', 'hover:bg-green-500')
					addSubtitleButton.classList.add('bg-gray-700', 'hover:bg-gray-600')
					updateSubtitle.classList.add("hidden")
				}
			}
		})
	}

	let currentUser = null
	let availableSubtitles = []

	window.electronAPI.getUser().then(user => {
		currentUser = user
	}).catch(() => {
		currentUser = null
	})

	function getCurrentSubtitle() {
		return availableSubtitles.length > 0 ? availableSubtitles[0] : null
	}

	function addAvailableSubtitle(filename) {
		if (!availableSubtitles.find(s => s.filename === filename)) {
			availableSubtitles.push({ filename })
		}
	}

	setupInlineVideoSync()

	function startResize(e, type) {
		e.preventDefault()
		if (e.touches && e.touches.length > 1) return
		isResizing = true
		resizeType = type
		document.body.style.cursor = (type === "horizontal" || type === "mobile-horizontal") ? "row-resize" : "col-resize"
		document.body.style.userSelect = "none"
		document.body.style.touchAction = "none"
	}

	function doResize(e) {
		if (!isResizing || !main) return
		
		e.preventDefault()
		
		const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0)
		const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0)
		
		if (resizeType === "horizontal") {
			const rect = leftPanel.getBoundingClientRect()
			const y = clientY - rect.top
			const percent = (y / rect.height) * 100
			
			if (urlSection) urlSection.style.flex = percent
			if (videoSection) videoSection.style.flex = (100 - percent)
		} else if (resizeType === "mobile-horizontal") {
			const rect = main.getBoundingClientRect()
			const y = clientY - rect.top
			const percent = (y / rect.height) * 100
			
			if (leftPanel) leftPanel.style.flex = percent
			if (chatSection) chatSection.style.flex = (100 - percent)
		} else {
			const rect = main.getBoundingClientRect()
			const x = clientX - rect.left
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
		document.body.style.touchAction = ""
	}

	if (horizontalResizer) {
		horizontalResizer.onmousedown = (e) => startResize(e, "horizontal")
		horizontalResizer.ontouchstart = (e) => startResize(e, "horizontal")
	}
	if (verticalResizer) {
		verticalResizer.onmousedown = (e) => startResize(e, "vertical")
		verticalResizer.ontouchstart = (e) => startResize(e, "vertical")
	}
	if (mobileHorizontalResizer) {
		mobileHorizontalResizer.onmousedown = (e) => startResize(e, "mobile-horizontal")
		mobileHorizontalResizer.ontouchstart = (e) => startResize(e, "mobile-horizontal")
	}
	document.onmousemove = doResize
	document.onmouseup = stopResize
	document.ontouchmove = doResize
	document.ontouchend = stopResize

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
			horizontalResizer.style.display = (isUrlExpanded && isVideoExpanded && isInlineMode) ? "block" : "none"
		}
		if (verticalResizer) {
			verticalResizer.style.display = ((isUrlExpanded || (isVideoExpanded && isInlineMode)) && isChatExpanded) ? "block" : "none"
		}
		if (mobileHorizontalResizer) {
			mobileHorizontalResizer.style.display = (isMobile() && ((isUrlExpanded || (isVideoExpanded && isInlineMode)) && isChatExpanded)) ? "block" : "none"
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
