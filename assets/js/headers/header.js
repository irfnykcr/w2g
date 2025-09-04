
tailwind.config = {
	theme: {
		extend: {
			colors: {
				turkuazz: "#04aa6d",
				"dark-turkuazz": "#0e725eff",
				"dark-bg": "#1a1a1a",
				"dark-card": "#2a2a2a",
				"dark-hover": "#3a3a3a",
				admin: "#ff5733",
	  		},
		},
		screens: {
			sm: "850px",
		},
	},
}

document.addEventListener("DOMContentLoaded", () => {
  const headerEl = document.querySelector("header")
 
  const makeheader = () => {
	if (headerEl) {
		_html = `
			<div class="flex items-center justify-between">
				<!-- left side -->
				<div class="flex space-x-2 sm:space-x-4"></div>
				<!-- center/logo -->
				<div class="flex items-center space-x-2">
					<div class="w-6 h-6 sm:w-8 sm:h-8 bg-turkuazz rounded flex items-center justify-center">
						<span class="text-dark-bg font-bold text-xs sm:text-sm">T</span>
					</div>
					<span class="text-turkuazz font-bold text-lg sm:text-xl">TURKUAZZ</span>
				</div>
				<!-- right side -->
				<div class="flex items-center space-x-2 sm:space-x-4">
					<div class="flex items-center space-x-2 bg-dark-card rounded-lg px-3 py-1">
						<span class="text-xs text-gray-400">Player:</span>
						<label class="flex items-center cursor-pointer">
							<input type="checkbox" id="video-mode-switch" class="sr-only">
							<div class="relative">
								<div class="w-10 h-6 bg-gray-600 rounded-full shadow-inner transition-colors"></div>
								<div class="dot absolute w-4 h-4 bg-white rounded-full shadow left-0 top-1 transition-transform"></div>
							</div>
							<span class="ml-2 text-xs text-gray-300" id="video-mode-label">VLC</span>
						</label>
					</div>
					<div class="hidden sm:flex text-xs text-gray-400 space-x-3">
						<span>Ctrl+1: Video</span>
						<span>Ctrl+2: Player</span>
						<span>Ctrl+3: Chat</span>
						<span>Ctrl+0: Show All</span>
					</div>
		`
		if (headerEl.querySelector("#logout") !== null){
			_html += `
				<button id="logout" class="px-4 py-2 bg-dark-turkuazz text-white rounded hover:bg-dark-hover">
					Logout
				</button>
			`
  		}
		if (headerEl.querySelector("#lefttheroom") !== null){
			_html += `
				<button id="lefttheroom" class="px-4 py-2 bg-dark-turkuazz text-white rounded hover:bg-dark-hover">
					Left the Room
				</button>
			`
  		}
		_html += `
				</div>
			</div>
		`
		headerEl.innerHTML = _html
	}
  }
  makeheader()
  const logoutButton = headerEl.querySelector("#logout")
  if (logoutButton){
	logoutButton.addEventListener("click", async ()=>{
		await window.electronAPI.logoutUser()
		await window.electronAPI.gotoLogin()
	})
  }

  const leftButton = headerEl.querySelector("#lefttheroom")
  if (leftButton){
	leftButton.addEventListener("click", async ()=>{
		await window.electronAPI.leftTheRoom()
		await window.electronAPI.gotoRoomJoin()
	})
  }

  const videoModeSwitch = headerEl.querySelector("#video-mode-switch")
  const videoModeLabel = headerEl.querySelector("#video-mode-label")
  if (videoModeSwitch && videoModeLabel) {
	videoModeSwitch.checked = false
	videoModeSwitch.addEventListener("change", async () => {
		const isInlineMode = videoModeSwitch.checked
		videoModeLabel.textContent = isInlineMode ? "Inline" : "VLC"
		
		if (window.updateVideoMode) {
			await window.updateVideoMode(isInlineMode)
		}
	})
  }
})
