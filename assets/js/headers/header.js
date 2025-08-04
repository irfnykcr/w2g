
(async () => {
	await window.electronAPI.getUser().then((r) => {
		console.log("username:", r)
		localStorage.setItem("user", r)
	})
	await window.electronAPI.getUserPsw().then((r) => {
		console.log("userpsw:", r)
		localStorage.setItem("userpsw", r)
	})
	await window.electronAPI.getRoom().then((r) => {
		console.log("room:", r)
		localStorage.setItem("room", r)
	})
	await window.electronAPI.getRoomPsw().then((r) => {
		console.log("roompsw:", r)
		localStorage.setItem("roompsw", r)
	})
	await window.electronAPI.getServerEndpoint().then((r) => {
		console.log("server_endpoint:", r)
		localStorage.setItem("server_endpoint", r)
	})
})()
tailwind.config = {
	theme: {
		extend: {
			colors: {
				'turkuazz': '#00d4aa',
				'dark-bg': '#1a1a1a',
				'dark-card': '#2a2a2a',
				'dark-hover': '#3a3a3a',
				'admin': '#ff5733'
			}
		}
	}
}
document.addEventListener("DOMContentLoaded", () => {
	const headerEl = document.querySelector("header")
    
	const makeheader = () => {
		if (headerEl) {
			headerEl.innerHTML = `
		<div class="flex items-center justify-between">
			<!-- left side -->
			<div class="flex space-x-4"></div>

			<!-- center/logo -->
			<div class="flex items-center space-x-2">
			    <div class="w-8 h-8 bg-turkuazz rounded flex items-center justify-center">
				    <span class="text-dark-bg font-bold text-sm">T</span>
			    </div>
			    <span class="text-turkuazz font-bold text-xl">TURKUAZZ</span>
			</div>

			<!-- right side -->
			<div class="flex items-center space-x-4"></div>
		</div>
	    `
		}
	}
	makeheader()
})
