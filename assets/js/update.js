document.addEventListener("DOMContentLoaded", ()=>{
	let updateInfo = null
	let isDownloading = false
	let isDownloaded = false

	const elements = {
		versionInfo: document.getElementById('version-info'),
		progressContainer: document.getElementById('progress-container'),
		progressBar: document.getElementById('progress-bar'),
		progressPercent: document.getElementById('progress-percent'),
		progressText: document.getElementById('progress-text'),
		statusMessage: document.getElementById('status-message'),
		buttonGroup: document.getElementById('button-group'),
		downloadBtn: document.getElementById('download-btn'),
		quitBtn: document.getElementById('quit-btn')
	}

	function showStatus(message, type = 'info') {
		elements.statusMessage.textContent = message
		elements.statusMessage.className = `status-message status-${type}`
		elements.statusMessage.classList.remove('hidden')
	}

	function hideStatus() {
		elements.statusMessage.classList.add('hidden')
	}

	function updateProgress(percent, text = '') {
		const safePercent = Math.max(0, Math.min(100, percent || 0))
		elements.progressBar.style.width = `${safePercent}%`
		elements.progressPercent.textContent = `${Math.round(safePercent)}%`
		if (text) {
			elements.progressText.textContent = text
		} else {
			elements.progressText.textContent = `Downloading... ${Math.round(safePercent)}%`
		}
	}

	function showProgress() {
		elements.progressContainer.style.display = 'block'
	}

	function hideProgress() {
		elements.progressContainer.style.display = 'none'
	}

	function setButtonState(downloading = false) {
		if (downloading) {
			elements.downloadBtn.disabled = true
			elements.downloadBtn.textContent = 'Downloading...'
			elements.quitBtn.disabled = true
		} else {
			elements.downloadBtn.disabled = false
			elements.downloadBtn.textContent = 'Download & Install'
			elements.quitBtn.disabled = false
		}
	}

	elements.downloadBtn.addEventListener('click', async () => {
		if (!isDownloading && !isDownloaded) {
			isDownloading = true
			setButtonState(true)
			showProgress()
			hideStatus()
			
			const result = await window.electronAPI.downloadUpdate()
			if (!result) {
				showStatus('Download failed. Please try again.', 'error')
				isDownloading = false
				setButtonState(false)
				hideProgress()
			}
		}
	})

	elements.quitBtn.addEventListener('click', () => {
		window.electronAPI.quitApp()
	})

	window.electronAPI.onUpdateProgress((data) => {
		if (data && typeof data === 'object') {
			const percent = data.percent !== undefined ? data.percent : 0
			const text = data.text || ''
			updateProgress(percent, text)
		}
	})

	window.electronAPI.onUpdateDownloaded(async (data) => {
		isDownloading = false
		isDownloaded = true
		hideProgress()
		showStatus('Update downloaded successfully! Installing...', 'success')
		
		setTimeout(async () => {
			await window.electronAPI.installUpdate()
		}, 1000)
	})

	window.electronAPI.onUpdateError((error) => {
		isDownloading = false
		setButtonState(false)
		hideProgress()
		showStatus(`Update error: ${error}`, 'error')
	})

	async function initialize() {
		try {
			const info = await window.electronAPI.getUpdateInfo()
			if (info && info.version) {
				updateInfo = info
				elements.versionInfo.textContent = `Version ${info.version} is available`
			}
		} catch (error) {
			showStatus('Failed to load update information', 'error')
		}
	}

	initialize()
})