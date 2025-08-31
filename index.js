const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const keytar = require('keytar')
const { Menu } = require('electron')
const youtubedl = require('youtube-dl-exec')
const WebSocket = require('ws')

let youtubeUrlCache = new Map()
const YOUTUBE_CACHE_TTL = 300000

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

const SERVER_ENDPOINT = appConfig.SERVER_ENDPOINT
ipcMain.handle('get-serverendpoint', (event) => {
	return SERVER_ENDPOINT
})

let VLC_PORT = appConfig.VLC_PORT
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
const VLC_HTTP_PASS = appConfig.VLC_HTTP_PASS

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
let is_watching = false
let currentVLCStatus = { status: 'stopped', isPlaying: false }
let vlcInterval
let serverInterval

let videoSyncWS = null
let wsReconnectTimeout = null
let pendingWsRequests = new Map()
let wsRequestId = 0
let isClientUpToDate = false

const createWindow = async () => {
	// override config if debug
	try {
		const debugCredsPath = path.join(__dirname, 'debug_creds.js')
		if (fs.existsSync(debugCredsPath)) {
			// lazt load to avoid circular dependency
			const { setupDebugCreds } = require('./debug_creds.js')
			const debugConfig = await setupDebugCreds()
			USERID = debugConfig.userid
			VLC_PORT = debugConfig.vlc_port
			logger.info(`Debug mode: Using user ${USERID} with VLC port ${VLC_PORT}`)
		}
	} catch (e) {
		logger.warn("Failed to setup debug credentials:", e.message)
	}
	
	const win = new BrowserWindow({
		width: 1280,
		height: 720,
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	})
	win.webContents.on('context-menu', (event, params) => {
		const menu = Menu.buildFromTemplate([
			{ role: 'cut' },
			{ role: 'copy' },
			{ role: 'paste' },
		])
		menu.popup({ window: win })
	})
	mainWindow = win
	
	win.loadFile(path.join(__dirname, 'views/login.html'))
	// win.loadFile(path.join(__dirname, 'views/index.html'))
	win.webContents.openDevTools()
}

function sendVLCStatus(status, additionalData = {}) {
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
}

const connectVideoSyncWS = async () => {
	if (videoSyncWS && videoSyncWS.readyState === WebSocket.OPEN) {
		return true
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
			videoSyncWS.on('open', () => {
				logger.info("Video sync WebSocket connected")
				isClientUpToDate = false
				if (wsReconnectTimeout) {
					clearTimeout(wsReconnectTimeout)
					wsReconnectTimeout = null
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
			
			videoSyncWS.on('close', () => {
				logger.warn("Video sync WebSocket disconnected")
				videoSyncWS = null
				isClientUpToDate = false
				if (is_watching) {
					wsReconnectTimeout = setTimeout(() => {
						connectVideoSyncWS()
					}, 2000)
				}
			})
			
			videoSyncWS.on('error', (error) => {
				logger.error("Video sync WebSocket error:", error.message)
				resolve(false)
			})
		})
		
	} catch (error) {
		logger.error("Failed to connect video sync WebSocket:", error.message)
		return false
	}
}

const disconnectVideoSyncWS = () => {
	if (wsReconnectTimeout) {
		clearTimeout(wsReconnectTimeout)
		wsReconnectTimeout = null
	}
	if (videoSyncWS) {
		videoSyncWS.close()
		videoSyncWS = null
	}
}

const sendVideoSyncMessage = async (message) => {
	if (!videoSyncWS || videoSyncWS.readyState !== WebSocket.OPEN) {
		logger.warn("Video sync WebSocket not connected")
		return null
	}
	
	const requestId = ++wsRequestId
	message.requestId = requestId
	
	return new Promise((resolve, reject) => {
		pendingWsRequests.set(requestId, { resolve, reject })
		
		setTimeout(() => {
			if (pendingWsRequests.has(requestId)) {
				pendingWsRequests.delete(requestId)
				reject(new Error("WebSocket request timeout"))
			}
		}, 5000)
		
		videoSyncWS.send(JSON.stringify(message))
	})
}

const applyServerState = async (state) => {
	let needsSync = false
	
	try {
		if (state.url && state.url_user !== USERID) {
			if (proc_vlc && is_watching) {
				try {
					const currentUrl = await getVideoUrl_VLC()
					if (currentUrl !== state.url) {
						logger.info("Applying server URL:", state.url)
						await setVideo(state.url)
						needsSync = true
					} else {
						logger.info("VLC already playing correct URL, no restart needed")
					}
				} catch (error) {
					logger.info("VLC running but not ready, applying server URL:", state.url)
					await setVideo(state.url)
					needsSync = true
				}
			} else {
				logger.info("Starting VLC with server state")
				await openVLC(state)
				needsSync = true
			}
		}
		
		if (state.time > 0 && state.time_user !== USERID && proc_vlc && is_watching) {
			try {
				const info = await getInfo()
				const currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
				if (Math.abs(currentTime - state.time) > 2) {
					logger.info("Applying server time:", state.time)
					await setTime(state.time)
					needsSync = true
				}
			} catch (error) {
				logger.debug("Cannot sync time, VLC not ready")
			}
		}
		
		if (state.playing_user !== USERID && proc_vlc && is_watching) {
			try {
				const info = await getInfo()
				const currentlyPlaying = info.data.state !== "paused"
				if (currentlyPlaying !== state.is_playing) {
					logger.info("Applying server playing state:", state.is_playing)
					await setPlaying(state.is_playing)
					needsSync = true
				}
			} catch (error) {
				logger.debug("Cannot sync playing state, VLC not ready")
			}
		}
		
	} catch (error) {
		logger.error("Error applying server state:", error.message)
	}
	
	return needsSync
}

const handleVideoSyncMessage = async (message) => {
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
		isClientUpToDate = true
		
		const needsSync = await applyServerState(message)
		
		if (needsSync) {
			setTimeout(async () => {
				try {
					if (message.url) {
						try {
							const currentUrl = await getVideoUrl_VLC()
							if (currentUrl === message.url) {
								await makeRequest_videoSync("imuptodate")
								logger.info("Confirmed sync with server after VLC ready")
							}
						} catch (error) {
							setTimeout(() => {
								makeRequest_videoSync("imuptodate").catch(err => 
									logger.warn("Failed to confirm delayed sync:", err.message))
							}, 1000)
						}
					} else {
						await makeRequest_videoSync("imuptodate")
					}
				} catch (err) {
					logger.warn("Failed to confirm initial sync:", err.message)
				}
			}, 2000)
		} else {
			makeRequest_videoSync("imuptodate").catch(err => 
				logger.warn("Failed to confirm initial sync:", err.message))
		}
	}
	else if (type === 'connected') {
		logger.info("Connected to video sync server")
	}
	else if (type === 'url_updated') {
		logger.info("Server video URL updated:", message.url)
		if (message.user !== USERID) {
			isClientUpToDate = true
			
			try {
				const currentUrl = await getVideoUrl_VLC()
				if (currentUrl !== message.url) {
					setVideo(message.url).then(() => {
						makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
					}).catch(err => logger.warn("Failed to set video:", err.message))
				} else {
					makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
				}
			} catch (error) {
				setVideo(message.url).then(() => {
					makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
				}).catch(err => logger.warn("Failed to set video:", err.message))
			}
		}
	}
	else if (type === 'time_updated') {
		logger.info("Server time updated:", message.time)
		if (message.user !== USERID) {
			isClientUpToDate = true
			
			try {
				const info = await getInfo()
				const currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
				
				if (Math.abs(currentTime - message.time) > 2) {
					setTime(message.time).then((success) => {
						if (success) {
							makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
						}
					}).catch(err => logger.warn("Failed to set time:", err.message))
				} else {
					makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
				}
			} catch (error) {
				logger.debug("VLC not ready for time sync, will sync later")
				makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
			}
		}
	}
	else if (type === 'playing_updated') {
		logger.info("Server playing state updated:", message.is_playing)
		if (message.user !== USERID) {
			isClientUpToDate = true
			
			try {
				const info = await getInfo()
				const currentlyPlaying = info.data.state !== "paused"
				
				if (currentlyPlaying !== message.is_playing) {
					setPlaying(message.is_playing).then((success) => {
						if (success) {
							makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
						}
					}).catch(err => logger.warn("Failed to set playing state:", err.message))
				} else {
					makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
				}
			} catch (error) {
				logger.debug("VLC not ready for playing state sync, will sync later")
				makeRequest_videoSync("imuptodate").catch(err => logger.warn("Failed to confirm sync:", err.message))
			}
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
const getVideoUrl_VLC = async ()=>{
	const r = await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/playlist.json`,
		null,
		{ 
			auth: { username: '', password: VLC_HTTP_PASS },
		}
	)
	return r.data.children[0].children.find(item => item.current === "current").uri
}

const abortVLC = async (isVideoChange = false) => {
	if (proc_vlc){
		proc_vlc.kill("SIGKILL")
		logger.info(`Killed VLC process: ${proc_vlc.pid}`)
		proc_vlc = null
	}
	is_watching = false
	if (vlcInterval){
		clearInterval(vlcInterval)
		logger.info("cleared vlc interval")
	}
	if (serverInterval){
		clearInterval(serverInterval)
		logger.info("cleared server interval")
	}
	
	sendVLCStatus({
		status: 'stopped',
		isPlaying: false
	})
	
	if (!isVideoChange) {
		disconnectVideoSyncWS()
	}
}

const checkVideoUrl = async (url) => {
	for (const ytorigin of YOUTUBE_URLS) {
		if (url.startsWith(ytorigin)){
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
					format: 'bestvideo[height<=1080][ext=webm]+bestaudio[ext=m4a]/best[height<=1080]',
					noCheckCertificates: true,
					noPlaylist: true
				})
				
				logger.info("Got stream URL for YouTube")
				const urls = _streamUrl.split('\n').filter(u => u.trim())
				
				youtubeUrlCache.set(url, {
					urls: urls,
					timestamp: Date.now()
				})
				
				return urls
			} catch (e) {
				logger.warn("YouTube URL processing failed:", e.message)
				return url
			}
		}
	}
	return url
}

const setVideo = async (url) => {
	logger.info("setVideo->", url)
	
	if (proc_vlc && is_watching) {
		try {
			const currentUrl = await getVideoUrl_VLC()
			if (currentUrl === url) {
				logger.info("VLC is already playing the same video, no restart needed")
				return true
			}
		} catch (error) {
			logger.debug("Could not check current VLC URL:", error.message)
		}
	}
	
	logger.info("Restarting VLC for video change")
	if (proc_vlc || is_watching) {
		await abortVLC(true)
		await new Promise(resolve => setTimeout(resolve, 200))
	}
	return await openVLC()
}

ipcMain.handle('setvideo-vlc', async (_, url) => {
	try {
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('Invalid URL provided')
		}
		logger.info("update_url", url)
		await makeRequest_videoSync("update_url", {"new_url": url})
		await setVideo(url)
		
		return true
	} catch (error) {
		logger.error("Error in setvideo-vlc:", error)
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

const setTime = async (time) => {
	if (time < 0) {
		logger.warn("Attempted to seek to negative time:", time)
		return false
	}
	
	let tried = 0
	const maxTries = 6
	
	while (tried < maxTries) {
		try {
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
// ipcMain.handle('settime-vlc', async (event, time) => {
// 	return await setTime(time)
// })

const setPlaying = async (is_playing) => {
	const command = is_playing ? "pl_play" : "pl_pause"
	
	let tried = 0
	const maxTries = 6
	
	while (tried < maxTries) {
		try {
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



const openVLC = async () => {
	return await new Promise(async (resolve, reject) => {
		if (proc_vlc || is_watching) {
			logger.warn("there is already a video playing.")
			return resolve(false)
		}

		is_watching = true
		
		if (!await connectVideoSyncWS()) {
			logger.warn("Failed to connect to video sync")
			return resolve(false)
		}
		
		const r = await makeRequest_videoSync("get_playerstatus")
		if (!r.status) {
			logger.warn("Failed to get player status")
			return resolve(false)
		}
		
		let CURRENT_VIDEO_SERVER = r.data.url.value
		const SERVER_IS_PLAYING = r.data.is_playing.value
		
		let VLC_ARGS = [
			`--intf`, `qt`,
			`--extraintf`, `http`,
			`--http-port`, `${VLC_PORT}`,
			`--http-password`, `${VLC_HTTP_PASS}`,
			'--network-caching=1200',
			'--file-caching=1200',
			'--http-reconnect',
			`--video-on-top`,
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
		VLC_ARGS.push(`:start-time=${r.data.time.value}`)

		logger.info("vlcargs:", VLC_ARGS)
		
		proc_vlc = spawn(VLC_PATH, VLC_ARGS)
		proc_vlc.on('spawn', async () => {
			startVLCMonitoring()
			if (!SERVER_IS_PLAYING) {
				setTimeout(async () => {
					try {
						await setPlaying(false)
					} catch (err) {
						logger.warn("Failed to pause VLC after startup:", err.message)
					}
				}, 1000)
			}
		})

		proc_vlc.on('error', (error) => {
			reject(`VLC launch error: ${error.message}`)
			return abortVLC()
		})

		proc_vlc.on('close', (code) => {
			if (code === 0) {
				resolve('VLC exited successfully')
			} else {
				resolve(`VLC exited with code ${code}`)
			}
			return abortVLC()
		})
	})
}

const startVLCMonitoring = async () => {
	if (vlcInterval) clearInterval(vlcInterval)
	if (serverInterval) clearInterval(serverInterval)

	let currentState = undefined
	let currentTime = undefined
	let currentVideo = undefined
	let lastSentTime = undefined
	let stateVLC = undefined
	let timeVLC = 0
	let videoVLC = undefined
	let isplayingVLC = undefined

	let attempts = 0
	const maxAttempts = 40
	
	while (attempts < maxAttempts){
		try{
			const r = await getInfo()
			if (r.data.length !== -1){
				logger.info("VLC is ready after", attempts * 30, "ms")
				break
			}
		} catch {
		}
		await new Promise(resolve => setTimeout(resolve, 30))
		attempts++
	}
	
	if (attempts >= maxAttempts) {
		logger.warn("VLC took too long to initialize")
		return false
	}

	sendVLCStatus({
		status: 'playing',
		isPlaying: true
	}, {
		currentTime: 0,
		isUpToDate: isClientUpToDate
	})

	vlcInterval = setInterval(async () => {
		if (!is_watching || !proc_vlc) { 
			clearInterval(vlcInterval)
			return
		}

		if (!isClientUpToDate) {
			try {
				const statusResult = await sendVideoSyncMessage({ type: "get_playerstatus" })
				if (statusResult && statusResult.data) {
					const serverStatus = statusResult.data
					
					try {
						const info = await getInfo()
						const currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
						const currentlyPlaying = info.data.state !== "paused"
						
						try {
							const currentUrl = await getVideoUrl_VLC()
							if (serverStatus.url && serverStatus.url.value &&  currentUrl && currentUrl !== serverStatus.url.value) {
								await setVideo(serverStatus.url.value)
							}
						} catch (urlError) {
							logger.error(urlError)
							return
							// if (serverStatus.url && serverStatus.url.value) {
							// 	await setVideo(serverStatus.url.value)
							// }
						}
						
						if (serverStatus.time && serverStatus.time.value > 0 && Math.abs(currentTime - serverStatus.time.value) > 2) {
							await setTime(serverStatus.time.value)
						}
						
						if (serverStatus.is_playing && currentlyPlaying !== serverStatus.is_playing.value) {
							await setPlaying(serverStatus.is_playing.value)
						}
					} catch (vlcError) {
						logger.debug("VLC not ready, trying again.")
						return
						// logger.debug("VLC not ready, applying all server state")
						// if (serverStatus.url && serverStatus.url.value) {
						// 	await setVideo(serverStatus.url.value)
						// }
						// if (serverStatus.time && serverStatus.time.value > 0) {
						// 	await setTime(serverStatus.time.value)
						// }
						// if (serverStatus.is_playing) {
						// 	await setPlaying(serverStatus.is_playing.value)
						// }
					}
					
					await sendVideoSyncMessage({ type: "imuptodate" })
					isClientUpToDate = true
					logger.info("sent imuptodate and marked isclientuptodate true.")
					
					try {
						const info = await getInfo()
						const currentTime = Math.floor(parseFloat(info.data.length) * parseFloat(info.data.position))
						const isPlaying = info.data.state !== "paused"
						sendVLCStatus({
							status: isPlaying ? 'playing' : 'paused',
							isPlaying: isPlaying
						}, {
							currentTime: currentTime,
							isUpToDate: true
						})
					} catch (err) {
						logger.debug("Could not send VLC status after sync:", err.message)
					}
				}
			} catch (error) {
				logger.warn("Failed to sync with server:", error.message)
			}
			return
		}
		
		try {
			const infoVLC = await getInfo()
			stateVLC = infoVLC.data.state
			
			if (stateVLC === "stopped"){
				return
			}
			
			if (currentState === undefined){
				currentState = stateVLC
			}
			
			timeVLC = Math.floor(parseFloat(infoVLC.data.length) * parseFloat(infoVLC.data.position))
			if (currentTime === undefined || lastSentTime === undefined){
				currentTime = timeVLC
				lastSentTime = timeVLC
			}
			isplayingVLC = stateVLC !== "paused"

			sendVLCStatus({
				status: isplayingVLC ? 'playing' : 'paused',
				isPlaying: isplayingVLC
			}, {
				currentTime: timeVLC,
				isUpToDate: isClientUpToDate
			})

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
				logger.debug("Local video change detected")
				const result = await makeRequest_videoSync("update_url", {"new_url": videoVLC})
				if (result.status) {
					currentVideo = videoVLC
					isClientUpToDate = true
				}
			}
			
			if (currentState !== stateVLC) {
				logger.debug("Local state change detected")
				const result = await makeRequest_videoSync("update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
				if (result.status) {
					currentState = stateVLC
					isClientUpToDate = true
				}
			}
			
			if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 1.5) {
				logger.debug("Local seek detected")
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC})
				if (result.status) {
					lastSentTime = timeVLC
					currentTime = timeVLC
					isClientUpToDate = true
				}
			}
			
			if (timeVLC !== 0 && Math.abs(lastSentTime - timeVLC) > 5) {
				const result = await makeRequest_videoSync("update_time", {"new_time": timeVLC})
				if (result.status) {
					lastSentTime = timeVLC
					isClientUpToDate = true
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
			clearInterval(vlcInterval)
		}
	}, 250)
}

ipcMain.handle('open-vlc', async (event) => {
	return await openVLC()
})

app.whenReady().then(() => {
	createWindow()
})

app.on('window-all-closed', () => {
	abortVLC()
	if (process.platform !== 'darwin') {
		app.quit()
	}
})