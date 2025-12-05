const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const secureStorage = require('./secureStorage.js')
const { Menu } = require('electron')
const { create: createYoutubeDl } = require('youtube-dl-exec')
const UpdateManager = require('./updateManager.js')
const os = require('os')
const { VideoSyncManager } = require('./videoSyncManager.js')

// const bcrypt = require('bcryptjs')
// console.log(bcrypt.hashSync("123", 10))
// process.exit()

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

const videoSyncManager = new VideoSyncManager(logger)

const isDev = !app.isPackaged

const ytdl_binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
const ytdl_binPath = isDev ? path.join(
	__dirname,
	'node_modules',
	'youtube-dl-exec',
	'bin',
	ytdl_binName
) : path.join(
	process.resourcesPath,
	'app.asar.unpacked',
	'node_modules',
	'youtube-dl-exec',
	'bin',
	ytdl_binName
)
logger.debug("ytdl_path:", ytdl_binPath)
const youtubedl = createYoutubeDl(ytdl_binPath)

const subtitleCache = new Map()

const selectSubtitleForVlc = async (maxRetries = 5) => {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		logger.info(`selectSubtitleForVlc: attempt ${attempt + 1}/${maxRetries}`)
		try {
			if (!isVLCwatching || !proc_vlc) {
				throw Error("VLC not running, cannot add subtitle")
			}
			const statusResponse = await axios.post(
				`http://127.0.0.1:${VLC_PORT}/requests/status.json`,
				null,
				{
					auth: { username: '', password: VLC_HTTP_PASS },
					timeout: 2000
				}
			)
			
			if (statusResponse.data.information && statusResponse.data.information.category) {
				const categories = statusResponse.data.information.category
				let subtitleStreamId = null
				
				for (const [streamName, streamInfo] of Object.entries(categories)) {
					if (streamInfo.Type === "Subtitle") {
						const streamNumber = streamName.match(/Stream (\d+)/)?.[1]
						if (streamNumber) {
							subtitleStreamId = parseInt(streamNumber)
							break
						}
					}
				}
				
				if (subtitleStreamId !== null) {
					await axios.post(
						`http://127.0.0.1:${VLC_PORT}/requests/status.json`,
						null,
						{
							auth: { username: '', password: VLC_HTTP_PASS },
							params: { command: "subtitle_track", val: subtitleStreamId },
							timeout: 2000
						}
					)
					logger.info("Enabled subtitle stream:", subtitleStreamId)
					return true
				} else {
					logger.info("No subtitle stream found")
					if (attempt < maxRetries - 1) {
						await new Promise(resolve => setTimeout(resolve, 300))
					}
				}
			}
		} catch (enableError) {
			logger.warn(`Failed to enable subtitle (attempt ${attempt + 1}/${maxRetries}):`, enableError.message)
			if (attempt < maxRetries - 1) {
				await new Promise(resolve => setTimeout(resolve, 300))
			}
		}
	}
	logger.error(`selectSubtitleForVlc: could not select subtitle after ${maxRetries} attempts`)
	return false
}

const addSubtitleToVLC = async (subtitlePath, maxRetries = 5) => {
	let attempts = 0
	while (attempts < maxRetries) {
		logger.debug(`addSubtitleToVLC: attempts'${attempts}'`)
		if (!isVLCwatching || !proc_vlc) {
			throw Error("VLC not running, cannot add subtitle")
		}
		try {
			const statusResponse = await axios.post(
				`http://127.0.0.1:${VLC_PORT}/requests/status.xml`,
				null,
				{
					auth: { username: '', password: VLC_HTTP_PASS },
					params: { command: "addsubtitle", val: subtitlePath },
					timeout: 2000
				}
			)
			// logger.debug(statusResponse.data)
			if (statusResponse.data && statusResponse.data.includes("<title>Error loading /requests/status.xml</title>")) {
				throw new Error("Failed to add subtitle: no current input in VLC")
			}
			logger.info(`Subtitle added to VLC successfully on attempt ${attempts + 1}:`, subtitlePath)
			await new Promise(resolve => setTimeout(resolve, 300))
			added = await selectSubtitleForVlc()
			return added
		} catch (error) {
			attempts++
			logger.warn(`Failed to add subtitle to VLC (attempt ${attempts}/${maxRetries}):`, error.message)
			if (attempts < maxRetries) {
				await new Promise(resolve => setTimeout(resolve, 300))
			}
		}
	}
	logger.error(`Failed to add subtitle to VLC after ${maxRetries} attempts:`, subtitlePath)
	return false
}


const __apppath = isDev ? __dirname : process.resourcesPath
logger.info("----APPPATH:", __apppath)
const appConfigPath = isDev ? path.join(__apppath, 'resources/config/config.json') : path.join(__apppath, 'config/config.json')
const movieApiConfigPath = isDev ? path.join(__apppath, 'resources/config/movieApi.json') : path.join(__apppath, 'config/movieApi.json')

let appConfig = {}
if (!fs.existsSync(appConfigPath)) {
	logger.error("config not found")
	process.exit()
}

try {
	const configData = fs.readFileSync(appConfigPath, 'utf-8')
	appConfig = JSON.parse(configData)
} catch (e) {
	logger.error("Failed to parse config:", e.message)
	process.exit()
}
logger.info('Loaded app config:', appConfig)

let movieApiConfig = {}
if (fs.existsSync(movieApiConfigPath)) {
	try {
		movieApiConfig = JSON.parse(fs.readFileSync(movieApiConfigPath, 'utf-8'))
		logger.info('Loaded movieApi config:', movieApiConfig)
	} catch (e) {
		logger.warn("Failed to parse movieApi config:", e.message)
	}
}

let SERVER_ENDPOINT = appConfig.SERVER_ENDPOINT
ipcMain.handle('get-serverendpoint', (event) => {
	return SERVER_ENDPOINT
})

let VLC_PORT = appConfig.VLC_PORT
let VLC_HTTP_PASS = appConfig.VLC_HTTP_PASS
let TIME_SYNC_TOLERANCE = appConfig.TIME_SYNC_TOLERANCE || 1.5
let VLC_PATH

if (appConfig.VLC_FINDER) {
	let possiblePaths = []
	if (process.platform === 'win32') {
		possiblePaths = [
			'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
			'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
			'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\VideoLAN\\VLC\\vlc.exe',
		]
	} else if (process.platform === 'linux') {
		possiblePaths = [
			'/usr/bin/vlc',
			'/usr/local/bin/vlc',
			'/snap/bin/vlc',
		]
	} else {
		VLC_PATH = appConfig.VLC_PATH
		logger.info("----VLC PATH from APPCONFIG:", VLC_PATH)
	}
	for (const vlcPath of possiblePaths) {
		if (fs.existsSync(vlcPath)) {
			VLC_PATH = vlcPath
			logger.info("----VLC PATH from AUTOFIND:", VLC_PATH)
			break
		}
	}
}else {
	VLC_PATH = appConfig.VLC_PATH
	logger.info("----VLC PATH from APPCONFIG:", VLC_PATH)
}

let youtubeUrlCache = new Map()
const YOUTUBE_CACHE_TTL = 300000

const cleanupYouTubeCache = () => {
	const now = Date.now()
	for (const [url, data] of youtubeUrlCache.entries()) {
		if (now - data.timestamp > YOUTUBE_CACHE_TTL) {
			youtubeUrlCache.delete(url)
			logger.debug(`Cleaned up expired YouTube cache entry: ${url}`)
		}
	}
}

setInterval(cleanupYouTubeCache, 60000)

const YOUTUBE_URLS = [
	"https://www.youtube.com",
	"https://youtube.com",
	"http://www.youtube.com",
	"http://youtube.com",
	"www.youtube.com",
	"youtube.com",
	"https://youtu.be",
	"youtu.be",
]

const isYouTubeUrl = (url) => {
	if (!url) return false
	for (const ytorigin of YOUTUBE_URLS) {
		if (url.startsWith(ytorigin)) {
			return true
		}
	}
	return false
}

const isValidVideoUrl = (url) => {
	if (!url || typeof url !== 'string') return false
	const trimmed = url.trim()
	if (trimmed.length === 0 || trimmed.length > 2048) return false
	if (trimmed.startsWith('-')) return false
	if (trimmed.includes('\0')) return false
	try {
		const parsed = new URL(trimmed)
		if (!['http:', 'https:'].includes(parsed.protocol)) return false
		return true
	} catch {
		return false
	}
}

let ROOMID
let USERID

const checkRoom = async (room, roompsw)=>{
	return await axios.post(
		`https://${SERVER_ENDPOINT}/login_room`,
		{
			room: room,
			psw: roompsw
		}
	).then(async (r)=>{
		return r.data.status
	})
}
ipcMain.handle('check-room', async (event, room, roompsw) => {
	return checkRoom(room, roompsw)
})

ipcMain.handle('get-room', async (event) => {
	if (!ROOMID){
		try{
			ROOMID = await secureStorage.getPassword("turkuazz", "roomid")
			if (ROOMID === null) {return false}
		} catch {
			return false
		}
	}
	try{
		_roompsw = await secureStorage.getPassword("turkuazz", "roompsw")
		if (_roompsw === null) {return false}
	} catch {
		return false
	}
	return {
		room: ROOMID,
		psw: _roompsw
	}
})
ipcMain.handle('set-roomcreds', async (event, roomid, roompsw) => {
	if (!await checkRoom(roomid, roompsw)) { return false }
	ROOMID = roomid
	await secureStorage.setPassword('turkuazz', "roomid", roomid)
	await secureStorage.setPassword('turkuazz', "roompsw", roompsw)
	return true
})
ipcMain.handle('left-room', async (event) => {
	await abortVLC()
	await secureStorage.deletePassword('turkuazz', "roomid")
	await secureStorage.deletePassword('turkuazz', "roompsw")
	return true
})

const checkUser = async (user, userpsw)=>{
	return await axios.post(
		`https://${SERVER_ENDPOINT}/login_user`,
		{
			user: user,
			psw: userpsw
		}
	).then(async (r)=>{
		return r.data.status
	})
}
ipcMain.handle('check-user', async (event, user, userpsw) => {
	return checkUser(user, userpsw)
})

ipcMain.handle('get-user', async (event) => {
	if (!USERID){
		try{
			USERID = await secureStorage.getPassword("turkuazz", "user")
			if (USERID === null) {return false}
		} catch {
			return false
		}
	}
	try{
		_userpsw = await secureStorage.getPassword("turkuazz", "userpsw")
		if (_userpsw === null) {return false}
	} catch {
		return false
	}
	logger.info("user:", USERID)
	return {
		user: USERID,
		psw: _userpsw
	}
})
ipcMain.handle('set-usercreds', async (event, user, userpsw) => {
	if (!await checkUser(user, userpsw)) { return false }
	USERID = user
	await secureStorage.setPassword("turkuazz", "user", user)
	await secureStorage.setPassword("turkuazz", "userpsw", userpsw)
	return true
})
ipcMain.handle('logout-user', async (event) => {
	await abortVLC()
	USERID = null
	ROOMID = null
	await secureStorage.deletePassword('turkuazz', "roomid")
	await secureStorage.deletePassword('turkuazz', "roompsw")
	await secureStorage.deletePassword('turkuazz', "user")
	await secureStorage.deletePassword('turkuazz', "userpsw")
	return true
})



let mainWindow
let proc_vlc
let isVLCwatching = false
let currentVLCStatus = { status: 'stopped', isPlaying: false, url: null }
let vlcInterval
let serverInterval
let inlineVideoInterval
let isInlineWatching = false
let modeTransitionLock = false

let isClientUpToDate = false
let reconnectTimeout = null
let networkMonitorInterval = null
let isOnline = true

let updateManager = null

async function updateYtDlp() {
  try {
    const result = await youtubedl('', { update: true });
    console.log('yt-dlp update result:', result);
  } catch (err) {
    console.error('yt-dlp update failed:', err);
  }
}

const createWindow = async () => {
	const win = new BrowserWindow({
		width: 1280,
		height: 720,
		minHeight: 730,
		minWidth: 370,
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	})

	win.webContents.on('context-menu', (e, params) => {
		const menu = Menu.buildFromTemplate([
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
		])
		menu.popup({ window: win })
	})
	mainWindow = win
	
	updateManager = new UpdateManager(logger, mainWindow)
	updateManager.setServerEndpoint(SERVER_ENDPOINT)
	
	const hasUpdate = await updateManager.checkForUpdates()
	if (hasUpdate) {
		logger.info("Update available, showing update page...")
		win.loadFile(path.join(__dirname, 'views/update.html'))
		if (isDev){
			win.webContents.openDevTools()
		}
		return
	}
	
	// override config if debug
	try {
		const debugCredsPath = path.join(__dirname, 'debug_creds.js')
		if (fs.existsSync(debugCredsPath)) {
			// lazy load to avoid circular dependency
			const { setupDebugCreds } = require('./debug_creds.js')
			const debugConfig = await setupDebugCreds()
			
			USERID = debugConfig.userid
			appConfig["VLC_PORT"] = debugConfig.vlc_port
			VLC_PORT = debugConfig.vlc_port
			logger.info(`Debug mode: Using user ${USERID} with VLC port ${VLC_PORT}`)
		}
	} catch (e) {
		logger.warn("Failed to setup debug credentials:", e.message)
	}
	
	startNetworkMonitoring()
	
	win.loadFile(path.join(__dirname, 'views/index.html'))
	if (isDev){
		win.webContents.openDevTools()
	}
	await updateYtDlp()
}

function sendVideoStatus(status, additionalData = {}) {
	try{
		if (mainWindow && mainWindow.webContents) {
			const fullStatus = { ...status, ...additionalData }
			mainWindow.webContents.send('vlc-status', fullStatus)
			
			currentVLCStatus = {
				status: status.status,
				isPlaying: status.isPlaying,
				current_time: additionalData.currentTime || 0,
				is_uptodate: additionalData.isUpToDate || false,
				url: currentVLCStatus.url
			}
		}
		return true
	} catch {
		logger.error("sendVideoStatus: there was a problem.")
		return false
	}
}

const checkNetworkConnectivity = async () => {
	try {
		const interfaces = os.networkInterfaces()
		for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name]) {
				if (!iface.internal && iface.family === 'IPv4') {
					return true
				}
			}
		}
		return false
	} catch {
		return false
	}
}

const handleOnlineEvent = () => {
	logger.info('Device back online')
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout)
		reconnectTimeout = null
	}
	reconnectCount = 0
	if (mainWindow) {
		const currentTitle = mainWindow.getTitle()
		const newTitle = currentTitle.replace(/\s*\(offline\)/gi, '')
		mainWindow.setTitle(newTitle)
	}
}

const handleOfflineEvent = () => {
	logger.warn('Device went offline - force closing video sync connection')
	
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout)
		reconnectTimeout = null
	}
	reconnectCount = 0
	
	videoSyncManager.disconnect()
	
	if (mainWindow && mainWindow.webContents) {
		mainWindow.webContents.send('video-sync-status', { connected: false })
	}

	if (mainWindow) {
		const currentTitle = mainWindow.getTitle()
		if (!currentTitle.includes('(offline)')) {
			mainWindow.setTitle(currentTitle + ' (offline)')
		}
	}

	abortVLC()
	// abortInline()
}

const startNetworkMonitoring = () => {
	if (networkMonitorInterval) {
		clearInterval(networkMonitorInterval)
	}
	
	networkMonitorInterval = setInterval(async () => {
		const currentlyOnline = await checkNetworkConnectivity()
		
		if (isOnline && !currentlyOnline) {
			isOnline = false
			handleOfflineEvent()
		} else if (!isOnline && currentlyOnline) {
			isOnline = true
			handleOnlineEvent()
		}
	}, 2000)
}

const connectVideoSyncWS = async () => {
	if (videoSyncManager.isConnected()) {
		return true
	}
	videoSyncManager.setConfig(SERVER_ENDPOINT, USERID, secureStorage)
	videoSyncManager.setRoomId(ROOMID)
	videoSyncManager.setMainWindow(mainWindow)
	
	videoSyncManager.onUrlChange = async (url) => {
		currentVLCStatus.url = url
		if (isInlineWatching) {
			// const processedUrl = await checkVideoUrl(url)
			// const finalUrl = Array.isArray(processedUrl) ? processedUrl[0] : processedUrl
			// mainWindow.webContents.send('inline-video-set', { url: finalUrl })
		} else if (isVLCwatching) {
			await setVideoVLC(url)
		}
	}
	
	videoSyncManager.onTimeChange = async (time, passive) => {
		if (isInlineWatching) {
			if (!passive) {
				mainWindow.webContents.send('inline-video-sync-time', { time })
			}
		} else if (isVLCwatching) {
			try {
				const info = await getInfo()
				const currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
				const diff = Math.abs(currentTime - time)
				if (passive) {
					if (diff > TIME_SYNC_TOLERANCE + 8) {
						await setTimeVLC(time)
					}
				} else {
					if (diff > TIME_SYNC_TOLERANCE) {
						await setTimeVLC(time)
					}
				}
			} catch (error) {
				logger.debug('VLC not ready for time sync')
			}
		}
	}
	
	videoSyncManager.onPlayingChange = async (isPlaying, time) => {
		if (isInlineWatching) {
			mainWindow.webContents.send('inline-video-sync-playing', { isPlaying })
		} else if (isVLCwatching) {
			try {
				const info = await getInfo()
				const currentlyPlaying = info.data.state !== "paused"
				if (currentlyPlaying !== isPlaying) {
					await setPlayingVLC(isPlaying)
				}
			} catch (error) {
				logger.debug('VLC not ready for playing state sync')
			}
		}
	}
	
	videoSyncManager.onSubtitleAvailable = async () => {
		logger.info('Subtitle available, auto-downloading...')
		await requestSubtitle()
	}
	
	return await videoSyncManager.connect()
}

const disconnectVideoSyncWS = () => {
	sendVideoStatus({
		status: 'stopped',
		isPlaying: false
	})
	videoSyncManager.disconnect()
	videoSyncManager.setWatchingState(false, false)
	logger.info("disconnectVideoSyncWS: successful.")
}

ipcMain.on('goto-room_join', () => {
	mainWindow.loadFile('views/room_join.html')
})
ipcMain.on('goto-index', () => {
	mainWindow.loadFile('views/index.html')
})
ipcMain.on('goto-login', () => {
	mainWindow.loadFile('views/login.html')
})
ipcMain.on('goto-update', () => {
	mainWindow.loadFile('views/update.html')
})

const makeRequest_server = async (url, json) => {
	if (!json) json = {}
	if (!USERID || !ROOMID) {
		return {status: false, message: "Not authenticated"}
	}
	json.userid = USERID
	json.userpsw = await secureStorage.getPassword("turkuazz", "userpsw")
	json.roomid = ROOMID
	json.roompsw = await secureStorage.getPassword("turkuazz", "roompsw")
	try{
		const r = await axios.post(
			`https://${SERVER_ENDPOINT}${url}`,
			json,
			{ timeout: 3000 }
		)
		return r.data
	} catch (e){
		logger.error(`makeRequest_server error!\nargs:, ${url},${json}\nerror:${e.message}`)
		return {status: false, error: e.message}
	}
}

const makeRequest_videoSync = async (type, data = {}) => {
	if (!videoSyncManager.isConnected()) {
		logger.warn(`VideoSync request failed: not connected (${type})`)
		return { status: false, error: "Not connected" }
	}
	if (!isVLCwatching && !isInlineWatching) {
		logger.debug(`makeRequest_videoSync: aborted. is_watching'${isVLCwatching}' isInlineWatching'${isInlineWatching}'`)
		return { status: true }
	}
	
	try {
		let result
		switch (type) {
			case 'update_time':
				result = await videoSyncManager.updateTime(data.new_time, data.timeout_pass || false)
				break
			case 'update_isplaying':
				result = await videoSyncManager.updateState(data.is_playing, data.new_time || 0)
				break
			case 'get_playerstatus':
				result = await videoSyncManager.requestSync()
				if (result && result.type === 'init') {
					return { status: true, data: {
						url: { value: result.url, user: '' },
						time: { value: result.time, user: '' },
						is_playing: { value: result.isPlaying, user: '' },
						subtitle_exist: { value: result.subtitleExist, user: '' }
					}}
				}
				break
			case 'imuptodate':
				result = await videoSyncManager.markUpToDate()
				isClientUpToDate = true
				break
			case 'update_subtitle':
				result = await videoSyncManager.uploadSubtitle(data.subtitle_data, data.filename)
				return result
			case 'request_subtitle':
				result = await videoSyncManager.downloadSubtitle()
				if (result.status && result.subtitle_data) {
					handleSubtitleReceived(result.subtitle_data, result.filename)
				}
				return result
			default:
				logger.warn(`Unknown sync type: ${type}`)
				return { status: false, error: 'Unknown type' }
		}
		
		if (result && result.type === 'ack') {
			if (!result.success && result.error && result.error.includes('not authorized')) {
				logger.debug('Update rejected, requesting sync...')
				await videoSyncManager.requestSync()
				return { status: false, error: 'User not up to date' }
			}
			return { status: result.success, data: { status: result.success } }
		}
		return { status: result && result.success !== false, data: result }
	} catch (error) {
		logger.error(`VideoSync error: ${type}`, error.message)
		return { status: false, error: error.message }
	}
}

const handleSubtitleReceived = async (base64Data, filename) => {
	try {
		const subtitleBuffer = Buffer.from(base64Data, 'base64')
		const safeId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
		subtitleCache.set(safeId, subtitleBuffer)
		
		if (isVLCwatching) {
			const tempPath = path.join(os.tmpdir(), `vlc_sub_${safeId}.srt`)
			fs.writeFileSync(tempPath, subtitleBuffer)
			
			if (!await addSubtitleToVLC(tempPath)) {
				logger.warn("Failed to add subtitle to VLC after retries")
			}
			
			setTimeout(() => {
				try { fs.unlinkSync(tempPath) } catch {}
			}, 1000)
		}
		
		if (mainWindow && mainWindow.webContents) {
			mainWindow.webContents.send('subtitle-received', { filename })
			mainWindow.webContents.send('subtitle-status', { subtitle_exist: true })
		}
	} catch (error) {
		logger.error("Failed to process received subtitle:", error.message)
	}
}

const getInfo = async () => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json`,
		null,
		{ 
			auth: { username: '', password: VLC_HTTP_PASS },
		}
	)
}
const getVideoUrl_VLC = async () => {
	const r = await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/playlist.json`,
		null,
		{ 
			auth: { username: '', password: VLC_HTTP_PASS },
		}
	)

	try {
		if (!r || !r.data || !Array.isArray(r.data.children) || r.data.children.length === 0) {
			throw new Error('Unexpected playlist structure: missing children')
		}
		const first = r.data.children[0]
		if (!first || !Array.isArray(first.children)) {
			throw new Error('Unexpected playlist structure: missing first.children')
		}
		const currentItem = first.children.find(item => item.current === "current")
		if (!currentItem || !currentItem.uri) {
			throw new Error('Could not find current playlist item')
		}
		return currentItem.uri
	} catch (err) {
		logger.warn('getVideoUrl_VLC: failed to parse playlist.json -', err.message)
		return null
	}
}

const abortVLC = async (is_videochange=false) => {
	if (proc_vlc){
		const _proc = proc_vlc
		proc_vlc = null
		try{
			logger.info(`Killed VLC process: ${_proc.pid}`)
			_proc.kill("SIGKILL")
		} catch {
			logger.info(`couldnt kill VLC process: ${_proc.pid}`)
		}
	}
	
	isVLCwatching = false
	// videoSyncManager.setWatchingState(false, isInlineWatching)
	if (vlcInterval){
		clearInterval(vlcInterval)
		vlcInterval = null
		logger.info("cleared vlc interval")
	}
	if (serverInterval){
		clearInterval(serverInterval)
		serverInterval = null
		logger.info("cleared server interval")
	}
	
	if (!is_videochange){
		disconnectVideoSyncWS()
	}

	return
}

const checkVideoUrl = async (url) => {
	if (isYouTubeUrl(url)){
		logger.info("Processing YouTube URL:", url)
		
		if (youtubeUrlCache.has(url)) {
			const cached = youtubeUrlCache.get(url)
			if (Date.now() - cached.timestamp < YOUTUBE_CACHE_TTL) {
				logger.info("Using cached YouTube URL")
				return cached.urls
			}
		}
		
		try {
			const _streamUrl = await youtubedl(url, {
				getUrl: true,
				format: "best",
				noCheckCertificates: true,
				noPlaylist: true,
			})
			
			logger.info("Got stream URL for YouTube")
			const urls = _streamUrl.trim().split('\n').filter(u => u.trim())
			
			youtubeUrlCache.set(url, {
				urls: urls,
				timestamp: Date.now()
			})
			
			return urls
		} catch (e) {
			logger.warn("YouTube URL processing failed:", e.message || e)
			return null
		}
	}
	return url
}

const setVideoVLC = async (_url) => {
	const url = _url.trim()
	logger.info("setVideo->", url)
	
	if (proc_vlc && isVLCwatching) {
		try {
			const currentUrl = await getVideoUrl_VLC()
			let isSameVideo = false
			const isYouTube = isYouTubeUrl(url)
			
			if (isYouTube) {
				const cachedUrls = youtubeUrlCache.get(url)
				if (cachedUrls && cachedUrls.urls) {
					isSameVideo = cachedUrls.urls.includes(currentUrl)
				} else {
					isSameVideo = currentUrl === url
				}
			} else {
				isSameVideo = currentUrl === url
			}
			
			if (isSameVideo) {
				logger.info("VLC is already playing the same video, no restart needed")
				return true
			}

			const openwithabort = async ()=>{
				await abortVLC(true)
				let attempts = 0
				while (proc_vlc && attempts < 10) {
					await new Promise(resolve => setTimeout(resolve, 100))
					attempts++
				}
				return await openVLC()
			}

			if (isYouTube){
				logger.info("youtube url, restarting.")
				return await openwithabort()
			}

			// clear playlist
			await axios.post(
				`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=pl_empty`,
				null,
				{ auth: { username: '', password: VLC_HTTP_PASS } }
			)

			const maxTries = 10
			let tried = 0
			while (tried <= maxTries) {
				try {
					if (!proc_vlc) { 
						logger.debug(`proc_vlc'${proc_vlc}' so abort+start`)
						return await openwithabort()
					}
					const r = await axios.post(
						`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=in_play&input=${encodeURIComponent(url)}`,
						null,
						{ auth: { username: '', password: VLC_HTTP_PASS } }
					)
					logger.info(`setVideoVLC: r.status'${r.status}'`)
					await new Promise(resolve => setTimeout(resolve, 250))
					const currentUrl = await getVideoUrl_VLC()
					if (currentUrl === url) {
						logger.info("video changed & posted pl_empty!")
						return true
					}
					logger.info("video not changed. retrying..")
					tried++
				} catch (error) {
					logger.error("Failed to set time:", error.message)
					return false
				}
			}
			logger.info("video not changed. stopping.")
			return await openwithabort()
		} catch (error) {
			logger.debug("Could not check current VLC URL:", error.message)
			return false
		}
	}
}

let isSettingVideo = false

const setVideoToServer = async (url) => {
	if (isSettingVideo) {
		logger.warn("setVideoToServer: already setting video, skipping")
		return { status: false, error: "Already setting video" }
	}
	
	if (!isValidVideoUrl(url)) {
		logger.warn("Invalid video URL rejected:", url.substring(0, 100))
		return { status: false, error: "Invalid URL" }
	}
	
	if (currentVLCStatus.url === url) {
		logger.info("Same video URL (cached), skipping update")
		return { status: true, skipped: true }
	}
	
	isSettingVideo = true
	try {
		logger.info("setVideoToServer:", url)
		subtitleCache.clear()
		
		const result = await axios.post(
			`https://${SERVER_ENDPOINT}/setvideourl_offline`,
			{
				user: USERID,
				psw: await secureStorage.getPassword("turkuazz", "userpsw"),
				room: ROOMID,
				roompsw: await secureStorage.getPassword("turkuazz", "roompsw"),
				new_url: url
			}
		).then(r => r.data)
		
		if (result.status) {
			currentVLCStatus.url = url
			if (mainWindow && mainWindow.webContents) {
				mainWindow.webContents.send('subtitle-status', { subtitle_exist: false })
				if (result.history_entry) {
					mainWindow.webContents.send('video-history-update-broadcast', result.history_entry)
				}
			}
		} else if (result.history_entry && mainWindow && mainWindow.webContents) {
			mainWindow.webContents.send('video-history-update-broadcast', result.history_entry)
		}
		
		return result
	} catch (error) {
		logger.error("setVideoToServer error:", error.message)
		return { status: false, error: error.message }
	} finally {
		isSettingVideo = false
	}
}

ipcMain.handle('setvideo-vlc', async (_, url) => {
	try {
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('Invalid URL provided')
		}
		url = url.trim()
		
		const result = await setVideoToServer(url)
		if (result.status) {
			await setVideoVLC(url)
		}
		return result.status
	} catch (error) {
		logger.error("Error in setvideo-vlc:", error)
		return false
	}
})

ipcMain.handle('get-config', async () => {
	return JSON.parse(JSON.stringify(appConfig))
})

ipcMain.handle('get-movieapi-config', async () => {
	return JSON.parse(JSON.stringify(movieApiConfig))
})

ipcMain.handle('save-movieapi-config', async (event, config) => {
	try {
		movieApiConfig = config
		fs.writeFileSync(movieApiConfigPath, JSON.stringify(movieApiConfig, null, 4), 'utf-8')
		logger.info("MovieApi config saved:", movieApiConfig)
		return true
	} catch (error) {
		logger.error("Failed to save movieApi config:", error.message)
		return false
	}
})

ipcMain.handle('save-config', async (event, vlcport, serverendpoint, vlcfinder, vlcpath, vlchttppass, timesynctolerance) => {
	try {
		appConfig["VLC_PORT"] = vlcport
		appConfig["SERVER_ENDPOINT"] = serverendpoint
		appConfig["VLC_FINDER"] = vlcfinder
		appConfig["VLC_PATH"] = vlcpath
		appConfig["VLC_HTTP_PASS"] = vlchttppass
		appConfig["TIME_SYNC_TOLERANCE"] = timesynctolerance
		
		fs.writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 4), 'utf-8')
		
		VLC_PORT = vlcport
		SERVER_ENDPOINT = serverendpoint
		VLC_HTTP_PASS = vlchttppass
		TIME_SYNC_TOLERANCE = timesynctolerance
		if (!vlcfinder) {
			VLC_PATH = vlcpath
		}
		
		if (updateManager) {
			updateManager.setServerEndpoint(SERVER_ENDPOINT)
		}
		
		logger.info("Config saved successfully:", appConfig)
		return true
	} catch (error) {
		logger.error("Failed to save config:", error.message)
		return false
	}
})

ipcMain.handle('get-vlc-status', async () => {
	return currentVLCStatus
})

ipcMain.handle('get-watchers-status', async () => {
	try {
		const result = await makeRequest_server("/get_watchers_status")
		return result.status ? result.data : []
	} catch (error) {
		logger.error("Error getting watchers status:", error)
		return []
	}
})

const setTimeVLC = async (time) => {
	if (time < 0) {
		logger.warn("Attempted to seek to negative time:", time)
		return false
	}
	
	let tried = 0
	const maxTries = 6
	
	while (tried < maxTries) {
		try {
			if (!isVLCwatching || !proc_vlc) { 
				await abortVLC()
				logger.debug(`setTime: aborted. is_watching'${isVLCwatching}' proc_vlc'${proc_vlc}'`)
				return true
			}
			await axios.post(
				`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=seek&val=${time}`,
				null,
				{ auth: { username: '', password: VLC_HTTP_PASS } }
			)
			
			await new Promise(resolve => setTimeout(resolve, 60))
			
			const info = await getInfo()
			const timeVLC = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
			
			if (Math.abs(time - timeVLC) <= 2) {
				logger.debug("Time synchronized successfully", time, timeVLC)
				return true
			}
			
			tried++
			await new Promise(resolve => setTimeout(resolve, 80))
		} catch (error) {
			logger.error("Failed to set time:", error.message)
			return false
		}
	}
	
	logger.warn("Time sync failed after max attempts")
	return false
}

const setPlayingVLC = async (is_playing) => {
	const command = is_playing ? "pl_play" : "pl_pause"
	
	let tried = 0
	const maxTries = 6
	
	while (tried < maxTries) {
		try {
			if (!isVLCwatching || !proc_vlc) { 
				await abortVLC()
				logger.debug(`setPlaying: aborted. is_watching'${isVLCwatching}' proc_vlc'${proc_vlc}'`)
				return true
			}
			await axios.post(
				`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=${command}`,
				null,
				{ auth: { username: '', password: VLC_HTTP_PASS } }
			)
			
			await new Promise(resolve => setTimeout(resolve, 50))
			
			const info = await getInfo()
			const isplayingVLC = info.data.state !== "paused"
			
			if (is_playing === isplayingVLC) {
				logger.debug("Play state synchronized successfully", is_playing)
				return true
			}
			
			tried++
			await new Promise(resolve => setTimeout(resolve, 60))
		} catch (error) {
			logger.error("Failed to set playing state:", error.message)
			return false
		}
	}
	
	logger.warn("Play state sync failed after max attempts")
	return false
}

// const startVideoInline = async () => {
// 	if (isInlineWatching) {
// 		logger.warn("Inline video already playing")
// 		return false
// 	}
	
// 	if (isVLCwatching) {
// 		logger.info("Stopping VLC for inline video")
// 		await abortVLC()
		
// 		let attempts = 0
// 		while (proc_vlc && attempts < 10) {
// 			await new Promise(resolve => setTimeout(resolve, 100))
// 			attempts++
// 		}
// 	}
	
// 	isInlineWatching = true
// 	videoSyncManager.setWatchingState(false, true)
	
// 	let connectionAttempts = 0
// 	while (connectionAttempts < 3) {
// 		if (await connectVideoSyncWS()) {
// 			break
// 		}
// 		connectionAttempts++
// 		if (connectionAttempts < 3) {
// 			await new Promise(resolve => setTimeout(resolve, 500))
// 		}
// 	}
		
// 	if (connectionAttempts >= 3) {
// 		logger.warn("Failed to connect to video sync")
// 		isInlineWatching = false
// 		return false
// 	}
	
// 	const r = await makeRequest_videoSync("get_playerstatus")
// 	if (!r.status) {
// 		logger.warn("Failed to get player status")
// 		isInlineWatching = false
// 		return false
// 	}
	
// 	lastSetVideoUrl = r.data.url.value
// 	mainWindow.webContents.send('inline-video-start', {
// 		url: r.data.url.value,
// 		time: r.data.time.value,
// 		isPlaying: r.data.is_playing.value
// 	})
	
// 	sendVideoStatus({
// 		status: r.data.is_playing.value ? 'playing' : 'paused',
// 		isPlaying: r.data.is_playing.value
// 	}, {
// 		currentTime: r.data.time.value,
// 		isUpToDate: true
// 	})
	
// 	startInlineMonitoring()
// 	return true
// }

// const setVideoInline = async (url) => {
// 	subtitleCache.clear()
// 	logger.info("Cleared subtitle cache - new inline video set")
	
// 	const result = await makeRequest_videoSync("update_url", {"new_url": url})
// 	if (result.status) {
// 		const processedUrl = await checkVideoUrl(url)
// 		const finalUrl = Array.isArray(processedUrl) ? processedUrl[0] : processedUrl
// 		mainWindow.webContents.send('inline-video-set', { url: finalUrl })
		
// 		if (mainWindow && mainWindow.webContents) {
// 			mainWindow.webContents.send('subtitle-status', { 
// 				subtitle_exist: false 
// 			})
// 		}
		
// 		await makeRequest_videoSync("imuptodate")
// 		isClientUpToDate = true
// 	}
// 	return result.status
// }

// const abortInline = async () => {
// 	isInlineWatching = false
// 	videoSyncManager.setWatchingState(isVLCwatching, false)
	
// 	if (inlineVideoInterval) {
// 		clearInterval(inlineVideoInterval)
// 		inlineVideoInterval = null
// 		logger.info("cleared inline video interval")
// 	}
	
// 	sendVideoStatus({
// 		status: 'stopped',
// 		isPlaying: false
// 	})
	
// 	if (!isVLCwatching) {
// 		disconnectVideoSyncWS()
// 	}
	
// 	if (mainWindow && mainWindow.webContents) {
// 		mainWindow.webContents.send('inline-video-stop')
// 	}
// 	return true
// }

// let inlineCurrentTime = 0
// let inlineIsPlaying = true
// let inlineCurrentVideo = undefined

// const startInlineMonitoring = () => {
// 	if (inlineVideoInterval) clearInterval(inlineVideoInterval)
	
// 	inlineVideoInterval = setInterval(async () => {
// 		if (!isInlineWatching) return
		
// 		if (!isClientUpToDate) {
// 			try {
// 				const statusResult = await makeRequest_videoSync("get_playerstatus")
// 				if (statusResult && statusResult.data) {
// 					const serverStatus = statusResult.data
					
// 					if (serverStatus.url && serverStatus.url.value) {
// 						mainWindow.webContents.send('inline-video-set', { url: serverStatus.url.value })
// 					}
					
// 					if (serverStatus.time && serverStatus.time.value > 0 && Math.abs(inlineCurrentTime - serverStatus.time.value) > TIME_SYNC_TOLERANCE) {
// 						mainWindow.webContents.send('inline-video-sync-time', { time: serverStatus.time.value })
// 						inlineCurrentTime = serverStatus.time.value
// 					}
					
// 					if (serverStatus.is_playing) {
// 						mainWindow.webContents.send('inline-video-sync-playing', { isPlaying: serverStatus.is_playing.value })
// 						inlineIsPlaying = serverStatus.is_playing.value
// 					}
					
// 					await makeRequest_videoSync("imuptodate")
// 					isClientUpToDate = true
// 					logger.info("Inline video synced with server")
// 				}
// 			} catch (error) {
// 				logger.warn("Failed to sync inline video with server:", error.message)
// 			}
// 		}
		
// 		try {
// 			mainWindow.webContents.send('inline-video-get-status-sync')
// 		} catch (error) {
// 			logger.error("Inline video monitoring error:", error.message)
// 		}
// 	}, 500)
// }

// ipcMain.handle('inline-video-status-response-sync', async (event, data) => {
// 	if (!isInlineWatching) return
	
// 	const { currentTime, isPlaying, currentVideo } = data
	
// 	let hasStateChanged = false
// 	let hasTimeChanged = false
// 	let hasVideoChanged = false
	
// 	if (inlineIsPlaying !== isPlaying) {
// 		hasStateChanged = true
// 		inlineIsPlaying = isPlaying
// 	}
	
// 	if (Math.abs(inlineCurrentTime - currentTime) > 1.5) {
// 		hasTimeChanged = true
// 		inlineCurrentTime = currentTime
// 	}
	
// 	if (inlineCurrentVideo !== currentVideo && currentVideo) {
// 		hasVideoChanged = true
// 		inlineCurrentVideo = currentVideo
// 	}
	
// 	sendVideoStatus({
// 		status: inlineIsPlaying ? 'playing' : 'paused',
// 		isPlaying: inlineIsPlaying
// 	}, {
// 		currentTime: currentTime,
// 		isUpToDate: isClientUpToDate
// 	})
	
// 	try {
// 		if (hasVideoChanged) {
// 			logger.debug("Inline video URL change detected")
// 			const result = await makeRequest_videoSync("update_url", {"new_url": currentVideo})
// 			if (result.status) {
// 				isClientUpToDate = true
// 			}
// 		}
		
// 		if (hasStateChanged) {
// 			logger.debug("Inline video state change detected")
// 			const result = await makeRequest_videoSync("update_isplaying", {"is_playing": isPlaying, "new_time": currentTime})
// 			if (result.status) {
// 				isClientUpToDate = true
// 			}
// 		}
		
// 		if (hasTimeChanged) {
// 			logger.debug("Inline video time change detected")
// 			const result = await makeRequest_videoSync("update_time", {"new_time": currentTime})
// 			if (result.status) {
// 				isClientUpToDate = true
// 			}
// 		}
// 	} catch (error) {
// 		logger.debug("Failed to sync inline video status:", error.message)
// 	}
// })

const openVLC = async () => {
	return await new Promise(async (resolve, reject) => {
		if (modeTransitionLock) {
			logger.warn("Mode transition in progress, please wait")
			return resolve(false)
		}
		
		if (isVLCwatching) {
			logger.warn("VLC already playing")
			return resolve(false)
		}
		if (!VLC_PATH || !fs.existsSync(VLC_PATH)) {
			logger.error(`VLC path invalid or not found: ${VLC_PATH}`)
			return reject(new Error('VLC path invalid or not found'))
		}
		
		modeTransitionLock = true
		
		try {
			// if (isInlineWatching) {
			// 	logger.info("Stopping inline video for VLC")
			// 	await abortInline()
				
			// 	let attempts = 0
			// 	while (isInlineWatching && attempts < 10) {
			// 		await new Promise(resolve => setTimeout(resolve, 100))
			// 		attempts++
			// 	}
			// }

			isVLCwatching = true
			videoSyncManager.setWatchingState(true, false)

			let connectionAttempts = 0
			while (connectionAttempts < 3) {
				if (await connectVideoSyncWS()) {
					break
				}
				connectionAttempts++
				if (connectionAttempts < 3) {
					await new Promise(resolve => setTimeout(resolve, 500))
				}
			}
			
			if (connectionAttempts >= 3) {
				logger.warn("Failed to connect to video sync after 3 attempts")
				return resolve(false)
			}

			const r = await makeRequest_videoSync("get_playerstatus")
			if (!r.status) {
				logger.warn("Failed to get player status")
				await abortVLC()
				return resolve(false)
			}
			
			let CURRENT_VIDEO_SERVER = r.data.url.value
			const SERVER_IS_PLAYING = r.data.is_playing.value
			const SERVER_TIME = r.data.time.value
			lastSetVideoUrl = CURRENT_VIDEO_SERVER
			
			if (!CURRENT_VIDEO_SERVER || !isValidVideoUrl(CURRENT_VIDEO_SERVER)) {
				logger.warn("No valid video URL from server")
				await abortVLC()
				return resolve(false)
			}
			
			let VLC_ARGS = [
				`--intf`, `qt`,
				`--extraintf`, `http`,
				`--http-port`, `${VLC_PORT}`,
				`--http-password`, `${VLC_HTTP_PASS}`,
				`--avcodec-hw`, `none`,
				`--start-time`, SERVER_TIME,
				`--http-reconnect`,
				`--video-on-top`,
				`--no-one-instance`
			]
			
			let isYouTubeUrl = false
			for (const ytorigin of YOUTUBE_URLS) {
				if (CURRENT_VIDEO_SERVER.startsWith(ytorigin)) {
					isYouTubeUrl = true
					break
				}
			}
			
			if (isYouTubeUrl) {
				logger.info("Processing YouTube URL for VLC startup:", CURRENT_VIDEO_SERVER)
				const processedUrl = await checkVideoUrl(CURRENT_VIDEO_SERVER)
				if (Array.isArray(processedUrl) && processedUrl.length === 2) {
					logger.info("ytvideo with 2 urls")
					const url1 = processedUrl[0]
					const url2 = processedUrl[1]
					if (isValidVideoUrl(url1) && isValidVideoUrl(url2)) {
						VLC_ARGS.push('--no-video-title-show', url1, `--input-slave=${url2}`)
					} else if (isValidVideoUrl(url1)) {
						VLC_ARGS.push('--no-video-title-show', url1)
					}
				} else {
					logger.info("ytvideo with 1 url")
					const url1 = Array.isArray(processedUrl) ? processedUrl[0] : processedUrl
					if (isValidVideoUrl(url1)) VLC_ARGS.push('--no-video-title-show', url1)
				}
			} else if (CURRENT_VIDEO_SERVER && isValidVideoUrl(CURRENT_VIDEO_SERVER)) {
				logger.info("not a ytvideo")
				VLC_ARGS.push(CURRENT_VIDEO_SERVER)
			}

			logger.info("vlcargs:", VLC_ARGS)
			proc_vlc = spawn(VLC_PATH, VLC_ARGS)
			proc_vlc.on('spawn', async () => {
				logger.info("VLC spawned!")
				await startVLCMonitoring()
				if (!SERVER_IS_PLAYING) {
					let attempts = 0
					while (attempts < 20) {
						try {
							await setPlayingVLC(false)
							break
						} catch (err) {
							attempts++
							if (attempts >= 20) {
								logger.warn("Failed to pause VLC after startup:", err.message)
							} else {
								await new Promise(resolve => setTimeout(resolve, 100))
							}
						}
					}
				}
			})

			proc_vlc.on('error', async (error) => {
				logger.error(`VLC error: ${error.message}`)
				await abortVLC()
				reject(`VLC launch error: ${error.message}`)
			})

			proc_vlc.on('close', async (code) => {
				logger.info(`VLC closed with code'${code}'`)
				if (code === 0) {
					await abortVLC()
					resolve('VLC exited successfully')
				} else {
					resolve(`VLC exited with code ${code}`)
				}
			})
		
		} finally {
			modeTransitionLock = false
		}
	})
}

const startVLCMonitoring = async () => {
	logger.info(`VLC monitoring started. isvlcwatching'${isVLCwatching}' proc_vlc.pid'${proc_vlc ? proc_vlc.pid : 'null'}'`,)
	if (!isVLCwatching){
		logger.info("isVLCwatching was false. setting it to true.")
		isVLCwatching = true
	}
	if (vlcInterval) clearInterval(vlcInterval)
	if (serverInterval) clearInterval(serverInterval)

	let currentState = undefined
	let currentTime = undefined
	let currentVideo = undefined
	let lastSentTime = undefined
	let isplayingVLC = undefined

	let attempts = 0
	const maxAttempts = 200
	
	while (attempts < maxAttempts){
		try{
			const r = await getInfo()
			if (r.data.length !== -1){
				logger.info("VLC is ready after", attempts * 30, "ms")
				break
			}
		} catch {
		}
		await new Promise(resolve => setTimeout(resolve, 25))
		attempts++
	}
	
	if (attempts >= maxAttempts) {
		logger.warn("VLC took too long to initialize")
		return false
	}

	let initialIsPlaying = true
	try {
		const statusResult = await makeRequest_videoSync("get_playerstatus")
		if (statusResult && statusResult.data && statusResult.data.is_playing) {
			initialIsPlaying = statusResult.data.is_playing.value
		}
	} catch (error) {
		logger.debug("Could not get initial server state, defaulting to playing")
	}

	sendVideoStatus({
		status: initialIsPlaying ? 'playing' : 'paused',
		isPlaying: initialIsPlaying
	}, {
		currentTime: 0,
		isUpToDate: isClientUpToDate
	})

	rsub = await requestSubtitle()
	logger.info("requestSubtitle:", rsub)
	await setTimeVLC(0)

	vlcInterval = setInterval(async () => {
		if (!isVLCwatching || !proc_vlc) { 
			logger.debug(`startVLCmonitoring: aborted. is_watching'${isVLCwatching}' proc_vlc.pid'${proc_vlc.pid}'`)
			await abortVLC()
			return
		}

		if (!isClientUpToDate) {
			try {
				const statusResult = await makeRequest_videoSync("get_playerstatus")
				if (statusResult && statusResult.data) {
					const serverStatus = statusResult.data
					
					try {
						const info = await getInfo()
						currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
						const currentlyPlaying = info.data.state !== "paused"
						currentState = info.data.state
						
						try {
							const currentUrl = await getVideoUrl_VLC()
							if (serverStatus.url && serverStatus.url.value && currentUrl) {
								let shouldUpdateVideo = false
								
								if (isYouTubeUrl(serverStatus.url.value)) {
									const cachedUrls = youtubeUrlCache.get(serverStatus.url.value)
									if (cachedUrls && cachedUrls.urls) {
										shouldUpdateVideo = !cachedUrls.urls.includes(currentUrl)
									} else {
										shouldUpdateVideo = currentUrl !== serverStatus.url.value
									}
								} else {
									shouldUpdateVideo = currentUrl !== serverStatus.url.value
								}
								
								if (shouldUpdateVideo) {
									currentVideo = serverStatus.url.value
									await setVideoVLC(serverStatus.url.value)
								}
							}
						} catch (urlError) {
							logger.error(urlError)
							return
						}
						
						if (serverStatus.time && serverStatus.time.value > 0 && Math.abs(currentTime - serverStatus.time.value) > TIME_SYNC_TOLERANCE) {
							await setTimeVLC(serverStatus.time.value)
							currentTime = serverStatus.time.value
							lastSentTime = serverStatus.time.value
						}
						
						if (serverStatus.is_playing && currentlyPlaying !== serverStatus.is_playing.value) {
							await setPlayingVLC(serverStatus.is_playing.value)
							currentState = serverStatus.is_playing.value ? "playing" : "paused"
						}
					} catch (vlcError) {
						logger.debug("VLC not ready, trying again.")
						return
					}
					await makeRequest_videoSync("imuptodate")
					isClientUpToDate = true
					logger.info("sent imuptodate and marked isclientuptodate true.")
					
					try {
						const info = await getInfo()
						currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
						const isPlaying = info.data.state !== "paused"
						currentState = info.data.state
						sendVideoStatus({
							status: isPlaying ? 'playing' : 'paused',
							isPlaying: isPlaying
						}, {
							currentTime: currentTime,
							isUpToDate: true
						})
					} catch (err) {
						logger.debug("Could not send VLC status after sync:", err.message)
					}
				} else {
					// connect to the videosyncwss again
					await connectVideoSyncWS()
				}
			} catch (error) {
				logger.warn("Failed to sync with server:", error.message)
			}
			return
		}
		
		try {
			const infoVLC = await getInfo()
			const stateVLC = infoVLC.data.state
			
			if (stateVLC === "stopped"){
				return
			}
			
			if (currentState === undefined){
				currentState = stateVLC
			}
			
			const timeVLC = Math.floor(parseFloat(infoVLC.data.length) * parseFloat(infoVLC.data.position))
			if (currentTime === undefined || lastSentTime === undefined){
				currentTime = timeVLC
				lastSentTime = timeVLC
			}
			isplayingVLC = stateVLC !== "paused"

			sendVideoStatus({
				status: isplayingVLC ? 'playing' : 'paused',
				isPlaying: isplayingVLC
			}, {
				currentTime: timeVLC,
				isUpToDate: isClientUpToDate
			})

			let videoVLC
			try {
				videoVLC = await getVideoUrl_VLC()
			} catch (error) {
				logger.warn("Failed to get VLC video URL:", error.message)
				videoVLC = currentVideo
			}

			if (currentVideo === undefined){
				currentVideo = videoVLC
			}

			let is_serverURLyoutube = false
			for (const ytorigin of YOUTUBE_URLS) {
				if (currentVideo && currentVideo.startsWith(ytorigin)) {
					is_serverURLyoutube = true
					break
				}
			}

			if (!is_serverURLyoutube && videoVLC !== currentVideo) {
				logger.debug("VLC video change detected")
				await setTimeVLC(0)
				currentTime = 0
				lastSentTime = 0
				const result = await setVideoToServer(videoVLC)
				if (result.status) {
					currentVideo = videoVLC
				} else if (!result.skipped) {
					logger.debug("video change error:", result)
					isClientUpToDate = false
					return
				}
			}
			
			if (currentState !== stateVLC) {
				if (!videoSyncManager.isConnected()) {
					return
				}
				logger.debug("VLC state change detected")
				const result = await makeRequest_videoSync("update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
				if (result.status && result.data.status) {
					currentState = stateVLC
				} else {
					logger.debug("state change error:", result)
					isClientUpToDate = false
					return
				}
			}
			
			if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 1.5) {
				if (!videoSyncManager.isConnected()) {
					return
				}
				logger.debug(`VLC seek detected currentTime${currentTime} timeVLC${timeVLC}`)
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC})
				logger.debug(result)
				if (result.status && result.data.status) {
					lastSentTime = timeVLC
					currentTime = timeVLC
				} else {
					logger.debug("seek change error:", result)
					isClientUpToDate = false
					return
				}
			}
			
			if (timeVLC !== 0 && Math.abs(lastSentTime - timeVLC) > 5) {
				if (!videoSyncManager.isConnected()) {
					return
				}
				logger.debug(`sending regular update, lastSentTime'${lastSentTime}' timeVLC'${timeVLC}'`)
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC, "timeout_pass": true})
				if (result.status && result.data.status) {
					lastSentTime = timeVLC
				} else {
					logger.debug("regular update_time error:", result)
					isClientUpToDate = false
					return
				}
			}

			currentVideo = videoVLC
			if (currentState !== "ended") {
				currentTime = timeVLC
			}
			
		} catch (err) {
			if (err.message.includes("connect ECONNREFUSED")) {
				logger.warn("VLC connection refused")
			} else if (err.message.includes("socket hang up")){
				logger.warn("VLC socket hung up")
			} else {
				logger.error("VLC monitoring error:", err.message)
			}
			abortVLC()
		}
	}, 500)
}

ipcMain.handle('open-vlc', async (event) => {
	return await openVLC()
})

// ipcMain.handle('start-inline-video', async (event) => {
// 	return await startVideoInline()
// })

// ipcMain.handle('set-inline-video', async (event, url) => {
// 	try {
// 		url = url.trim()
// 		logger.info("update_url inline", url)
// 		return await setVideoInline(url)
// 	} catch (error) {
// 		logger.error("Error in set-inline-video:", error)
// 		return false
// 	}
// })

// ipcMain.handle('stop-inline-video', async (event) => {
// 	return await abortInline()
// })

ipcMain.handle('stop-vlc', async (event) => {
	return await abortVLC()
})

ipcMain.handle('set-subtitle', async (event, fileData, fileName) => {
	const MAX_SUBTITLE_SIZE = 10 * 1024 * 1024
	try {
		let buffer
		if (Array.isArray(fileData)) {
			buffer = Buffer.from(fileData)
		} else if (fileData && fileData instanceof ArrayBuffer) {
			buffer = Buffer.from(fileData)
		} else if (fileData && Buffer.isBuffer(fileData)) {
			buffer = fileData
		} else {
			try { buffer = Buffer.from(fileData) } catch (e) { buffer = null }
		}
		if (!buffer) {
			logger.error('set-subtitle: invalid fileData')
			return false
		}
		if (buffer.length > MAX_SUBTITLE_SIZE) {
			logger.error('set-subtitle: file too large')
			return false
		}
		const base64Data = buffer.toString('base64')
		const result = await makeRequest_videoSync("update_subtitle", {
			"subtitle_data": base64Data,
			"filename": fileName
		})
		return result.status
	} catch (error) {
		logger.error("Error setting subtitle:", error)
		return false
	}
})

ipcMain.handle('add-subtitle-vlc', async (event, filePath) => {
	try {
		const success = await addSubtitleToVLC(filePath)
		return success
	} catch (error) {
		logger.error("Failed to add subtitle to VLC:", error.message)
		return false
	}
})

ipcMain.handle('upload-subtitle', async (event, arrayBuffer, filename) => {
	const MAX_SUBTITLE_SIZE = 10 * 1024 * 1024
	try {
		const subtitleBuffer = Buffer.from(arrayBuffer)
		if (subtitleBuffer.length > MAX_SUBTITLE_SIZE) {
			logger.error('upload-subtitle: file too large')
			return { success: false, error: 'File too large' }
		}
		const safeId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
		
		subtitleCache.set(safeId, subtitleBuffer)
		
		if (isVLCwatching) {
			const tempPath = path.join(os.tmpdir(), `vlc_sub_${safeId}.srt`)
			fs.writeFileSync(tempPath, subtitleBuffer)
			
			const success = await addSubtitleToVLC(tempPath)
			if (!success) {
				logger.warn("Failed to add uploaded subtitle to VLC after retries")
			}
			
			setTimeout(() => {
				try { fs.unlinkSync(tempPath) } catch {}
			}, 5000)
		}
		
		const base64Data = subtitleBuffer.toString('base64')
		await makeRequest_videoSync("update_subtitle", { 
			filename: filename,
			subtitle_data: base64Data
		})
		
		return { success: true }
	} catch (error) {
		logger.error("Failed to upload subtitle:", error.message)
		return { success: false, error: error.message }
	}
})

const requestSubtitle = async ()=>{
	try {
		const result = await makeRequest_videoSync("request_subtitle", {})
		return { success: result.status, error: result.error }
	} catch (error) {
		logger.error("Failed to request subtitles:", error.message)
		return { success: false, error: error.message }
	}
}

ipcMain.handle('request-subtitles', async (event) => {
	return await requestSubtitle()
})

ipcMain.handle('get-update-info', async (event) => {
	if (updateManager) {
		return updateManager.getUpdateInfo()
	}
	return null
})

ipcMain.handle('download-update', async (event) => {
	if (updateManager) {
		return await updateManager.downloadUpdate()
	}
	return false
})

ipcMain.handle('install-update', async (event) => {
	if (updateManager) {
		return await updateManager.installUpdate()
	}
	return false
})

ipcMain.handle('quit-app', async (event) => {
	app.quit()
})

app.whenReady().then(() => {
	createWindow()
})

app.on('window-all-closed', async () => {
	if (networkMonitorInterval) {
		clearInterval(networkMonitorInterval)
		networkMonitorInterval = null
	}
	await abortVLC()
	if (process.platform !== 'darwin') {
		app.quit()
	}
})