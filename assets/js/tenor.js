const loggerTenor = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[TENOR] [${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[TENOR] [${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[TENOR] [${timestamp}] [ERROR]`, ...args)
	},
	debug: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[TENOR] [${timestamp}] [DEBUG]`, ...args)
	}
}

const TENOR_API_KEY = 'AIzaSyB3JLiSVGwIxz_Wj-zbPNmMD0Uvi-rm2Xc'
const TENOR_API_URL = 'https://tenor.googleapis.com/v2/search'
const TENOR_FEATURED_URL = 'https://tenor.googleapis.com/v2/featured'

let gifSearchTimeout = null
let isLoadingGifs = false
let isGifPickerInitialized = false

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
const gifCache = new Map()

function getCacheKey(type, query = '') {
	return `${type}:${query}`
}

function getCachedData(cacheKey) {
	const cached = gifCache.get(cacheKey)
	if (!cached) return null
	
	const now = Date.now()
	if (now - cached.timestamp > CACHE_DURATION) {
		gifCache.delete(cacheKey)
		return null
	}
	
	return cached.data
}

function setCachedData(cacheKey, data) {
	gifCache.set(cacheKey, {
		data: data,
		timestamp: Date.now()
	})
}

const POPULAR_EMOJIS = [
	'😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🔥',
	'😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '☺️', '😚',
	'🥲', '😋', '🤪', '😝', '🤑', '🤗', '🤭',
	'🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄',
	'😬', '🤥', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢',
	'🤮', '🤧', '🥵', '🥶', '🥴', '🤯', '🤠', '🥳', '🥸',
	'😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️','😯',
	'😳', '🥺', '😧', '😥', '😢', '😭', '😱',
	'😣', '😞', '😓', '😫', '🥱', '😤', '😡',
	'🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👻',
	'👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽',
	'🙀', '😿', '😾', '❤️', '💛', '💚', '🤍',
	'🖤', '🤎', '💔', '💞', '💓', '💗','✅', '❌',
	'👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
	'🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '👋',
	'✋', '👏', '🤝', '🙏', '✍️', '💪', '🦵',
	'🦶', '🧠', '👀'
]

// the gif picker system
function initializeGifPicker() {
	if (isGifPickerInitialized) return
	
	const gifPickerBtn = document.getElementById('gif-picker-btn')
	const modal = document.getElementById('gif-picker-modal')
	
	if (!gifPickerBtn || !modal) {
		console.warn('[TENOR] GIF picker elements not found')
		return
	}
	setupGifPickerEventListeners()
	isGifPickerInitialized = true
	loggerTenor.info('[TENOR] GIF picker initialized')
}

// event listeners
function setupGifPickerEventListeners() {
	const gifPickerBtn = document.getElementById('gif-picker-btn')
	const modal = document.getElementById('gif-picker-modal')
	const closeBtn = document.getElementById('close-gif-picker')
	const gifTab = document.getElementById('gif-tab')
	const emojiTab = document.getElementById('emoji-tab')
	const searchInput = document.getElementById('gif-search')

	// open modal
	gifPickerBtn?.addEventListener('click', handleGifPickerOpen)

	// close modal
	closeBtn?.addEventListener('click', hideGifModal)
	
	// close on outside click
	document.addEventListener('click', handleOutsideClick)

	// tabs
	gifTab?.addEventListener('click', () => switchToTab('gif'))
	emojiTab?.addEventListener('click', () => switchToTab('emoji'))

	// debounce search
	searchInput?.addEventListener('input', handleSearchInput)

	// esc key
	document.addEventListener('keydown', handleKeyDown)
	
	window.addEventListener('resize', handleWindowResize)
}

function handleWindowResize() {
	const modal = document.getElementById('gif-picker-modal')
	const button = document.getElementById('gif-picker-btn')
	
	if (modal && !modal.classList.contains('hidden') && button) {
		positionModalAboveButton(modal, button)
	}
}

function handleGifPickerOpen(e) {
	e.preventDefault()
	const modal = document.getElementById('gif-picker-modal')
	if (!modal?.classList.contains('hidden')) {
		hideGifModal()
		return
	}

	showGifModal()
	loadFeaturedGifs()
	populateEmojis()
	
	setTimeout(() => {
		const searchInput = document.getElementById('gif-search')
		searchInput?.focus()
	}, 100)
}

function showGifModal() {
	const modal = document.getElementById('gif-picker-modal')
	const button = document.getElementById('gif-picker-btn')
	
	if (!modal || !button) return

	const modalSearchInputEl = modal.querySelector('#gif-search')
	modalSearchInputEl.value = ""

	modal.classList.remove('hidden')
	positionModalAboveButton(modal, button)
}

function positionModalAboveButton(modal, button) {
	const buttonRect = button.getBoundingClientRect()
	const modalDialog = modal.querySelector('div')
	
	if (!modalDialog) return

	modalDialog.style.position = 'fixed'
	modalDialog.style.transform = 'none'
	modalDialog.style.margin = '0'
	modalDialog.style.zIndex = '9999'
	
	const isMobile = window.innerWidth < 640
	const isTablet = window.innerWidth < 1024
	
	let modalWidth, modalHeight
	
	if (isMobile) {
		modalWidth = Math.min(window.innerWidth - 20, 350)
		modalHeight = Math.min(window.innerHeight - 40, 300)
	} else if (isTablet) {
		modalWidth = 400
		modalHeight = 350
	} else {
		modalWidth = 450
		modalHeight = 400
	}
	
	let top = buttonRect.top - modalHeight - 15
	let left = buttonRect.left - (modalWidth / 2) + (buttonRect.width / 2)
	
	const minLeft = 10
	const maxLeft = window.innerWidth - modalWidth - 10
	
	if (left < minLeft) left = minLeft
	if (left > maxLeft) left = maxLeft
	
	if (top < 10) {
		top = buttonRect.bottom + 15
		if (top + modalHeight > window.innerHeight - 10) {
			top = (window.innerHeight - modalHeight) / 2
		}
	}
	
	modalDialog.style.top = `${top}px`
	modalDialog.style.left = `${left}px`
	modalDialog.style.width = `${modalWidth}px`
	modalDialog.style.height = `${modalHeight}px`
	modalDialog.style.maxWidth = 'none'
	modalDialog.style.maxHeight = 'none'

}

function hideGifModal() {
	const modal = document.getElementById('gif-picker-modal')
	modal?.classList.add('hidden')
}

function handleOutsideClick(e) {
	const modal = document.getElementById('gif-picker-modal')
	const modalDialog = modal?.querySelector('div')
	
	if (!modal || modal.classList.contains('hidden')) return
	
	if (modalDialog && !modalDialog.contains(e.target) && !e.target.closest('#gif-picker-btn')) {
		hideGifModal()
	}
}

function handleKeyDown(e) {
	const modal = document.getElementById('gif-picker-modal')
	if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
		hideGifModal()
	}
}

function switchToTab(tabType) {
	const gifTab = document.getElementById('gif-tab')
	const emojiTab = document.getElementById('emoji-tab')
	const gifSearchDiv = document.getElementById('gif-searchdiv')
	const gifContent = document.getElementById('gif-content')
	const emojiContent = document.getElementById('emoji-content')

	if (tabType === 'gif') {
		// style gif tab as active
		gifTab?.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'text-white')
		gifTab?.classList.add('bg-turkuazz', 'text-dark-bg')
		
		// style emoji tab as inactive
		emojiTab?.classList.remove('bg-turkuazz', 'text-dark-bg')
		emojiTab?.classList.add('bg-gray-700', 'hover:bg-gray-600', 'text-white')

		// show/hide content
		gifContent?.classList.remove('hidden')
		gifSearchDiv?.classList.remove('hidden')
		emojiContent?.classList.add('hidden')
	} else {
		// style emoji tab as active
		emojiTab?.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'text-white')
		emojiTab?.classList.add('bg-turkuazz', 'text-dark-bg')
		
		// style gif tab as inactive
		gifTab?.classList.remove('bg-turkuazz', 'text-dark-bg')
		gifTab?.classList.add('bg-gray-700', 'hover:bg-gray-600', 'text-white')

		// show/hide content
		emojiContent?.classList.remove('hidden')
		gifSearchDiv?.classList.add('hidden')
		gifContent?.classList.add('hidden')
	}
}

// debounce search
function handleSearchInput(e) {
	clearTimeout(gifSearchTimeout)
	gifSearchTimeout = setTimeout(() => {
		const query = e.target.value.trim()
		if (query) {
			searchGifs(query)
		} else {
			loadFeaturedGifs()
		}
	}, 300)
}

// load gifs from tenor
async function loadFeaturedGifs() {
	if (isLoadingGifs) return
	isLoadingGifs = true

	try {
		const cacheKey = getCacheKey('featured')
		const cachedData = getCachedData(cacheKey)
		
		if (cachedData) {
			loggerTenor.debug('[TENOR] Using cached featured GIFs:', cachedData.length)
			displayGifs(cachedData)
			isLoadingGifs = false
			return
		}
		
		showGifLoading('Loading featured GIFs...')
		
		const response = await fetch(`${TENOR_FEATURED_URL}?key=${TENOR_API_KEY}&limit=20&media_filter=gif`)
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
		
		const data = await response.json()
		const results = data.results || []
		
		// cache results
		setCachedData(cacheKey, results)
		
		displayGifs(results)
		loggerTenor.info('[TENOR] Loaded featured GIFs:', results.length)
	} catch (error) {
		console.error('[TENOR] Error loading featured GIFs:', error)
		showGifError('Failed to load GIFs. Please try again.')
	} finally {
		isLoadingGifs = false
	}
}

// search gifs with query
async function searchGifs(query) {
	if (isLoadingGifs) return
	isLoadingGifs = true

	try {
		const cacheKey = getCacheKey('search', query.toLowerCase())
		const cachedData = getCachedData(cacheKey)
		
		if (cachedData) {
			loggerTenor.debug(`[TENOR] Using cached search results for "${query}":`, cachedData.length)
			displayGifs(cachedData)
			isLoadingGifs = false
			return
		}
		
		showGifLoading(`Searching for "${query}"...`)
		
		const response = await fetch(`${TENOR_API_URL}?key=${TENOR_API_KEY}&q=${encodeURIComponent(query)}&limit=20&media_filter=gif`)
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
		
		const data = await response.json()
		const results = data.results || []
		
		// cache search results
		setCachedData(cacheKey, results)
		
		displayGifs(results)
		loggerTenor.info(`[TENOR] Search results for "${query}":`, results.length)
	} catch (error) {
		console.error('[TENOR] Error searching GIFs:', error)
		showGifError('Search failed. Please try again.')
	} finally {
		isLoadingGifs = false
	}
}

// show loading
function showGifLoading(message) {
	const gifGrid = document.getElementById('gif-grid')
	const gifLoading = document.getElementById('gif-loading')
	
	gifGrid?.classList.add('hidden')
	gifLoading?.classList.remove('hidden')
	if (gifLoading) {
		gifLoading.textContent = message
		gifLoading.classList.remove('text-red-400')
		gifLoading.classList.add('text-gray-400')
	}
}

// show error
function showGifError(message) {
	const gifLoading = document.getElementById('gif-loading')
	if (gifLoading) {
		gifLoading.textContent = message
		gifLoading.classList.remove('text-gray-400')
		gifLoading.classList.add('text-red-400')
	}
}

// display gifs in the grid
function displayGifs(gifs) {
	const gifGrid = document.getElementById('gif-grid')
	const gifLoading = document.getElementById('gif-loading')

	if (!gifGrid) return

	gifGrid.innerHTML = ''

	if (!gifs || gifs.length === 0) {
		showGifError('No GIFs found')
		return
	}

	gifs.forEach(gif => {
		const previewUrl = gif.media_formats?.tinygif?.url || 
		                   gif.media_formats?.nanogif?.url || 
		                   gif.media_formats?.gif?.url

		const fullGifUrl = gif.media_formats?.gif?.url ||
		                   gif.media_formats?.mediumgif?.url ||
		                   gif.media_formats?.tinygif?.url

		if (!previewUrl || !fullGifUrl) {
			console.warn('[TENOR] No valid URLs found for GIF:', gif.id)
			return
		}

		const gifElement = createGifElement(previewUrl, fullGifUrl, gif.content_description || 'GIF')
		gifGrid.appendChild(gifElement)
	})

	gifLoading?.classList.add('hidden')
	gifGrid?.classList.remove('hidden')
}

function createGifElement(previewUrl, fullUrl, description) {
	const gifElement = document.createElement('div')
	gifElement.className = 'relative cursor-pointer rounded-lg overflow-hidden hover:scale-105 hover:shadow-lg transform transition-all duration-200 bg-gray-800 border border-gray-600'
	
	gifElement.innerHTML = `
		<img 
			src="${previewUrl}" 
			alt="${description}" 
			class="w-full h-full object-contain transition-opacity duration-200"
			loading="lazy"
			onload="this.style.opacity='1'"
			onerror="this.parentElement.style.display='none'"
			style="opacity: 0; width: 100%; height: 100%; min-height: 80px; max-height: 180px; border-radius: 2px;"
		/>
		<div class="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
			<div class="text-white text-xs opacity-0 hover:opacity-100 transition-opacity duration-200 bg-black bg-opacity-75 px-2 py-1 rounded">
				Click to send
			</div>
		</div>
	`

	gifElement.addEventListener('click', () => selectGif(fullUrl))
	return gifElement
}

function populateEmojis() {
	const emojiGrid = document.getElementById('emoji-grid')
	if (!emojiGrid || emojiGrid.children.length > 0) return

	POPULAR_EMOJIS.forEach(emoji => {
		const emojiElement = document.createElement('button')
		emojiElement.className = 'text-2xl p-3 rounded-lg hover:bg-gray-600 hover:scale-110 transform transition-all duration-200 flex items-center justify-center'
		emojiElement.textContent = emoji
		emojiElement.title = emoji
		emojiElement.addEventListener('click', () => selectEmoji(emoji))
		emojiGrid.appendChild(emojiElement)
	})
}

function selectGif(gifUrl) {
	// send the gif url as a message
	const sendBtn = document.getElementById('send-chatmessage')
	const messageInput = document.getElementById('input-chatmessage')
	if (messageInput && sendBtn) {
		messageInput.value = gifUrl
		sendBtn.click()
	}

	hideGifModal()
	loggerTenor.debug('[TENOR] GIF sent:', gifUrl)
}

function selectEmoji(emoji) {
	const messageInput = document.getElementById('input-chatmessage')
	if (messageInput) {
		const currentValue = messageInput.value
		messageInput.value = currentValue + emoji
		messageInput.focus()
		
		messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length)
	}

	loggerTenor.debug('[TENOR] Emoji selected:', emoji)
}

// process message to render media
function processMessageContent(text) {
	const tenorRegex = /(https?:\/\/(?:media\d*\.)?tenor\.com\/[^\s]+\.gif|https?:\/\/tenor\.com\/(?:view\/)?([a-zA-Z0-9]+)(?:\.gif)?)/gi
	
	const gifRegex = /(https?:\/\/[^\s]+\.gif(?:\?[^\s]*)?)/gi
	
	let processedText = text
	if (tenorRegex.test(text)) {
		processedText = processedText.replace(tenorRegex, (match) => {
			return `
				<div class="mt-3 mb-2">
					<img 
						src="${match}" 
						alt="GIF" 
						class="max-w-full h-auto rounded-lg shadow-lg border border-gray-600"
						style="max-height: 250px; min-height: 100px; opacity: 0; transition: opacity 0.3s ease;"
						loading="lazy"
						onload="this.style.opacity='1'"
						onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
					/>
					<div style="display: none;" class="text-blue-400 underline cursor-pointer hover:text-blue-300">
						<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>
					</div>
				</div>
			`
		})
	}
	
	if (gifRegex.test(processedText) && !tenorRegex.test(text)) {
		processedText = processedText.replace(gifRegex, (match) => {
			return `
				<div class="mt-3 mb-2">
					<img 
						src="${match}" 
						alt="GIF" 
						class="max-w-full h-auto rounded-lg shadow-lg border border-gray-600"
						style="max-height: 250px; min-height: 100px; opacity: 0; transition: opacity 0.3s ease;"
						loading="lazy"
						onload="this.style.opacity='1'"
						onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
					/>
					<div style="display: none;" class="text-blue-400 underline cursor-pointer hover:text-blue-300">
						<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>
					</div>
				</div>
			`
		})
	}
	
	return processedText
}

// cache management functions
function clearCache() {
	gifCache.clear()
	loggerTenor.info('[TENOR] Cache cleared')
}

function getCacheStats() {
	const stats = {
		size: gifCache.size,
		entries: Array.from(gifCache.keys()).map(key => ({
			key: key,
			age: Date.now() - gifCache.get(key).timestamp,
			dataSize: gifCache.get(key).data.length
		}))
	}
	loggerTenor.debug('[TENOR] Cache stats:', stats)
	return stats
}

// periodically clean expired cache entries
function cleanExpiredCache() {
	const now = Date.now()
	let cleanedCount = 0
	
	for (const [key, cached] of gifCache.entries()) {
		if (now - cached.timestamp > CACHE_DURATION) {
			gifCache.delete(key)
			cleanedCount++
		}
	}
	
	if (cleanedCount > 0) {
		loggerTenor.info(`[TENOR] Cleaned ${cleanedCount} expired cache entries`)
	}
}

// clean cache every 10 minutes
setInterval(cleanExpiredCache, 10 * 60 * 1000)

// export functions for global use
window.initializeGifPicker = initializeGifPicker
window.processMessageContent = processMessageContent
window.clearTenorCache = clearCache
window.getTenorCacheStats = getCacheStats
