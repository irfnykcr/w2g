window.electronAPI.onVLCstatus((data) => {
	console.log('VLC Status:', data)
})

window.electronAPI.onServerStatus((data) => {
	console.log('SERVER Status:', data)
})


document.addEventListener("DOMContentLoaded", () => {
	const videourl = document.querySelector("#urlof-thevideo")
	const setthevideo = document.querySelector("#set-thevideo")
	const playthevideo = document.querySelector("#play-thevideo")
	playthevideo.addEventListener("click", async () => {
		await window.electronAPI.openVLC()
	})
	setthevideo.addEventListener("click", async () => {
		const videoUrlValue = videourl.value.trim();
		if (videoUrlValue) {
			await window.electronAPI.setVideoVLC(videoUrlValue)
		} else {
			console.error("Video URL is empty or invalid.")
		}
	})

	// const main = document.querySelector("main")
	const urlSection = document.getElementById("url-section")
	const chatSection = document.getElementById("chat-section")
	const urlToggleButton = document.getElementById("toggle-url-section")
	const chatToggleButton = document.getElementById("toggle-chat-section")
	const urlContent = document.getElementById("url-content")
	const chatContent = document.getElementById("chat-content")
	let isUrlExpanded = true
	let isChatExpanded = true

	function updateLayout() {
		urlToggleButton.innerHTML = isUrlExpanded ? "&times;" : "&#43;"
		chatToggleButton.innerHTML = isChatExpanded ? "&times;" : "&#43;"

		if (isUrlExpanded) {
			urlContent.style.opacity = "1"
			urlContent.style.pointerEvents = "auto"
		} else {
			urlContent.style.opacity = "0"
			urlContent.style.pointerEvents = "none"
		}

		if (isChatExpanded) {
			chatContent.style.opacity = "1"
			chatContent.style.pointerEvents = "auto"
		} else {
			chatContent.style.opacity = "0"
			chatContent.style.pointerEvents = "none"
		}

		urlSection.style.width = ""
		chatSection.style.width = ""
		urlSection.style.marginRight = ""

		if (isUrlExpanded && isChatExpanded) {
			urlSection.style.width = "calc(50% - 12px)"
			chatSection.style.width = "calc(50% - 12px)"
		} else if (isUrlExpanded && !isChatExpanded) {
			urlSection.style.width = "100%"
			chatSection.style.width = "60px"
		} else if (!isUrlExpanded && isChatExpanded) {
			urlSection.style.width = "60px" 
			urlSection.style.marginRight = "auto"
			chatSection.style.width = "100%"
		} else {
			urlSection.style.width = "60px"
			urlSection.style.marginRight = "auto"
			chatSection.style.width = "60px"
		}
	}

	urlToggleButton.addEventListener("click", () => {
		isUrlExpanded = !isUrlExpanded
		updateLayout()
	})
	chatToggleButton.addEventListener("click", () => {
		isChatExpanded = !isChatExpanded
		updateLayout()
	})
	updateLayout()
})
