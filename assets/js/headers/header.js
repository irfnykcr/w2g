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
