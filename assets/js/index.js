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

window.electronAPI.onVLCstatus((data) => {
	logger.debug("VLC Status:", data)
})

window.electronAPI.onServerStatus((data) => {
	logger.debug("SERVER Status:", data)
})

document.addEventListener("DOMContentLoaded", () => {
	const videourl = document.querySelector("#urlof-thevideo")
	const setthevideo = document.querySelector("#set-thevideo")
	const playthevideo = document.querySelector("#play-thevideo")

	playthevideo.addEventListener("click", async () => {
		await window.electronAPI.openVLC()
	})

	setthevideo.addEventListener("click", async () => {
	const videoUrlValue = videourl.value.trim()
	if (videoUrlValue) {
		await window.electronAPI.setVideoVLC(videoUrlValue)
	} else {
		logger.error("Video URL is empty or invalid.")
	}
	})

	const main = document.querySelector("main")
	const urlSection = document.getElementById("url-section")
	const chatSection = document.getElementById("chat-section")
	const urlToggleButton = document.getElementById("toggle-url-section")
	const chatToggleButton = document.getElementById("toggle-chat-section")
	const collapsedToggles = document.getElementById("collapsed-toggles")
	const expandUrlButton = document.getElementById("expand-url")
	const expandChatButton = document.getElementById("expand-chat")

	let isUrlExpanded = true
	let isChatExpanded = true

	function isMobile() {
		return window.innerWidth < 850
	}

	function updateCollapsedToggles() {
		const hasCollapsed = !isUrlExpanded || !isChatExpanded

		if (hasCollapsed) {
			collapsedToggles.classList.remove("hidden")
			collapsedToggles.classList.add("collapsed-toggles-visible")

			if (!isUrlExpanded) {
				expandUrlButton.classList.remove("hidden")
			} else {
				expandUrlButton.classList.add("hidden")
			}

			if (!isChatExpanded) {
				expandChatButton.classList.remove("hidden")
			} else {
				expandChatButton.classList.add("hidden")
			}
		} else {
			collapsedToggles.classList.add("hidden")
			collapsedToggles.classList.remove("collapsed-toggles-visible")
			expandUrlButton.classList.add("hidden")
			expandChatButton.classList.add("hidden")
		}
	}

	function updateSectionVisibility(section, isExpanded) {
		if (isExpanded) {
			section.classList.remove("section-hidden")
			section.style.display = "flex"
		} else {
			section.classList.add("section-hidden")
			setTimeout(() => {
				if (section.classList.contains("section-hidden")) {
					section.style.display = "none"
				}
			}, 300)
		}
	}

	function updateLayout() {

		updateSectionVisibility(urlSection, isUrlExpanded)
		updateSectionVisibility(chatSection, isChatExpanded)

		updateCollapsedToggles()

		main.classList.remove("flex-col", "flex-row")

		if (isMobile()) {
			main.classList.add("flex-col")
		} else {
			main.classList.add("flex-row")
		}

		const hiddenMessage = document.getElementById("hidden-message");

		if (!isUrlExpanded && !isChatExpanded) {
			if (!hiddenMessage) {
				const messageDiv = document.createElement("div");
				messageDiv.id = "hidden-message";
				messageDiv.className = "flex-1 flex items-center justify-center text-gray-400";
				messageDiv.innerHTML = `
				<div class="text-center">
					<div class="text-6xl mb-4">👻</div>
					<p class="text-lg">All sections are hidden</p>
					<p class="text-sm">Use the buttons above to show sections</p>
				</div>
				`;
				main.appendChild(messageDiv);
			}
		} else {
			if (hiddenMessage) {
				hiddenMessage.remove();
			}

			if (isUrlExpanded && !isChatExpanded) {
				urlSection.style.flex = "1";
				chatSection.style.flex = "0";
			} else if (!isUrlExpanded && isChatExpanded) {
				chatSection.style.flex = "1";
				urlSection.style.flex = "0";
			} else {
				urlSection.style.flex = "1";
				chatSection.style.flex = "1";
			}
		}
	}

	urlSection.classList.add("transition-smooth")
	chatSection.classList.add("transition-smooth")
	urlToggleButton.classList.add("toggle-button")
	chatToggleButton.classList.add("toggle-button")
	expandUrlButton.classList.add("expand-button")
	expandChatButton.classList.add("expand-button")

	urlToggleButton.addEventListener("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		isUrlExpanded = false
		updateLayout()
	})

	chatToggleButton.addEventListener("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		isChatExpanded = false
		updateLayout()
	})

	expandUrlButton.addEventListener("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		isUrlExpanded = true
		urlSection.style.display = "flex"
		updateLayout()
	})

	expandChatButton.addEventListener("click", (e) => {
		e.preventDefault()
		e.stopPropagation()
		isChatExpanded = true
		chatSection.style.display = "flex"
		updateLayout()
	})

	let resizeTimeout
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimeout)
		resizeTimeout = setTimeout(updateLayout, 100)
	})

	document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey) {
		if (e.key === "1") {
			e.preventDefault()
			if (isUrlExpanded) {
				isUrlExpanded = false
			} else {
				isUrlExpanded = true
				urlSection.style.display = "flex"
			}
			updateLayout()
		} else if (e.key === "2") {
			e.preventDefault()
			if (isChatExpanded) {
				isChatExpanded = false
			} else {
				isChatExpanded = true
				chatSection.style.display = "flex"
			}
			updateLayout()
		} else if (e.key === "0") {
			e.preventDefault()
			isUrlExpanded = true
			isChatExpanded = true
			urlSection.style.display = "flex"
			chatSection.style.display = "flex"
			updateLayout()
		}
	}
	})

	updateLayout()
})
