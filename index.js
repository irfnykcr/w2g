const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const keytar = require('keytar')
const { Menu } = require('electron')
const { create: createYoutubeDl } = require('youtube-dl-exec')
const WebSocket = require('ws')
const UpdateManager = require('./updateManager')

// const bcrypt = require('bcryptjs')
// console.log(bcrypt.hashSync("123", 10))
// process.exit()

// keytar.deletePassword("turkuazz","user")
// keytar.deletePassword("turkuazz","userpsw")

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

const isDev = !app.isPackaged

const ytdl_binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
const ytdl_binPath = isDev ? path.join(
	process.resourcesPath,
	'app.asar.unpacked',
	'node_modules',
	'youtube-dl-exec',
	'bin',
	ytdl_binName
) :  path.join(
	__dirname,
	'node_modules',
	'youtube-dl-exec',
	'bin',
	ytdl_binName
)
logger.debug("ytdl_path:", ytdl_binPath)
const youtubedl = createYoutubeDl(ytdl_binPath)




const subtitleCache = new Map()

const selectSubtitleForVlc = async (retries_left = 5) => {
	if (retries_left<=0){
		logger.error(`selectSubtitleForVlc: could not select subtitle.`)
		return false
	}
	logger.info(`selectSubtitleForVlc: retries_left'${retries_left}'`)
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
				await new Promise(resolve => setTimeout(resolve, 300))
				return selectSubtitleForVlc(retries_left-1)
			}
		}
	} catch (enableError) {
		logger.warn("Failed to enable subtitle:", enableError.message)
		await new Promise(resolve => setTimeout(resolve, 300))
		return selectSubtitleForVlc(retries_left-1)
	}
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

let appConfig = {}
if (!fs.existsSync(appConfigPath)) {
	logger.error("config not found")
	process.exit()
}

const configData = fs.readFileSync(appConfigPath, 'utf-8')
appConfig = JSON.parse(configData)
logger.info('Loaded app config:', appConfig)

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
			ROOMID = await keytar.getPassword("turkuazz", "roomid")
			if (ROOMID === null) {return false}
		} catch {
			return false
		}
	}
	try{
		_roompsw = await keytar.getPassword("turkuazz", "roompsw")
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
	await keytar.setPassword('turkuazz', "roomid", roomid)
	await keytar.setPassword('turkuazz', "roompsw", roompsw)
	return true
})
ipcMain.handle('left-room', async (event) => {
	await abortVLC()
	await keytar.deletePassword('turkuazz', "roomid")
	await keytar.deletePassword('turkuazz', "roompsw")
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
			USERID = await keytar.getPassword("turkuazz", "user")
			if (USERID === null) {return false}
		} catch {
			return false
		}
	}
	try{
		_userpsw = await keytar.getPassword("turkuazz", "userpsw")
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
	await keytar.setPassword("turkuazz", "user", user)
	await keytar.setPassword("turkuazz", "userpsw", userpsw)
	return true
})
ipcMain.handle('logout-user', async (event) => {
	await abortVLC()
	USERID = null
	ROOMID = null
	await keytar.deletePassword('turkuazz', "roomid")
	await keytar.deletePassword('turkuazz', "roompsw")
	await keytar.deletePassword('turkuazz', "user")
	await keytar.deletePassword('turkuazz', "userpsw")
	return true
})



let mainWindow
let proc_vlc
let isVLCwatching = false
let currentVLCStatus = { status: 'stopped', isPlaying: false }
let vlcInterval
let serverInterval
let inlineVideoInterval
let isInlineWatching = false
let modeTransitionLock = false

let videoSyncWS = null
let pendingWsRequests = new Map()
let wsRequestId = 0
let isClientUpToDate = false
let lastConnectionAttempt = 0
let reconnectCount = 0

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
	
	win.loadFile(path.join(__dirname, 'views/login.html'))
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
				is_uptodate: additionalData.isUpToDate || false
			}
		}
		return true
	} catch {
		logger.error("sendVideoStatus: there was a problem.")
		return false
	}
}

const connectVideoSyncWS = async () => {
	if (videoSyncWS && videoSyncWS.readyState === WebSocket.OPEN) {
		return true
	}
	
	const now = Date.now()
	if (now - lastConnectionAttempt < 5000) {
		return false
	}
	
	lastConnectionAttempt = now
	
	if (videoSyncWS) {
		videoSyncWS.close()
		videoSyncWS = null
	}
	
	if (!USERID || !ROOMID) {
		logger.warn("Cannot connect to video sync: missing user or room")
		return false
	}
	
	try {
		const userpsw = await keytar.getPassword("turkuazz", "userpsw")
		const roompsw = await keytar.getPassword("turkuazz", "roompsw")
		
		const wsUrl = `wss://${SERVER_ENDPOINT}/videosync/?user=${encodeURIComponent(USERID)}&psw=${encodeURIComponent(userpsw)}&roomid=${encodeURIComponent(ROOMID)}&roompsw=${encodeURIComponent(roompsw)}`
		
		videoSyncWS = new WebSocket(wsUrl)
		
		return new Promise((resolve) => {
			logger.info("trying to connect to websocket..")
			videoSyncWS.on('open', () => {
				logger.info("Video sync WebSocket connected")
				isClientUpToDate = false
				reconnectCount = 0
				if (mainWindow && mainWindow.webContents) {
					mainWindow.webContents.send('video-sync-status', { connected: true })
				}
				resolve(true)
			})
			
			videoSyncWS.on('message', async (data) => {
				try {
					const message = JSON.parse(data.toString())
					await handleVideoSyncMessage(message)
				} catch (e) {
					logger.error("Failed to parse WebSocket message:", e.message)
				}
			})
			
			videoSyncWS.on('close', async () => {
				logger.warn("Video sync WebSocket disconnected")
				for (const [id, { reject }] of pendingWsRequests.entries()) {
					try { reject(new Error('WebSocket closed')) } catch {}
				}
				pendingWsRequests.clear()
				videoSyncWS = null
				isClientUpToDate = false
				if (mainWindow && mainWindow.webContents) {
					mainWindow.webContents.send('video-sync-status', { connected: false })
				}
				if (isVLCwatching || isInlineWatching) {
					reconnectCount++
					if (reconnectCount > 2) {
						logger.warn("Too many reconnect attempts, stopping VLC")
						await abortVLC()
						return
					}
					setTimeout(() => {
						connectVideoSyncWS()
					}, 5000)
				}
			})
			
			videoSyncWS.on('error', (error) => {
				logger.error("Video sync WebSocket error:", error.message)
				for (const [id, { reject }] of pendingWsRequests.entries()) {
					try { reject(new Error('WebSocket error: ' + error.message)) } catch {}
				}
				pendingWsRequests.clear()
				if (mainWindow && mainWindow.webContents) {
					mainWindow.webContents.send('video-sync-status', { connected: false })
				}
				resolve(false)
			})
		})
		
	} catch (error) {
		logger.error("Failed to connect video sync WebSocket:", error.message)
		return false
	}
}

const disconnectVideoSyncWS = () => {
	sendVideoStatus({
		status: 'stopped',
		isPlaying: false
	})
	if (videoSyncWS) {
		videoSyncWS.close()
		videoSyncWS = null
	}
	logger.info("disconnectVideoSyncWS: successful.")
}

const sendVideoSyncMessage = async (message) => {
	if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
		logger.warn("Video sync WebSocket not connected")
		return null
	}
	if (!isVLCwatching && !isInlineWatching) { 
		logger.debug(`sendVideoSyncMessage: aborted. is_watching'${isVLCwatching}' isInlineWatching'${isInlineWatching}'`)
		return true
	}	const requestId = ++wsRequestId
	message.requestId = requestId
	
	return new Promise((resolve, reject) => {
		pendingWsRequests.set(requestId, { resolve, reject })
		
		setTimeout(() => {
			if (pendingWsRequests.has(requestId)) {
				pendingWsRequests.delete(requestId)
				reject(new Error("WebSocket request timeout"))
			}
		}, 3000)
		
		try {
			if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
				throw new Error('WebSocket not open')
			}
			videoSyncWS.send(JSON.stringify(message))
		} catch (err) {
			pendingWsRequests.delete(requestId)
			reject(err)
		}
	})
}

const handleVideoSyncMessage = async (message) => {
	if (!isVLCwatching){
		logger.warn(`isVLCwatching'${isVLCwatching}' proc_vlc'${proc_vlc}'(notincheck)`)
		return
	}
	const { type, requestId } = message
	
	if (requestId && pendingWsRequests.has(requestId)) {
		const { resolve } = pendingWsRequests.get(requestId)
		pendingWsRequests.delete(requestId)
		
		if (type === 'update_response') {
			resolve({ status: message.success, error: message.error })
		} else if (type === 'playerstatus_response') {
			resolve({ status: true, data: message.data })
		} else {
			resolve(message)
		}
		return
	}
	
	if (type === 'initial_state') {
		logger.info("Received initial state from server")
		isClientUpToDate = false
		
		if (mainWindow && mainWindow.webContents) {
			mainWindow.webContents.send('subtitle-status', { 
				subtitle_exist: message.subtitle_exist || false 
			})
			
			if (!message.subtitle_exist) {
				subtitleCache.clear()
				logger.info("Cleared subtitle cache - no subtitles exist")
			}
		}
	}
	else if (type === 'connected') {
		logger.info("Connected to video sync server")
	}
	else if (type === 'url_updated') {
		logger.info("Server video URL updated:", message.url)
		if (message.user !== USERID) {
			isClientUpToDate = false
			
			subtitleCache.clear()
			logger.info("Cleared subtitle cache - video URL changed")
			
			if (mainWindow && mainWindow.webContents) {
				mainWindow.webContents.send('subtitle-status', { 
					subtitle_exist: message.subtitle_exist || false 
				})
			}
		}
	}
	else if (type === 'time_updated') {
		logger.info("Server time updated:", message.time)
		if (message.user !== USERID) {
			isClientUpToDate = false
		}
	}
	else if (type === 'playing_updated') {
		logger.info("Server playing state updated:", message.is_playing)
		if (message.user !== USERID) {
			isClientUpToDate = false
		}
	}
	else if (type === 'subtitle_updated') {
		logger.info("Server subtitle updated:", message.filename)
		
		try {
			const subtitleBuffer = Buffer.from(message.subtitle_data, 'base64')
			
			subtitleCache.set(message.filename, subtitleBuffer)
			
			if (isVLCwatching) {
				const tempPath = path.join(require('os').tmpdir(), `vlc_subtitle_${Date.now()}_${message.filename}`)
				fs.writeFileSync(tempPath, subtitleBuffer)
				
				const success = await addSubtitleToVLC(tempPath)
				if (!success) {
					logger.warn("Failed to add subtitle to VLC after retries")
				}
				
				setTimeout(() => {
					try { fs.unlinkSync(tempPath) } catch {}
				}, 1000)
			}
			
			if (mainWindow && mainWindow.webContents) {
				mainWindow.webContents.send('subtitle-received', { 
					filename: message.filename 
				})
				mainWindow.webContents.send('subtitle-status', { 
					subtitle_exist: true 
				})
			}
		} catch (error) {
			logger.error("Failed to save/add subtitle:", error.message)
		}
		
		if (message.user !== USERID) {
			isClientUpToDate = false
		}
	}
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
		return {status: false, message:`useridid, roomid, ${USERID}, ${ROOMID}`}
	}
	json.userid = USERID
	json.userpsw = await keytar.getPassword("turkuazz", "userpsw")
	json.roomid = ROOMID
	json.roompsw = await keytar.getPassword("turkuazz", "roompsw")
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
	try {
		if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
			logger.warn(`VideoSync request failed: WebSocket not connected (${type})`)
			return { status: false, error: "WebSocket not connected" }
		}
		if (!isVLCwatching && !isInlineWatching) { 
			logger.debug(`makeRequest_videoSync: aborted. is_watching'${isVLCwatching}' isInlineWatching'${isInlineWatching}'`)
			return true
		}
		
		const message = { type, ...data }
		const response = await sendVideoSyncMessage(message)
		
		if (type.startsWith('update_') && response.success === false && 
			response.error && response.error.includes("not authorized")) {
			logger.debug("Update rejected, user not up to date. Attempting sync...")
			
			try {
				const statusResult = await sendVideoSyncMessage({ type: "get_playerstatus" })
				if (statusResult.data) {
					await sendVideoSyncMessage({ type: "imuptodate" })
					logger.debug("Marked as up to date after sync check")
				}
			} catch (syncError) {
				logger.warn("Failed to sync:", syncError.message)
			}
			
			return { status: false, error: "User not up to date, sync attempted" }
		}
		
		return { status: response.success !== false, data: response.data || response }
	} catch (error) {
		logger.error(`VideoSync request error: ${type}`, error.message)
		if (error.message.includes("timeout") && videoSyncWS) {
			logger.warn("WebSocket timeout detected, force terminating connection")
			try {
				videoSyncWS.terminate()
			} catch {
				videoSyncWS.close()
			}
			videoSyncWS = null
			for (const [id, { reject }] of pendingWsRequests.entries()) {
				try { reject(new Error('Connection terminated')) } catch {}
			}
			pendingWsRequests.clear()
		}
		return { status: false, error: error.message }
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
				format: 'bv*[height=1080][ext=webm]+ba',
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
			logger.warn("YouTube URL processing failed:", e.message)
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
						logger.info("video changed!")
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

ipcMain.handle('setvideo-vlc', async (_, url) => {
	try {
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('Invalid URL provided')
		}
		logger.info("update_url", url)
		
		subtitleCache.clear()
		logger.info("Cleared subtitle cache - new video set")
		
		const result = await makeRequest_videoSync("update_url", {"new_url": url})
		
		if (result.status) {
			await setVideoVLC(url)
			
			if (mainWindow && mainWindow.webContents) {
				mainWindow.webContents.send('subtitle-status', { 
					subtitle_exist: false 
				})
			}
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

const startVideoInline = async () => {
	if (isInlineWatching) {
		logger.warn("Inline video already playing")
		return false
	}
	
	if (isVLCwatching) {
		logger.info("Stopping VLC for inline video")
		await abortVLC()
		
		let attempts = 0
		while (proc_vlc && attempts < 10) {
			await new Promise(resolve => setTimeout(resolve, 100))
			attempts++
		}
	}
	
	isInlineWatching = true
	
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
		logger.warn("Failed to connect to video sync")
		isInlineWatching = false
		return false
	}
	
	const r = await makeRequest_videoSync("get_playerstatus")
	if (!r.status) {
		logger.warn("Failed to get player status")
		isInlineWatching = false
		return false
	}
	
	mainWindow.webContents.send('inline-video-start', {
		url: r.data.url.value,
		time: r.data.time.value,
		isPlaying: r.data.is_playing.value
	})
	
	sendVideoStatus({
		status: r.data.is_playing.value ? 'playing' : 'paused',
		isPlaying: r.data.is_playing.value
	}, {
		currentTime: r.data.time.value,
		isUpToDate: true
	})
	
	startInlineMonitoring()
	return true
}

const setVideoInline = async (url) => {
	subtitleCache.clear()
	logger.info("Cleared subtitle cache - new inline video set")
	
	const result = await makeRequest_videoSync("update_url", {"new_url": url})
	if (result.status) {
		const processedUrl = await checkVideoUrl(url)
		const finalUrl = Array.isArray(processedUrl) ? processedUrl[0] : processedUrl
		mainWindow.webContents.send('inline-video-set', { url: finalUrl })
		
		if (mainWindow && mainWindow.webContents) {
			mainWindow.webContents.send('subtitle-status', { 
				subtitle_exist: false 
			})
		}
		
		await makeRequest_videoSync("imuptodate")
		isClientUpToDate = true
	}
	return result.status
}

const stopVideoInline = async () => {
	isInlineWatching = false
	
	if (inlineVideoInterval) {
		clearInterval(inlineVideoInterval)
		inlineVideoInterval = null
		logger.info("cleared inline video interval")
	}
	
	sendVideoStatus({
		status: 'stopped',
		isPlaying: false
	})
	
	if (!isVLCwatching) {
		disconnectVideoSyncWS()
	}
	
	if (mainWindow && mainWindow.webContents) {
		mainWindow.webContents.send('inline-video-stop')
	}
	return true
}

let inlineCurrentTime = 0
let inlineIsPlaying = true
let inlineCurrentVideo = undefined

const startInlineMonitoring = () => {
	if (inlineVideoInterval) clearInterval(inlineVideoInterval)
	
	inlineVideoInterval = setInterval(async () => {
		if (!isInlineWatching) return
		
		if (!isClientUpToDate) {
			try {
				const statusResult = await sendVideoSyncMessage({ type: "get_playerstatus" })
				if (statusResult && statusResult.data) {
					const serverStatus = statusResult.data
					
					if (serverStatus.url && serverStatus.url.value) {
						mainWindow.webContents.send('inline-video-set', { url: serverStatus.url.value })
					}
					
					if (serverStatus.time && serverStatus.time.value > 0 && Math.abs(inlineCurrentTime - serverStatus.time.value) > TIME_SYNC_TOLERANCE) {
						mainWindow.webContents.send('inline-video-sync-time', { time: serverStatus.time.value })
						inlineCurrentTime = serverStatus.time.value
					}
					
					if (serverStatus.is_playing) {
						mainWindow.webContents.send('inline-video-sync-playing', { isPlaying: serverStatus.is_playing.value })
						inlineIsPlaying = serverStatus.is_playing.value
					}
					
					await sendVideoSyncMessage({ type: "imuptodate" })
					isClientUpToDate = true
					logger.info("Inline video synced with server")
				}
			} catch (error) {
				logger.warn("Failed to sync inline video with server:", error.message)
			}
		}
		
		try {
			mainWindow.webContents.send('inline-video-get-status-sync')
		} catch (error) {
			logger.error("Inline video monitoring error:", error.message)
		}
	}, 500)
}

ipcMain.handle('inline-video-status-response-sync', async (event, data) => {
	if (!isInlineWatching) return
	
	const { currentTime, isPlaying, currentVideo } = data
	
	let hasStateChanged = false
	let hasTimeChanged = false
	let hasVideoChanged = false
	
	if (inlineIsPlaying !== isPlaying) {
		hasStateChanged = true
		inlineIsPlaying = isPlaying
	}
	
	if (Math.abs(inlineCurrentTime - currentTime) > 1.5) {
		hasTimeChanged = true
		inlineCurrentTime = currentTime
	}
	
	if (inlineCurrentVideo !== currentVideo && currentVideo) {
		hasVideoChanged = true
		inlineCurrentVideo = currentVideo
	}
	
	sendVideoStatus({
		status: inlineIsPlaying ? 'playing' : 'paused',
		isPlaying: inlineIsPlaying
	}, {
		currentTime: currentTime,
		isUpToDate: isClientUpToDate
	})
	
	try {
		if (hasVideoChanged) {
			logger.debug("Inline video URL change detected")
			const result = await makeRequest_videoSync("update_url", {"new_url": currentVideo})
			if (result.status) {
				isClientUpToDate = true
			}
		}
		
		if (hasStateChanged) {
			logger.debug("Inline video state change detected")
			const result = await makeRequest_videoSync("update_isplaying", {"is_playing": isPlaying, "new_time": currentTime})
			if (result.status) {
				isClientUpToDate = true
			}
		}
		
		if (hasTimeChanged) {
			logger.debug("Inline video time change detected")
			const result = await makeRequest_videoSync("update_time", {"new_time": currentTime})
			if (result.status) {
				isClientUpToDate = true
			}
		}
	} catch (error) {
		logger.debug("Failed to sync inline video status:", error.message)
	}
})

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
			if (isInlineWatching) {
				logger.info("Stopping inline video for VLC")
				await stopVideoInline()
				
				let attempts = 0
				while (isInlineWatching && attempts < 10) {
					await new Promise(resolve => setTimeout(resolve, 100))
					attempts++
				}
			}

			isVLCwatching = true

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
					VLC_ARGS.push('--no-video-title-show', processedUrl[0], `:input-slave=${processedUrl[1]}`)
				} else {
					logger.info("ytvideo with 1 url")
					VLC_ARGS.push('--no-video-title-show', Array.isArray(processedUrl) ? processedUrl[0] : processedUrl)
				}
			} else {
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
		const statusResult = await sendVideoSyncMessage({ type: "get_playerstatus" })
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
				const statusResult = await sendVideoSyncMessage({ type: "get_playerstatus" })
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
					await sendVideoSyncMessage({ type: "imuptodate" })
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
				const result = await makeRequest_videoSync("update_url", {"new_url": videoVLC})
				if (result.status) {
					currentVideo = videoVLC
					// isClientUpToDate = true
				}
			}
			
			if (currentState !== stateVLC) {
				if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
					return
				}
				logger.debug("VLC state change detected")
				const result = await makeRequest_videoSync("update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
				if (result.status) {
					currentState = stateVLC
					// isClientUpToDate = true
				}
			}
			
			if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 1.5) {
				if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
					return
				}
				logger.debug(`VLC seek detected currentTime${currentTime} timeVLC${timeVLC}`)
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC})
				if (result.status) {
					lastSentTime = timeVLC
					currentTime = timeVLC
					// isClientUpToDate = true
				}
			}
			
			if (timeVLC !== 0 && Math.abs(lastSentTime - timeVLC) > 5) {
				if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
					return
				}
				logger.debug(`sending regular update, lastSentTime'${lastSentTime}' timeVLC'${timeVLC}'`)
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC})
				if (result.status) {
					lastSentTime = timeVLC
					// isClientUpToDate = true
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

ipcMain.handle('start-inline-video', async (event) => {
	return await startVideoInline()
})

ipcMain.handle('set-inline-video', async (event, url) => {
	try {
		url = url.trim()
		logger.info("update_url inline", url)
		return await setVideoInline(url)
	} catch (error) {
		logger.error("Error in set-inline-video:", error)
		return false
	}
})

ipcMain.handle('stop-inline-video', async (event) => {
	return await stopVideoInline()
})

ipcMain.handle('stop-vlc', async (event) => {
	return await abortVLC()
})

ipcMain.handle('set-subtitle', async (event, fileData, fileName) => {
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
	try {
		const subtitleBuffer = Buffer.from(arrayBuffer)
		
		subtitleCache.set(filename, subtitleBuffer)
		
		if (isVLCwatching) {
			const tempPath = path.join(require('os').tmpdir(), `vlc_subtitle_${Date.now()}_${filename}`)
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
	await requestSubtitle()
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
	await abortVLC()
	if (process.platform !== 'darwin') {
		app.quit()
	}
})