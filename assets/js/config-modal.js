const loggerConfigModal = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[CONFIG-MODAL] [${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[CONFIG-MODAL] [${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[CONFIG-MODAL] [${timestamp}] [ERROR]`, ...args)
	}
}

let isConfigModalInitialized = false

function createConfigModalHTML() {
	return `
		<div id="config-modal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden" style="z-index: 9999;">
			<div class="bg-dark-card p-6 rounded-lg shadow-md w-160 max-w-full max-h-full overflow-y-auto m-4 config-modal-animate">
				<div class="flex justify-between items-center mb-6">
					<h2 class="text-2xl font-bold text-turkuazz">Config</h2>
					<button id="close-config-modal" class="text-gray-400 hover:text-white text-2xl font-bold">
						&times;
					</button>
				</div>
				<div class="mb-6">
					<div class="mb-6">
						<div class="flex items-center space-x-4">
							<label for="modal-vlcport" class="font-semibold text-turkuazz w-32">VLC port</label>
							<input type="number" id="modal-vlcport" name="vlcport" required class="flex-1 p-2 border border-dark-hover rounded-md bg-dark-bg text-white">
						</div>
					</div>
					<div class="mb-6">
						<div class="flex items-center space-x-4">
							<label for="modal-server_endpoint" class="font-semibold text-turkuazz w-32">Server endpoint</label>
							<input type="text" id="modal-server_endpoint" name="server_endpoint" required class="flex-1 p-2 border border-dark-hover rounded-md bg-dark-bg text-white">
						</div>
					</div>
					<div class="mb-6">
						<div class="flex items-center space-x-4">
							<label for="modal-vlc_finder" class="font-semibold text-turkuazz w-32">VLC finder</label>
							<input type="checkbox" id="modal-vlc_finder" name="vlc_finder" class="h-5 w-5 text-turkuazz border-gray-700 rounded focus:ring-turkuazz">
						</div>
					</div>
					<div class="mb-6">
						<div class="flex items-center space-x-4">
							<label for="modal-vlc_path" class="font-semibold text-turkuazz w-32">VLC path</label>
							<input type="text" id="modal-vlc_path" name="vlc_path" required class="flex-1 p-2 border border-dark-hover rounded-md bg-dark-bg text-white">
						</div>
					</div>
					<div class="mb-6">
						<div class="flex items-center space-x-4">
							<label for="modal-vlc_http_pass" class="font-semibold text-turkuazz w-32">VLC http pass</label>
							<input type="text" id="modal-vlc_http_pass" name="vlc_http_pass" required class="flex-1 p-2 border border-dark-hover rounded-md bg-dark-bg text-white">
						</div>
					</div>
					<button id="modal-save-config" type="button" class="w-full p-2 bg-turkuazz text-dark-bg rounded-md hover:bg-dark-turkuazz">Save</button>
				</div>
				<p id="modal-status-text" class="text-center mt-4 hidden"></p>
			</div>
		</div>
	`
}

function initializeConfigModal() {
	if (isConfigModalInitialized) return
	
	const modalHTML = createConfigModalHTML()
	document.body.insertAdjacentHTML('beforeend', modalHTML)
	
	const modal = document.getElementById('config-modal')
	const closeBtn = document.getElementById('close-config-modal')
	const saveBtn = document.getElementById('modal-save-config')
	
	closeBtn.addEventListener('click', hideConfigModal)
	
	modal.addEventListener('click', (e) => {
		if (e.target === modal) {
			hideConfigModal()
		}
	})
	
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
			hideConfigModal()
		}
		if ((e.ctrlKey || e.metaKey) && e.key === ',' && !e.shiftKey) {
			e.preventDefault()
			showConfigModal()
		}
	})
	
	const inputs = modal.querySelectorAll('input')
	inputs.forEach(input => {
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !modal.classList.contains('hidden')) {
				e.preventDefault()
				saveConfigFromModal()
			}
		})
	})
	
	saveBtn.addEventListener('click', saveConfigFromModal)
	
	isConfigModalInitialized = true
	loggerConfigModal.info('Config modal initialized')
}

async function showConfigModal() {
	initializeConfigModal()
	
	try {
		const appConfig = await window.electronAPI.getConfig()
		
		document.getElementById('modal-vlcport').value = appConfig.VLC_PORT
		document.getElementById('modal-server_endpoint').value = appConfig.SERVER_ENDPOINT
		document.getElementById('modal-vlc_finder').checked = appConfig.VLC_FINDER
		document.getElementById('modal-vlc_path').value = appConfig.VLC_PATH
		document.getElementById('modal-vlc_http_pass').value = appConfig.VLC_HTTP_PASS
		
		const modal = document.getElementById('config-modal')
		modal.classList.remove('hidden')
		
		setTimeout(() => {
			const firstInput = document.getElementById('modal-vlcport')
			if (firstInput) firstInput.focus()
		}, 100)
		
		loggerConfigModal.info('Config modal shown')
	} catch (error) {
		loggerConfigModal.error('Failed to load config:', error)
	}
}

function hideConfigModal() {
	const modal = document.getElementById('config-modal')
	if (modal) {
		modal.classList.add('hidden')
		
		const statusText = document.getElementById('modal-status-text')
		if (statusText) {
			statusText.className = 'text-center mt-4 hidden'
		}
		
		loggerConfigModal.info('Config modal hidden')
	}
}

function showModalStatus(message, isSuccess = true) {
	const statusText = document.getElementById('modal-status-text')
	const className = isSuccess ? 'text-center mt-4 bg-dark-turkuazz' : 'text-center mt-4 bg-admin'
	
	statusText.textContent = message
	statusText.className = className
	
	setTimeout(() => {
		if (statusText.className === className) {
			statusText.className = 'text-center mt-4 hidden'
		}
	}, 2000)
}

async function saveConfigFromModal() {
	const vlcPortEl = document.getElementById('modal-vlcport')
	const serverEndpointEl = document.getElementById('modal-server_endpoint')
	const vlcFinderEl = document.getElementById('modal-vlc_finder')
	const vlcPathEl = document.getElementById('modal-vlc_path')
	const vlcHttpPassEl = document.getElementById('modal-vlc_http_pass')
	
	const vlcport = parseInt(vlcPortEl.value, 10) || 0
	const serverendpoint = serverEndpointEl.value.trim()
	const vlcfinder = vlcFinderEl.checked
	const vlcpath = vlcPathEl.value.trim()
	const vlchttppass = vlcHttpPassEl.value.trim()
	
	if (!vlcport || !serverendpoint || !vlcpath || !vlchttppass) {
		showModalStatus('Please fill all required fields correctly.', false)
		return
	}
	
	try {
		const result = await window.electronAPI.saveConfig(vlcport, serverendpoint, vlcfinder, vlcpath, vlchttppass)
		
		if (result) {
			showModalStatus('Config saved successfully!')
			setTimeout(() => {
				hideConfigModal()
			}, 1500)
		} else {
			showModalStatus('Failed to save config.', false)
		}
	} catch (error) {
		loggerConfigModal.error('Error saving config:', error)
		showModalStatus('Error saving config.', false)
	}
}

window.showConfigModal = showConfigModal
window.hideConfigModal = hideConfigModal
