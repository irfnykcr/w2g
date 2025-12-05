const loggerMovieModal = {
	info: (...args) => {
		const timestamp = new Date().toISOString()
		console.log(`[MOVIE-MODAL] [${timestamp}] [INFO]`, ...args)
	},
	warn: (...args) => {
		const timestamp = new Date().toISOString()
		console.warn(`[MOVIE-MODAL] [${timestamp}] [WARN]`, ...args)
	},
	error: (...args) => {
		const timestamp = new Date().toISOString()
		console.error(`[MOVIE-MODAL] [${timestamp}] [ERROR]`, ...args)
	}
}

/**
 * @param {string} html
 * @returns {string|null}
*/
function unpack_packer(html) {
	const scriptMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?while\(c--\).*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([^']*)'\s*\.split\('\|'\)/m)
	if (!scriptMatch) {
		loggerMovieModal.error('unpack_packer: eval block not found')
		loggerMovieModal.info('HTML preview:', html.substring(0, 500))
		return null
	}
	
	const p = scriptMatch[1]
	const a = parseInt(scriptMatch[2])
	const c = parseInt(scriptMatch[3])
	const k = scriptMatch[4].split('|')
	
	let result = p
	let cc = c
	while (cc--) {
		if (k[cc]) {
			const regex = new RegExp('\\b' + cc.toString(a) + '\\b', 'g')
			result = result.replace(regex, k[cc])
		}
	}
	return result
}




// config

const defaultMovieApiConfig = {
	filmmodu: "https://www.filmmodu.biz",
	webteizle: "https://webteizle3.xyz",
	services: {
		pixel: "https://pixeldrain.com/api/file",
		filemoon: "https://ico3c.com/bkg",
		vidmoly: "https://vidmoly.net/embed-",
		dzen: "https://dzen.ru/embed"
	}
}

const isDefaultDomainRedirected = async (domain) => {
	const is_redirected = await fetch(domain, {
		method: 'GET',
		headers: {
			'Accept': 'text/html charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		},
		redirect: 'follow'
	})
	.then(response => {
		let url = response.url
		if (url.endsWith('/') ) {
			url = url.slice(0, -1)
		}
		loggerMovieModal.info('Checked default domain:', domain, 'Redirected:', response.redirected, 'Final URL:', url)
		return [response.redirected, url]
	})
	.catch(error => {
		loggerMovieModal.error('Error checking default domain:', error)
		return false
	})
	return is_redirected
}

let movieApiConfig = JSON.parse(JSON.stringify(defaultMovieApiConfig))
let movieApiInitPromise = null

async function checkAndFixDomains() {
	const filmmodu_check = await isDefaultDomainRedirected(movieApiConfig.filmmodu)
	if (filmmodu_check && filmmodu_check[0]) {
		movieApiConfig.filmmodu = filmmodu_check[1]
		loggerMovieModal.warn('filmmodu domain redirected to:', filmmodu_check[1])
	}
	const webteizle_check = await isDefaultDomainRedirected(movieApiConfig.webteizle)
	if (webteizle_check && webteizle_check[0]) {
		movieApiConfig.webteizle = webteizle_check[1]
		loggerMovieModal.warn('webteizle domain redirected to:', webteizle_check[1])
	}
}

async function loadMovieApiConfig() {
	if (window.electronAPI && window.electronAPI.getMovieApiConfig) {
		const config = await window.electronAPI.getMovieApiConfig()
		if (config && Object.keys(config).length > 0) {
			movieApiConfig = config
		}
	}
}

async function saveMovieApiConfig() {
	if (window.electronAPI && window.electronAPI.saveMovieApiConfig) {
		await window.electronAPI.saveMovieApiConfig(movieApiConfig)
	}
}

async function initMovieApi() {
	await loadMovieApiConfig()
	await checkAndFixDomains()
	loggerMovieModal.info('Movie API initialized')
}

movieApiInitPromise = initMovieApi()

let settingsModalInstance = null

function createSettingsModal() {
	const overlay = document.createElement('div')
	overlay.id = 'movie-settings-modal'
	overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden'
	overlay.style.zIndex = '10000'
	
	overlay.innerHTML = `
		<div class="bg-dark-card p-6 rounded-lg shadow-md w-[500px] max-w-full max-h-[85vh] overflow-y-auto m-4 config-modal-animate">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-turkuazz">Movie API Settings</h2>
				<button id="close-settings-modal" class="text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
			</div>
			<div class="space-y-4">
				<div>
					<h3 class="text-white font-semibold mb-2">Sources</h3>
					<div class="space-y-2">
						<div>
							<label class="text-gray-400 text-sm">FilmModu</label>
							<input type="text" id="cfg-filmmodu" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
						<div>
							<label class="text-gray-400 text-sm">Webteizle</label>
							<input type="text" id="cfg-webteizle" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
					</div>
				</div>
				<div>
					<h3 class="text-white font-semibold mb-2">Services</h3>
					<div class="space-y-2">
						<div>
							<label class="text-gray-400 text-sm">Pixel</label>
							<input type="text" id="cfg-pixel" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
						<div>
							<label class="text-gray-400 text-sm">Filemoon</label>
							<input type="text" id="cfg-filemoon" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
						<div>
							<label class="text-gray-400 text-sm">Vidmoly</label>
							<input type="text" id="cfg-vidmoly" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
						<div>
							<label class="text-gray-400 text-sm">Dzen</label>
							<input type="text" id="cfg-dzen" class="w-full p-2 rounded-md bg-dark-bg border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-turkuazz" />
						</div>
					</div>
				</div>
			</div>
			<div class="flex gap-2 mt-6">
				<button id="settings-reset-btn" class="flex-1 bg-dark-bg hover:bg-dark-hover text-gray-400 font-bold py-2 px-4 rounded-md transition-colors">
					Reset
				</button>
				<button id="settings-save-btn" class="flex-1 bg-turkuazz text-dark-bg font-bold py-2 px-4 rounded-md hover:bg-opacity-90 transition-colors">
					Save
				</button>
			</div>
		</div>
	`
	
	document.body.appendChild(overlay)
	
	const closeBtn = overlay.querySelector('#close-settings-modal')
	const saveBtn = overlay.querySelector('#settings-save-btn')
	const resetBtn = overlay.querySelector('#settings-reset-btn')
	
	closeBtn.addEventListener('click', () => {
		overlay.classList.add('hidden')
	})
	
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) {
			overlay.classList.add('hidden')
		}
	})
	
	saveBtn.addEventListener('click', () => {
		movieApiConfig.filmmodu = overlay.querySelector('#cfg-filmmodu').value
		movieApiConfig.webteizle = overlay.querySelector('#cfg-webteizle').value
		movieApiConfig.services.pixel = overlay.querySelector('#cfg-pixel').value
		movieApiConfig.services.filemoon = overlay.querySelector('#cfg-filemoon').value
		movieApiConfig.services.vidmoly = overlay.querySelector('#cfg-vidmoly').value
		movieApiConfig.services.dzen = overlay.querySelector('#cfg-dzen').value
		saveMovieApiConfig()
		overlay.classList.add('hidden')
	})
	
	resetBtn.addEventListener('click', () => {
		movieApiConfig = JSON.parse(JSON.stringify(defaultMovieApiConfig))
		saveMovieApiConfig()
		populateSettingsFields(overlay)
	})
	
	return overlay
}

function populateSettingsFields(modal) {
	modal.querySelector('#cfg-filmmodu').value = movieApiConfig.filmmodu
	modal.querySelector('#cfg-webteizle').value = movieApiConfig.webteizle
	modal.querySelector('#cfg-pixel').value = movieApiConfig.services.pixel
	modal.querySelector('#cfg-filemoon').value = movieApiConfig.services.filemoon
	modal.querySelector('#cfg-vidmoly').value = movieApiConfig.services.vidmoly
	modal.querySelector('#cfg-dzen').value = movieApiConfig.services.dzen
}

function openSettingsModal() {
	if (!settingsModalInstance) {
		settingsModalInstance = createSettingsModal()
	}
	populateSettingsFields(settingsModalInstance)
	settingsModalInstance.classList.remove('hidden')
}

// filmmodu
const filmmodu_domain = () => movieApiConfig.filmmodu

/**
 * @param {string} name
 * @param {number} page
 * @returns {Array}
*/
async function getlist_filmmodu(name, page=1) {
	let page_query = ""
	if (page > 1) {
		page_query = `&page=${page}`
	}
	const fetch_url = `${filmmodu_domain()}/film-ara?term=${name}${page_query}`
	const r = await fetch(fetch_url, {
		method: 'GET',
		headers: {
			'Accept': 'text/html charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		},
		redirect: 'follow'
	})
	.then(async response => {
		const html = await response.text()
		const redirected = response.redirected
		const finalUrl = response.url
		return { html, redirected, finalUrl }
	})
	.then(({ html, redirected, finalUrl }) => {
		const parser = new DOMParser()
		const doc = parser.parseFromString(html, "text/html")
		
		if (redirected && finalUrl !== fetch_url) {
			const titleEl = doc.querySelector("h1")
			const imgEl = doc.querySelector(".img-responsive")
			const movie_title = titleEl.textContent.trim()
			const movie_img = imgEl.dataset.srcset
			const movieId = extractid_filmmodu(movie_img)
			return [{
				title: movie_title,
				img: movie_img,
				movieId: movieId
			}]
		}
		
		const movielist_div = doc.querySelectorAll(".movie-list")
		const movies = []
		movielist_div.forEach(div => {
			const items = div.querySelectorAll(".poster")
			items.forEach(item => {
				const aEl = item.querySelector("a")
				const imgEl = item.querySelector("source")

				const movie_title = aEl.innerText
				const movie_img = imgEl.dataset.srcset
				const movie_id = extractid_filmmodu(movie_img)
				movies.push({
					title: movie_title,
					img: movie_img,
					movieId: movie_id
				})
			})
		})
		return movies
	})
	.catch(error => {
		loggerMovieModal.error('Error fetching list from filmmodu:', error)
		return []
	})
	return r
}

/**
 * @param {string} img_link
 * @returns {number|null}
*/
function extractid_filmmodu(img_link) {
	return img_link.split("/uploads/movie/poster/").pop().split("/").shift() || null
}

/**
 * @param {number} videoID
 * @returns {Array}
*/
async function getsource_filmmodu(videoID) {
	const r = await fetch(`${filmmodu_domain()}/get-source?movie_id=${videoID}&type=en`, {
		method: 'GET',
		headers: {
			'Accept': 'application/json charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		}
	})
	.then(response => {
		return response.json()
	})
	.catch(error => {
		loggerMovieModal.error('Error fetching source from filmmodu:', error)
		return []
	})

	return r
}



// webteizle

const webteizle_domain = () => movieApiConfig.webteizle

const service_domains = () => movieApiConfig.services


/**
 * @param {string} img_link
 * @returns {number|null}
*/
function extractid_webteizle(img_link) {
	const id = img_link.replace("file://","")
											.replace("/i/afis/a","")
											.replace("/i/afis/b/a","")
											.split(".")[0]
	return id
}

/**
 * @param {string} name
 * @param {number} page
 * @returns {Array}
*/
async function getlist_webteizle(name, page=1) {
	const fetch_url = `${webteizle_domain()}/filtre/${page}?a=${name}`
	const r = await fetch(fetch_url, {
		method: 'GET',
		headers: {
			'Accept': 'text/html charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		},
		redirect: 'follow'
	})
	.then(async response => {
		const buffer = await response.arrayBuffer()
		const decoder = new TextDecoder('windows-1254') // for turkish
		const html = decoder.decode(buffer)
		const redirected = response.redirected
		const finalUrl = response.url
		return { html, redirected, finalUrl }
	})
	.then(({ html, redirected, finalUrl }) => {
		const parser = new DOMParser()
		const doc = parser.parseFromString(html, "text/html")
		
		if (redirected && finalUrl !== fetch_url) {
			const imgEl = doc.querySelector(".image").querySelector("img")
			const aEl = doc.querySelector('[data-ajax="#sol"]')
			const movie_img = `${webteizle_domain()}/${imgEl.dataset.src}`
			const movieId = extractid_webteizle(imgEl.dataset.src)
			const movie_title = aEl.innerText
			// const movie_source = `${webteizle_domain()}/${aEl.href}`

			return [{
				title: movie_title,
				img: movie_img,
				movieId: movieId
			}]
		}
		
		const movielist_div = doc.querySelectorAll(".cards")
		const movies = []
		movielist_div.forEach(div => {
			const items = div.querySelectorAll(".card")
			items.forEach(item => {
				const imgEl = item.querySelector("img")
				const movie_title = item.querySelector(".filmname").innerText
				const movie_id = extractid_webteizle(imgEl.dataset.src)
				const movie_img = `${webteizle_domain()}/${imgEl.dataset.src}`
				
				movies.push({
					title: movie_title,
					img: movie_img,
					movieId: movie_id
				})
			})
		})
		return movies
	})
	.catch(error => {
		loggerMovieModal.error('Error fetching list from webteizle:', error)
		return []
	})
	return r
}

/**
 * @param {number} serviceID
 * @returns {string|null}
*/
async function extractsource_webteizle(serviceID) {
	const r = await fetch(`${webteizle_domain()}/ajax/dataEmbed.asp`, {
		method: 'POST',
		headers: {
			'Accept': 'application/json charset=UTF-8',
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		},
		body: `id=${serviceID}`
	})
	.then(response => {
		return response.text()
	})
	.catch(error => {
		loggerMovieModal.error('Error fetching source from webteizle:', error)
		return null
	})

	return r
}

/**
 * @param {string} service_name
 * @param {number} sources_service
 * @returns {string|null}
*/
async function getsource_serviceURL(service_name, sources_service) {
	if (service_name == "pixel") {
		const sourceData = await extractsource_webteizle(sources_service)
		if (sourceData) {
			const parsed = sourceData.split("pixel('").pop().split("'")[0]
			return `${service_domains()["pixel"]}/${parsed}`
		}
	} else if (service_name == "filemoon") {
			const sourceData = await extractsource_webteizle(sources_service)
			if (sourceData) {
				const someid = sourceData.split("filemoon('").pop().split("'")[0]
				const r = await fetch(`${service_domains()["filemoon"]}/${someid}?ref=${webteizle_domain().replace("https://", "")}`, {
					method: 'GET',
					headers: {
						'Accept': 'application/json charset=UTF-8',
						'X-Requested-With': 'XMLHttpRequest'
					},
					redirect: 'follow'
				})
				.then(response => {
					return response.text()
				})
				.then(html => {
					try {
						const unpacked = unpack_packer(html)
						if (!unpacked) return null
						const match = unpacked.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/i)
						if (match && match[1]) {
							return match[1]
						}
						return null
					} catch (e) {
						loggerMovieModal.error('Filemoon unpack error:', e)
						return null
					}
				})
				return r
			}
	} else if (service_name == "vidmoly") {
		const sourceData = await extractsource_webteizle(sources_service)
		if (sourceData) {
			const someid = sourceData.split("vidmoly('").pop().split("'")[0]
			const r = await fetch(`${service_domains()["vidmoly"]}${someid}.html`, {
				method: 'GET',
				headers: {
					'Accept': 'text/html charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest'
				},
				redirect: 'follow'
			})
			.then(response => {
				return response.text()
			})
			.then(html => {
				const videoUrl = html.split('sources: [{file:"').pop().split('"')[0]
				return videoUrl || null
			})
			return r
		}
	} else if (service_name == "dzen") {
		const sourceData = await extractsource_webteizle(sources_service)
		if (sourceData) {
			const someid = sourceData.split("var vid = '")[1].split("';")[0]
			const r = await fetch(`${service_domains()["dzen"]}/${someid}`, {
				method: 'GET',
				headers: {
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'X-Requested-With': 'XMLHttpRequest'
				},
				redirect: 'follow'
			})
			.then(response => {
				return response.text()
			})
			.then(html => {
				const streamurls = html.split('<script nonce=')[1]
																.split('"streams":')[1]
																.split(',"content_id":')[0] // list of arrays
				const videoUrl = JSON.parse(streamurls)[0].url
				console.log("Dzen videoUrl:", videoUrl)
				return videoUrl || null
			})
			return r
		}
	}

	return null
}

/**
 * @param {number} videoID
 * @returns {Array}
*/
async function getsource_webteizle(videoID, preferredSource=null) {
	const r = await fetch(`${webteizle_domain()}/ajax/dataAlternatif3.asp`, {
		method: 'POST',
		headers: {
			'Accept': 'application/json charset=UTF-8',
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'X-Requested-With': 'XMLHttpRequest'
		},
		body: `filmid=${videoID}&dil=1&s=&b=&bot=0`
	})
	.then(response => {
		return response.json()
	})
	.then(async (data) => {
		if (data["status"] == "success") {
			const res = data.data
			const sources = {}
			res.forEach(item => {
				const name = item.baslik.toLowerCase()
				if (service_domains()[name]) {
					sources[name] = item.id
				}
			})
			if (preferredSource && sources[preferredSource]){
				const parsed = await getsource_serviceURL(preferredSource, sources[preferredSource])
				return { videoUrl: parsed, availableSources: sources, usedSource: preferredSource }
			}
			let selectedSource = null
			if (sources["pixel"]){
				selectedSource = "pixel"
			} else if (sources["filemoon"]){
				selectedSource = "filemoon"
			} else if (sources["vidmoly"]){
				selectedSource = "vidmoly"
			}
			// TODO: make dzen work
			// else if (sources["dzen"]) {
			// 	selectedSource = "dzen"
			// }

			if (selectedSource) {
				const parsed = await getsource_serviceURL(selectedSource, sources[selectedSource])
				return { videoUrl: parsed, availableSources: sources, usedSource: selectedSource }
			}
			loggerMovieModal.warn("no source found")
			return null
		}
		loggerMovieModal.warn("data status not success")
		return null
	})
	.catch(error => {
		loggerMovieModal.error('Error fetching source from webteizle:', error)
		return null
	})

	return r
}





// movie modal

const movieSources = {
	filmmodu: {
		name: 'FilmModu',
		getList: getlist_filmmodu,
		getSource: getsource_filmmodu,
		hasSubtitle: true
	},
	webteizle: {
		name: 'Webteizle',
		getList: getlist_webteizle,
		getSource: getsource_webteizle,
		hasSubtitle: false
	}
}

let movieModalInstance = null
let currentPage = 1
let currentQuery = ''
let currentSource = 'filmmodu'
let isUserWatching = false

if (window.electronAPI && window.electronAPI.onVideoSyncStatus) {
	window.electronAPI.onVideoSyncStatus((data) => {
		isUserWatching = data.connected
	})
}

/**
 * @returns {HTMLElement}
*/
function createMovieModal() {
	const overlay = document.createElement('div')
	overlay.id = 'movie-modal'
	overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden'
	overlay.style.zIndex = '9999'
	
	overlay.innerHTML = `
		<div class="bg-dark-card p-6 rounded-lg shadow-md w-[700px] max-w-full max-h-[85vh] overflow-hidden m-4 config-modal-animate flex flex-col">
			<div class="flex justify-between items-center mb-4">
				<div class="flex items-center gap-2">
					<h2 class="text-2xl font-bold text-turkuazz">Search Movies</h2>
					<button id="movie-settings-btn" class="text-gray-400 hover:text-turkuazz text-lg" title="Settings">
						<i class="fas fa-cog"></i>
					</button>
				</div>
				<button id="close-movie-modal" class="text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
			</div>
			<div class="flex gap-2 mb-4">
				<select id="movie-source-select" class="p-3 rounded-md bg-dark-bg border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-turkuazz">
					<option value="filmmodu">FilmModu</option>
					<option value="webteizle">Webteizle</option>
				</select>
				<input 
					type="text" 
					id="movie-search-input" 
					placeholder="Search for a movie..." 
					class="flex-1 p-3 rounded-md bg-dark-bg border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-turkuazz"
				/>
				<button id="movie-search-btn" class="bg-turkuazz text-dark-bg font-bold py-3 px-4 rounded-md hover:bg-opacity-90 transition-colors">
					<i class="fas fa-search"></i>
				</button>
			</div>
			<div id="movie-loading" class="hidden flex items-center justify-center py-8">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-turkuazz"></div>
			</div>
			<div id="movie-list" class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-turkuazz scrollbar-track-dark-bg space-y-3"></div>
			<div id="movie-pagination" class="hidden flex justify-center items-center gap-4 mt-4 pt-4 border-t border-gray-700">
				<button id="movie-prev-page" class="bg-dark-bg hover:bg-dark-hover text-white px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
					<i class="fas fa-chevron-left"></i> Prev
				</button>
				<span id="movie-page-info" class="text-gray-400">Page 1</span>
				<button id="movie-next-page" class="bg-dark-bg hover:bg-dark-hover text-white px-4 py-2 rounded-md transition-colors">
					Next <i class="fas fa-chevron-right"></i>
				</button>
			</div>
		</div>
	`
	
	document.body.appendChild(overlay)
	
	const closeBtn = overlay.querySelector('#close-movie-modal')
	const settingsBtn = overlay.querySelector('#movie-settings-btn')
	const searchInput = overlay.querySelector('#movie-search-input')
	const searchBtn = overlay.querySelector('#movie-search-btn')
	const sourceSelect = overlay.querySelector('#movie-source-select')
	const movieList = overlay.querySelector('#movie-list')
	const loadingEl = overlay.querySelector('#movie-loading')
	const paginationEl = overlay.querySelector('#movie-pagination')
	const prevBtn = overlay.querySelector('#movie-prev-page')
	const nextBtn = overlay.querySelector('#movie-next-page')
	const pageInfo = overlay.querySelector('#movie-page-info')
	
	closeBtn.addEventListener('click', () => {
		overlay.classList.add('hidden')
	})
	
	settingsBtn.addEventListener('click', () => {
		openSettingsModal()
	})
	
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) {
			overlay.classList.add('hidden')
		}
	})
	
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
			if (settingsModalInstance && !settingsModalInstance.classList.contains('hidden')) {
				settingsModalInstance.classList.add('hidden')
			} else {
				overlay.classList.add('hidden')
			}
		}
	})
	
	const doSearch = () => {
		const query = searchInput.value.trim()
		if (query) {
			currentQuery = query
			currentPage = 1
			currentSource = sourceSelect.value
			searchMovies(query, currentPage, currentSource, movieList, loadingEl, paginationEl, pageInfo)
		}
	}
	
	searchInput.addEventListener('keypress', (e) => {
		if (e.key === 'Enter') {
			doSearch()
		}
	})
	
	searchBtn.addEventListener('click', doSearch)
	
	prevBtn.addEventListener('click', () => {
		if (currentPage > 1) {
			currentPage--
			searchMovies(currentQuery, currentPage, currentSource, movieList, loadingEl, paginationEl, pageInfo)
		}
	})
	
	nextBtn.addEventListener('click', () => {
		currentPage++
		searchMovies(currentQuery, currentPage, currentSource, movieList, loadingEl, paginationEl, pageInfo)
	})
	
	return overlay
}

/**
 * @param {string} query
 * @param {number} page
 * @param {string} source
 * @param {HTMLElement} listContainer
 * @param {HTMLElement} loadingEl
 * @param {HTMLElement} paginationEl
 * @param {HTMLElement} pageInfo
*/
async function searchMovies(query, page, source, listContainer, loadingEl, paginationEl, pageInfo) {
	listContainer.innerHTML = ''
	loadingEl.classList.remove('hidden')
	paginationEl.classList.add('hidden')
	
	await movieApiInitPromise
	
	const prevBtn = paginationEl.querySelector('#movie-prev-page')
	
	try {
		const encodedQuery = encodeURIComponent(query)
		const sourceConfig = movieSources[source]
		const movies = await sourceConfig.getList(encodedQuery, page)
		loadingEl.classList.add('hidden')
		
		if (movies.length === 0) {
			listContainer.innerHTML = '<p class="text-gray-400 text-center py-4">No movies found</p>'
			return
		}
		
		paginationEl.classList.remove('hidden')
		pageInfo.textContent = `Page ${page}`
		prevBtn.disabled = page <= 1
		
		for (const movie of movies) {
			const itemEl = document.createElement('div')
			itemEl.className = 'bg-dark-bg hover:bg-dark-hover rounded-md p-3 flex gap-4 items-center transition-colors duration-200'
			
			itemEl.innerHTML = `
				<img src="${movie.img}" alt="${movie.title}" class="w-16 h-24 object-cover rounded-md flex-shrink-0" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23374151%22 width=%22100%22 height=%22150%22/><text x=%2250%22 y=%2275%22 fill=%22%239CA3AF%22 text-anchor=%22middle%22 font-size=%2212%22>No Image</text></svg>'"/>
				<div class="flex-1 min-w-0">
					<p class="text-white font-medium truncate">${movie.title}</p>
					<p class="movie-status text-gray-400 text-sm mt-1">Loading sources...</p>
				</div>
				<button class="movie-watch-btn bg-turkuazz text-dark-bg font-bold py-2 px-4 rounded-md hover:bg-opacity-90 transition-colors flex-shrink-0 opacity-50 cursor-not-allowed" disabled>
					<i class="fas fa-play"></i>
				</button>
				<button class="movie-sub-btn bg-gray-600 text-white font-bold py-2 px-3 rounded-md hover:bg-gray-500 transition-colors flex-shrink-0 hidden opacity-50 cursor-not-allowed" title="Add Subtitle" disabled>
					<i class="fas fa-closed-captioning"></i>
				</button>
				<button class="movie-alt-btn bg-gray-600 text-white font-bold py-2 px-3 rounded-md hover:bg-gray-500 transition-colors flex-shrink-0 hidden" title="Alternative Sources">
					<i class="fas fa-list"></i>
				</button>
			`
			
			listContainer.appendChild(itemEl)
			
			const statusEl = itemEl.querySelector('.movie-status')
			const watchBtn = itemEl.querySelector('.movie-watch-btn')
			const subBtn = itemEl.querySelector('.movie-sub-btn')
			const altBtn = itemEl.querySelector('.movie-alt-btn')
			
			loadMovieSource(movie, source, sourceConfig, statusEl, watchBtn, subBtn, altBtn, itemEl)
		}
	} catch (error) {
		loadingEl.classList.add('hidden')
		listContainer.innerHTML = '<p class="text-red-400 text-center py-4">Error searching movies</p>'
		loggerMovieModal.error('Search failed:', error)
	}
}

/**
 * @param {Object} movie
 * @param {string} source
 * @param {Object} sourceConfig
 * @param {HTMLElement} statusEl
 * @param {HTMLElement} watchBtn
 * @param {HTMLElement} subBtn
 * @param {HTMLElement} altBtn
 * @param {HTMLElement} itemEl
*/
async function loadMovieSource(movie, source, sourceConfig, statusEl, watchBtn, subBtn, altBtn, itemEl) {
	try {
		const movieId = movie.movieId
		if (!movieId) {
			statusEl.textContent = 'No ID found'
			return
		}
		
		const sourceData = await sourceConfig.getSource(movieId)
		
		let videoUrl = null
		let subtitleUrl = null
		let availableSources = null
		
		if (source === 'filmmodu') {
			if (sourceData && sourceData.sources && sourceData.sources.length > 0) {
				videoUrl = sourceData.sources[0].src
				if (sourceData.subtitle) {
					subtitleUrl = `${filmmodu_domain()}${sourceData.subtitle}`
				}
			}
		} else if (source === 'webteizle') {
			if (sourceData) {
				videoUrl = sourceData.videoUrl
				availableSources = sourceData.availableSources
				statusEl.textContent = sourceData.usedSource ? `Ready (${sourceData.usedSource})` : 'Ready to watch'
			}
		}
		
		if (videoUrl) {
			if (source === 'filmmodu') {
				statusEl.textContent = subtitleUrl ? 'Ready (with subtitle)' : 'Ready to watch'
			}
			watchBtn.classList.remove('opacity-50', 'cursor-not-allowed')
			watchBtn.disabled = false
			
			watchBtn.addEventListener('click', () => {
				const urlInput = document.getElementById('urlof-thevideo')
				if (urlInput) {
					urlInput.value = videoUrl
				}
				movieModalInstance.classList.add('hidden')
			})
			
			if (subtitleUrl && source === 'filmmodu') {
				subBtn.classList.remove('hidden')
				if (isUserWatching) {
					subBtn.classList.remove('opacity-50', 'cursor-not-allowed')
					subBtn.disabled = false
				}
				subBtn.addEventListener('click', async () => {
					if (!isUserWatching) return
					subBtn.disabled = true
					subBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'
					try {
						const response = await fetch(subtitleUrl)
						const arrayBuffer = await response.arrayBuffer()
						const filename = subtitleUrl.split('/').pop() || 'subtitle.vtt'
						const result = await window.electronAPI.uploadSubtitle(arrayBuffer, filename)
						if (result.success) {
							subBtn.innerHTML = '<i class="fas fa-check"></i>'
							subBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500')
							subBtn.classList.add('bg-green-600')
							setTimeout(() => {
								subBtn.innerHTML = '<i class="fas fa-closed-captioning"></i>'
								subBtn.classList.remove('bg-green-600')
								subBtn.classList.add('bg-gray-600', 'hover:bg-gray-500')
								subBtn.disabled = false
							}, 2000)
						} else {
							subBtn.innerHTML = '<i class="fas fa-times"></i>'
							subBtn.classList.add('bg-red-600')
							setTimeout(() => {
								subBtn.innerHTML = '<i class="fas fa-closed-captioning"></i>'
								subBtn.classList.remove('bg-red-600')
								subBtn.disabled = false
							}, 2000)
						}
					} catch (err) {
						loggerMovieModal.error('Failed to add subtitle:', err)
						subBtn.innerHTML = '<i class="fas fa-times"></i>'
						subBtn.classList.add('bg-red-600')
						setTimeout(() => {
							subBtn.innerHTML = '<i class="fas fa-closed-captioning"></i>'
							subBtn.classList.remove('bg-red-600')
							subBtn.disabled = false
						}, 2000)
					}
				})
			}
			
			if (availableSources && Object.keys(availableSources).length > 1) {
				altBtn.classList.remove('hidden')
				altBtn.addEventListener('click', () => {
					showWebteizleSourcesDropdown(availableSources, altBtn, itemEl)
				})
			}
		} else {
			statusEl.textContent = 'No sources available'
		}
	} catch (err) {
		loggerMovieModal.error('Failed to fetch movie source:', err)
		statusEl.textContent = 'Failed to load'
	}
}

function showWebteizleSourcesDropdown(sources, altBtn, itemEl) {
	const existingDropdown = itemEl.querySelector('.sources-dropdown')
	if (existingDropdown) {
		existingDropdown.remove()
		return
	}
	
	const dropdown = document.createElement('div')
	dropdown.className = 'sources-dropdown absolute right-0 top-full mt-1 bg-dark-card border border-gray-700 rounded-md shadow-lg z-50 min-w-[120px]'
	
	Object.keys(sources).forEach(sourceName => {
		const btn = document.createElement('button')
		btn.className = 'w-full text-left px-3 py-2 text-sm text-white hover:bg-dark-hover transition-colors first:rounded-t-md last:rounded-b-md capitalize'
		btn.textContent = sourceName
		btn.addEventListener('click', async () => {
			dropdown.remove()
			const statusEl = itemEl.querySelector('.movie-status')
			statusEl.textContent = `Loading ${sourceName}...`
			try {
				const videoUrl = await getsource_serviceURL(sourceName, sources[sourceName])
				if (videoUrl) {
					const urlInput = document.getElementById('urlof-thevideo')
					if (urlInput) {
						urlInput.value = videoUrl
					}
					movieModalInstance.classList.add('hidden')
				} else {
					statusEl.textContent = `${sourceName} failed`
				}
			} catch (err) {
				statusEl.textContent = `${sourceName} failed`
			}
		})
		dropdown.appendChild(btn)
	})
	
	altBtn.parentElement.style.position = 'relative'
	altBtn.parentElement.appendChild(dropdown)
	
	const closeDropdown = (e) => {
		if (!dropdown.contains(e.target) && e.target !== altBtn) {
			dropdown.remove()
			document.removeEventListener('click', closeDropdown)
		}
	}
	setTimeout(() => document.addEventListener('click', closeDropdown), 0)
}

/**
 * @returns {void}
*/
function openModal() {
	if (!movieModalInstance) {
		movieModalInstance = createMovieModal()
	}
	
	movieModalInstance.classList.remove('hidden')
	
	const subBtns = movieModalInstance.querySelectorAll('.movie-sub-btn:not(.hidden)')
	subBtns.forEach(btn => {
		if (isUserWatching) {
			btn.classList.remove('opacity-50', 'cursor-not-allowed')
			btn.disabled = false
		} else {
			btn.classList.add('opacity-50', 'cursor-not-allowed')
			btn.disabled = true
		}
	})
	
	const searchInput = movieModalInstance.querySelector('#movie-search-input')
	setTimeout(() => {
		searchInput.focus()
	}, 100)
}

window.openMovieModal = openModal