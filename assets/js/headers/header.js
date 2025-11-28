
tailwind.config = {
	theme: {
		extend: {
			colors: {
				"turkuazz": "#04aa6d",
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
				<div class="flex items-center justify-between select-none">
					<!-- left side -->
					<div class="flex space-x-2 sm:space-x-4">
						<button id="config" class="p-1 bg-dark-card rounded hover:bg-dark-hover">
							<svg width="32px" height="32px" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
								<path d="M262.29,192.31a64,64,0,1,0,57.4,57.4A64.13,64.13,0,0,0,262.29,192.31ZM416.39,256a154.34,154.34,0,0,1-1.53,20.79l45.21,35.46A10.81,10.81,0,0,1,462.52,326l-42.77,74a10.81,10.81,0,0,1-13.14,4.59l-44.9-18.08a16.11,16.11,0,0,0-15.17,1.75A164.48,164.48,0,0,1,325,400.8a15.94,15.94,0,0,0-8.82,12.14l-6.73,47.89A11.08,11.08,0,0,1,298.77,470H213.23a11.11,11.11,0,0,1-10.69-8.87l-6.72-47.82a16.07,16.07,0,0,0-9-12.22,155.3,155.3,0,0,1-21.46-12.57,16,16,0,0,0-15.11-1.71l-44.89,18.07a10.81,10.81,0,0,1-13.14-4.58l-42.77-74a10.8,10.8,0,0,1,2.45-13.75l38.21-30a16.05,16.05,0,0,0,6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16,16,0,0,0-6.07-13.94l-38.19-30A10.81,10.81,0,0,1,49.48,186l42.77-74a10.81,10.81,0,0,1,13.14-4.59l44.9,18.08a16.11,16.11,0,0,0,15.17-1.75A164.48,164.48,0,0,1,187,111.2a15.94,15.94,0,0,0,8.82-12.14l6.73-47.89A11.08,11.08,0,0,1,213.23,42h85.54a11.11,11.11,0,0,1,10.69,8.87l6.72,47.82a16.07,16.07,0,0,0,9,12.22,155.3,155.3,0,0,1,21.46,12.57,16,16,0,0,0,15.11,1.71l44.89-18.07a10.81,10.81,0,0,1,13.14,4.58l42.77,74a10.8,10.8,0,0,1-2.45,13.75l-38.21,30a16.05,16.05,0,0,0-6.05,14.08C416.17,247.67,416.39,251.83,416.39,256Z" style="fill:none;stroke:#000000;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/>
							</svg>
						</button>
					</div>
					<!-- center/logo -->
					<div id="header-logo" class="flex items-center space-x-2 cursor-default">
						<div class="w-6 h-6 sm:w-8 sm:h-8 bg-turkuazz rounded flex items-center justify-center">
							<span class="text-dark-bg font-bold text-xs sm:text-sm">T</span>
						</div>
						<span class="text-turkuazz font-bold text-lg sm:text-xl">TURKUAZZ</span>
					</div>
					<!-- right side -->
					<div class="flex items-center space-x-2 sm:space-x-4">
			`
		if (document.title === "TURKUAZZ W2G") {
			_html += `
					<div class="flex items-center space-x-2 bg-dark-card rounded-lg px-3 py-1">
						<span class="text-xs text-gray-400">Player:</span>
						<label class="flex items-center cursor-pointer">
							<input type="checkbox" id="video-mode-switch" class="sr-only grayscale-100" disabled>
							<div class="relative">
								<div id="video-mode-toggle-button" class="w-10 h-6 bg-gray-600 rounded-full shadow-inner transition-colors grayscale"></div>
								<div class="dot absolute w-4 h-4 bg-gray-400 rounded-full shadow left-0 top-1 transition-transform"></div>
							</div>
							<span class="ml-2 text-xs text-gray-300" id="video-mode-label">VLC</span>
						</label>
					</div>
			`
		}
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

	const configEl = document.querySelector("#config")
	if (configEl){
		configEl.addEventListener("click", async ()=>{
			if (window.showConfigModal) {
				window.showConfigModal()
			}
		})
	}

	// const headerLogoEl = document.querySelector("#header-logo")
	// headerLogoEl.addEventListener("click", async ()=>{
	// 	await window.electronAPI.gotoIndex()
	// })
})
