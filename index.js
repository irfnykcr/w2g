const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const keytar = require('keytar')
const { Menu } = require('electron')
const youtubedl = require('youtube-dl-exec')

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
	abortVLC()
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
	abortVLC()
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
			{ type: 'separator' },
			{ role: 'selectall' }
		])
		menu.popup({ window: win })
	})
	mainWindow = win
	
	win.loadFile(path.join(__dirname, 'views/login.html'))
	// win.loadFile(path.join(__dirname, 'views/index.html'))
	win.webContents.openDevTools()
}

function sendVLCStatus(status, isPlaying = false, currentTime = 0, isUptodate = false) {
	currentVLCStatus = { 
		status, 
		isPlaying, 
		current_time: currentTime,
		is_uptodate: isUptodate,
		timestamp: Date.now() 
	}
	if (mainWindow) {
		mainWindow.webContents.send('vlc-status', currentVLCStatus)
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

const abortVLC = async () => {
	currentVLCStatus = { status: 'stopped', isPlaying: false }
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
	await makeRequest_server("/leave")
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
	// let is_youtube = false
	// for (const ytorigin of YOUTUBE_URLS) {
	// 	if (url.startsWith(ytorigin)){
	// 		is_youtube = true
	// 		break
	// 	}
	// }

	logger.info("Restarting VLC for video change")
	if (proc_vlc || is_watching) {
		await abortVLC()
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
		await makeRequest_server("/update_url", {"new_url": url})
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
		await makeRequest_server("/join").then((r)=>{
			if (!r.status) {
				logger.warn(r)
				return
			}
		})
		const r = await makeRequest_server("/get_playerstatus")
		let CURRENT_VIDEO_SERVER = r.data.url.value
		
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
		})

		proc_vlc.on('error', (error) => {
			sendVLCStatus('error', false)
			reject(`VLC launch error: ${error.message}`)
			return abortVLC()
		})

		proc_vlc.on('close', (code) => {
			sendVLCStatus('closed', false)
			if (code === 0) {
				resolve('VLC exited successfully')
			} else {
				reject(`VLC exited with code ${code}`)
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
	let serverUpdateTimeout = Date.now() - 2000

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
	}

	while (true){
		await new Promise(resolve => setTimeout(resolve, 250))
		try {
			const now = Date.now()
			const infoVLC = await getInfo()
			stateVLC = infoVLC.data.state
			
			if (stateVLC === "stopped"){
				sendVLCStatus('stopped', false)
				continue
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
			sendVLCStatus(stateVLC, isplayingVLC, timeVLC)
			if (now - serverUpdateTimeout > 600) {
				serverUpdateTimeout = now
				const playerstatus_server = await makeRequest_server("/get_playerstatus")
				if (!playerstatus_server.status) {
					logger.warn("Failed to get player status from server")
					continue
				}
				
				const isplayingServer = playerstatus_server.data.is_playing
				const timeServer = playerstatus_server.data.time
				const urlServer = playerstatus_server.data.url
				const serverUptodate = playerstatus_server.data.uptodate[USERID] || false
				
				sendVLCStatus(stateVLC, isplayingVLC, timeVLC, serverUptodate)
				
				let is_serverURLyoutube = false
				for (const ytorigin of YOUTUBE_URLS) {
					if (urlServer.value && urlServer.value.startsWith(ytorigin)) {
						is_serverURLyoutube = true
						break
					}
				}

				try {
					videoVLC = await getVideoUrl_VLC()
				} catch (error) {
					logger.warn("Failed to get VLC video URL:", error.message)
					videoVLC = currentVideo
				}

				if (currentVideo === undefined){
					currentVideo = is_serverURLyoutube ? urlServer.value : videoVLC
				}

				if (!serverUptodate){
					logger.info("Syncing with server...")
					
					if (urlServer.user !== USERID && urlServer.value !== currentVideo) {
						logger.info("Video change detected from server")
						if (await setVideo(urlServer.value)) {
							currentVideo = urlServer.value
							logger.info("Video synchronized")
						} else {
							logger.warn("Failed to sync video")
							continue
						}
					}
					
					if (isplayingServer.user !== USERID && isplayingServer.value !== isplayingVLC){
						logger.info("Play state change detected from server")
						if (await setPlaying(isplayingServer.value)) {
							currentState = isplayingServer.value ? "playing" : "paused"
							logger.debug("Play state synchronized")
						} else {
							logger.warn("Failed to sync play state")
							continue
						}
					} else if (timeServer.user !== USERID && Math.abs(timeVLC - timeServer.value) > 5) {
						logger.info("Time change detected from server")
						if (await setTime(timeServer.value)) {
							currentTime = timeServer.value
							lastSentTime = timeServer.value
							logger.debug("Time synchronized")
						} else {
							logger.warn("Failed to sync time")
							continue
						}
					}

					await makeRequest_server("/imuptodate")
					logger.info("Synchronization complete")
					continue
				} else {
					if (!is_serverURLyoutube && videoVLC !== currentVideo) {
						logger.debug("Local video change detected")
						const result = await makeRequest_server("/update_url", {"new_url": videoVLC})
						if (result.status) {
							currentVideo = videoVLC
						}
					}
					
					if (currentState !== stateVLC) {
						logger.debug("Local state change detected")
						const result = await makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
						if (result.status) {
							currentState = stateVLC
						}
					}
					
					if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 1.5) {
						logger.debug("Local seek detected")
						const result = await makeRequest_server("/update_time", {"new_time": timeVLC})
						if (result.status) {
							lastSentTime = timeVLC
							currentTime = timeVLC
						}
					}
					
					if (timeVLC !== 0 && Math.abs(lastSentTime - timeVLC) > 5) {
						const result = await makeRequest_server("/update_time", {"new_time": timeVLC})
						if (result.status) {
							lastSentTime = timeVLC
						}
					}

					if (!is_serverURLyoutube) {
						currentVideo = videoVLC
					} else {
						currentVideo = urlServer.value
					}
					if (currentState !== "ended") {
						currentTime = timeVLC
					}
				}
			}
		} catch (err) {
			if (err.message.includes("connect ECONNREFUSED")) {
				logger.warn("VLC connection refused")
			} else if (err.message.includes("socket hang up")){
				logger.warn("VLC socket hung up")
			} else {
				logger.error("VLC monitoring error:", err.message)
			}
			break
		}
	}
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