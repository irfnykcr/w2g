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

const escapeHtml = (str) => {
	if (!str) return ''
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;')
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
	const historySection = document.getElementById("history-section")
	const videoSection = document.getElementById("video-section")
	const chatSection = document.getElementById("chat-section")
	const urlToggleButton = document.getElementById("toggle-url-section")
	const historyToggleButton = document.getElementById("toggle-history-section")
	const videoToggleButton = document.getElementById("toggle-video-section")
	const chatToggleButton = document.getElementById("toggle-chat-section")
	const collapsedToggles = document.getElementById("collapsed-toggles")
	const expandUrlButton = document.getElementById("expand-url")
	const expandVideoButton = document.getElementById("expand-video")
	const expandChatButton = document.getElementById("expand-chat")
	const expandHistoryButton = document.getElementById("expand-history")
	const horizontalResizer = document.getElementById("horizontal-resizer")
	const verticalResizer = document.getElementById("vertical-resizer")
	const mobileHorizontalResizer = document.getElementById("mobile-horizontal-resizer")
	const toggleWatchersButton = document.getElementById("toggle-watchers")
	const watchersSection = document.getElementById("watchers-section")
	const closeWatchersSectionButton = document.getElementById("close-watchers-section")

	let isUrlExpanded = true
	let isHistoryExpanded = false
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

	const fileInfoCache = new Map()

	async function getFileInfo(url) {
		if (fileInfoCache.has(url)) return fileInfoCache.get(url)
		try {
			const urlObj = new URL(url)
			if (urlObj.hostname !== "cdn.turkuazz.vip") return null
			const vid = urlObj.searchParams.get("vid")
			if (!vid) return null
			const resp = await fetch("https://api.turkuazz.vip/v1/info/getfile_name", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ weburl: vid })
			})
			if (resp.ok) {
				const data = await resp.json()
				if (Array.isArray(data) && data.length >= 2) {
					const info = { filename: data[0], uploader_id: data[1] }
					fileInfoCache.set(url, info)
					return info
				}
			}
		} catch (e) {}
		fileInfoCache.set(url, null)
		return null
	}

	const renderHistoryList = async (historyData) => {
		const historyList = document.getElementById("history-list")
		if (!historyList) return

		historyList.innerHTML = ""
		if (!historyData || historyData.length === 0) {
			historyList.innerHTML = '<li class="text-gray-500 text-sm p-3">No video history yet</li>'
			return
		}

		for (const item of historyData) {
			const li = document.createElement("li")
			li.className = "bg-dark-bg hover:bg-dark-hover rounded-md p-3 transition-colors duration-200 flex items-center justify-between"
			li.dataset.historyId = item.id
			const statusClass = item.success ? "text-green-400" : "text-red-400"
			const statusIcon = item.success ? "✓" : "✗"
			let displayText = item.url
			let urlTitle = ""
			const fileInfo = await getFileInfo(item.url)
			if (fileInfo && fileInfo.filename) {
				displayText = fileInfo.filename
				urlTitle = item.url
			}
			const safeDisplayText = escapeHtml(displayText)
			const safeUrlTitle = escapeHtml(urlTitle)
			const safeDate = escapeHtml(item.date)
			const safeUser = escapeHtml(item.user)
			li.innerHTML = `
				<div class="flex-1 min-w-0 select-text">
					<p class="text-sm sm:text-base font-medium text-white truncate" title="${safeDisplayText}">${safeDisplayText}</p>
					${safeUrlTitle ? `<p class="text-xs text-gray-400 mt-1">${safeUrlTitle}</p>` : ""}
					<p class="text-xs text-gray-400 mt-1">${safeDate} | by: ${safeUser} <span class="${statusClass}">${statusIcon}</span></p>
				</div>
				<button class="ml-4 bg-turkuazz text-dark-bg font-bold py-2 px-4 rounded-md hover:bg-opacity-90 transition-colors whitespace-nowrap text-sm sm:text-base history-use-btn">
					>
				</button>
			`
			const useBtn = li.querySelector(".history-use-btn")
			useBtn.addEventListener("click", () => {
				if (videourl) videourl.value = item.url
			})
			historyList.appendChild(li)
		}
	}

	let videoHistoryData = []

	window.handleVideoHistory = (history) => {
		videoHistoryData = history || []
		renderHistoryList(videoHistoryData)
	}

	window.handleVideoHistoryUpdate = (entry) => {
		if (!entry) return
		videoHistoryData.unshift(entry)
		if (videoHistoryData.length > 10) {
			videoHistoryData.pop()
		}
		renderHistoryList(videoHistoryData)
	}

	window.electronAPI.onVideoHistoryUpdateBroadcast((entry) => {
		loggerIndex.info("Received video-history-update-broadcast:", entry)
		if (window.sendVideoHistoryUpdate) {
			loggerIndex.info("Calling sendVideoHistoryUpdate")
			window.sendVideoHistoryUpdate(entry)
		} else {
			loggerIndex.warn("sendVideoHistoryUpdate not available")
		}
	})

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
		const hasCollapsed = !isUrlExpanded || !isHistoryExpanded || !isVideoExpanded || !isChatExpanded

		if (urlSection) urlSection.style.display = isUrlExpanded ? "flex" : "none"
		if (historySection) historySection.style.display = isHistoryExpanded ? "flex" : "none"
		if (videoSection) videoSection.style.display = (isVideoExpanded && isInlineMode) ? "flex" : "none"
		if (chatSection) chatSection.style.display = isChatExpanded ? "flex" : "none"

		if (hasCollapsed && collapsedToggles) {
			collapsedToggles.classList.remove("hidden")
			if (expandUrlButton) expandUrlButton.classList.toggle("hidden", isUrlExpanded)
			if (expandHistoryButton) expandHistoryButton.classList.toggle("hidden", isHistoryExpanded)
			if (expandVideoButton) expandVideoButton.classList.toggle("hidden", isVideoExpanded || !isInlineMode)
			if (expandChatButton) expandChatButton.classList.toggle("hidden", isChatExpanded)
		} else if (collapsedToggles) {
			collapsedToggles.classList.add("hidden")
			if (expandUrlButton) expandUrlButton.classList.add("hidden")
			if (expandHistoryButton) expandHistoryButton.classList.add("hidden")
			if (expandVideoButton) expandVideoButton.classList.add("hidden")
			if (expandChatButton) expandChatButton.classList.add("hidden")
		}

		const openLeftSections = [isUrlExpanded, isHistoryExpanded, (isVideoExpanded && isInlineMode)].filter(Boolean).length
		const leftPanelVisible = openLeftSections > 0
		if (leftPanel) leftPanel.style.display = leftPanelVisible ? "flex" : "none"

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

		const showHorizontalResizer = (isUrlExpanded || isHistoryExpanded) && isVideoExpanded && isInlineMode
		if (horizontalResizer) {
			horizontalResizer.style.display = showHorizontalResizer ? "block" : "none"
		}
		if (verticalResizer) {
			verticalResizer.style.display = (leftPanelVisible && isChatExpanded) ? "block" : "none"
		}
		if (mobileHorizontalResizer) {
			mobileHorizontalResizer.style.display = (isMobile() && leftPanelVisible && isChatExpanded) ? "block" : "none"
		}
	}

	if (urlToggleButton) {
		urlToggleButton.addEventListener("click", () => {
			isUrlExpanded = false
			updateLayout()
		})
	}

	if (historyToggleButton) {
		historyToggleButton.addEventListener("click", () => {
			isHistoryExpanded = false
			updateLayout()
		})
	}

	if (videoToggleButton) {
		videoToggleButton.addEventListener("click", () => {
			isVideoExpanded = false
			updateLayout()
		})
	}

	if (chatToggleButton) {
		chatToggleButton.addEventListener("click", () => {
			isChatExpanded = false
			updateLayout()
		})
	}

	if (expandUrlButton) {
		expandUrlButton.addEventListener("click", () => {
			isUrlExpanded = true
			updateLayout()
		})
	}

	if (expandHistoryButton) {
		expandHistoryButton.addEventListener("click", () => {
			isHistoryExpanded = true
			updateLayout()
		})
	}

	if (expandVideoButton) {
		expandVideoButton.addEventListener("click", () => {
			isVideoExpanded = true
			updateLayout()
		})
	}

	if (expandChatButton) {
		expandChatButton.addEventListener("click", () => {
			isChatExpanded = true
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
