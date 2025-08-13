const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const keytar = require('keytar')
const { Menu } = require('electron')
const youtubedl = require('youtube-dl-exec')

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

function sendVLCStatus(status, isPlaying = false) {
	currentVLCStatus = { status, isPlaying, timestamp: Date.now() }
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
			{ timeout: 10000 }
		)
		return r.data.data
	} catch (e){
		logger.error(`makeRequest_server error!\nargs:, ${url},${json}\nerror:${e.message}`)
	}
}

const getInfo = async () => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}
const getVideoUrl_VLC = async ()=>{
	const r = await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/playlist.json`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
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
		logger.info("trying for->",ytorigin)
		if (url.startsWith(ytorigin)){
			logger.info("match for->",ytorigin)
			try {
				const _streamUrl = await youtubedl(url, {
					getUrl: true,
					format: 'bestvideo[height<=1080][ext=webm]+bestaudio[ext=m4a]/best[height<=1080]',
					noCheckCertificates: true,
					noPlaylist: true
				})
				logger.info("got streamurl for youtube")
				const urls = _streamUrl.split('\n').filter(u => u.trim())
				return urls
			} catch (e) {
				logger.info("coulnd not retrieve youtube video.")
				logger.info(e)
				return url
			}
		}
	}
	return url
}

const setVideo = async (url) => {
	logger.info("setVideo->", url)
	let is_youtube = false
	for (const ytorigin of YOUTUBE_URLS) {
		if (url.startsWith(ytorigin)){
			is_youtube = true
			break
		}
	}
	
	// if (is_youtube) {
	// logger.info("YouTube video with 2 streams - restarting VLC")
	logger.info("restarting vlc.")
	if (proc_vlc || is_watching) {
		await abortVLC()
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	return await openVLC()
	// } else {
	// 	let tried = 0
	// 	let videoVLC = await getVideoUrl_VLC()
		
	// 	while (url != videoVLC) {
	// 		if (tried > 25) {
	// 			return false
	// 		}
	// 		await axios.post(
	// 			`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=in_play&input=${encodeURIComponent(url)}`,
	// 			null,
	// 			{ auth: { username: '', password: VLC_HTTP_PASS } }
	// 		)
	// 		videoVLC = await getVideoUrl_VLC()
	// 		logger.debug("trying to sync..url,videoVLC", url, videoVLC)
	// 		await new Promise(resolve => setTimeout(resolve, 200))
	// 		tried += 1
	// 	}
		
	// 	return true
	// }
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

const setTime = async (time) => {
	let tried = 0
	const info = await getInfo().then((r) => r.data)
	let timeVLC = Math.floor(parseFloat(info.length) * parseFloat(info.position))
	
	// Ensure we don't seek to invalid times
	if (time < 0) {
		logger.warn("Attempted to seek to negative time:", time)
		return false
	}
	
	while (Math.abs(time - timeVLC) > 5) {
		if (tried > 25){
			logger.warn("setTime exceeded max attempts")
			return false
		}
		await axios.post(
			`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=seek&val=${time}`,
			null,
			{ auth: { username: '', password: VLC_HTTP_PASS } }
		)
		await new Promise(resolve => setTimeout(resolve, 300)) // Slightly longer delay
		const newInfo = await getInfo().then((r) => r.data)
		timeVLC = Math.floor(parseFloat(newInfo.length) * parseFloat(newInfo.position))
		logger.debug("trying to sync timee..vlc,current,server", timeVLC, time)
		tried += 1
	}
	return true
}
// ipcMain.handle('settime-vlc', async (event, time) => {
// 	return await setTime(time)
// })

const setPlaying = async (is_playing) => {
	let command = ""
	if (is_playing){
		command = "pl_play"
	} else {
		command = "pl_pause"
	}
	let tried = 0
	let info = await getInfo().then((r) => r.data)
	let isplayingVLC = info.state != "paused"
	logger.debug("starting with: is_playing,isplayingVLC", is_playing, isplayingVLC)
	while (is_playing != isplayingVLC) {
		if (tried>25){
			logger.warn("setplaying>50")
			return false
		}
		await axios.post(
			`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=${command}`,
			null,
			{ auth: { username: '', password: VLC_HTTP_PASS } }
		)
		let info = await getInfo().then((r) => r.data)
		isplayingVLC = info.state != "paused"
		logger.debug("playing now: is_playing,isplayingVLC", is_playing, isplayingVLC)
		await new Promise(resolve => setTimeout(resolve, 200))
		tried+=1
	}
	logger.debug("playing its true!: is_playing,isplayingVLC", is_playing, isplayingVLC)
	return true
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
		let CURRENT_VIDEO_SERVER = r.url.value
		
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
		VLC_ARGS.push(`:start-time=${r.time.value}`)

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
	let updateTimeout = Date.now() - 1000

	while (true){
		try{
			const r = await getInfo().then((r)=>{return r.data})
			if (r.length !== -1){
				break
			}
		} catch {
		}
		setTimeout(()=>{}, 100)
	}

	while (true){
		setTimeout(()=>{}, 100)
		try {
			if (Date.now() - updateTimeout > 500) {
				updateTimeout = Date.now()
				let infoVLC = await getInfo().then((r)=>{return r.data})
				stateVLC = infoVLC.state
				if (stateVLC == "stopped"){
					sendVLCStatus('stopped', false)
					continue
				}else if (currentState === undefined){
					currentState = stateVLC
				}
				timeVLC = Math.floor(parseFloat(infoVLC.length) * parseFloat(infoVLC.position))
				if (currentTime === undefined || lastSentTime === undefined){
					currentTime = timeVLC
					lastSentTime = timeVLC
				}
				isplayingVLC = stateVLC != "paused"
				sendVLCStatus(stateVLC, isplayingVLC)

				let playerstatus_server = await makeRequest_server("/get_playerstatus")
				let isplayingServer = playerstatus_server.is_playing
				let timeServer = playerstatus_server.time
				let urlServer = playerstatus_server.url
				let is_serverURLyoutube = false
				for (const ytorigin of YOUTUBE_URLS) {
					if (urlServer.value.startsWith(ytorigin)) {
						is_serverURLyoutube = true
						break
					}
				}

				videoVLC = await getVideoUrl_VLC()

				if (currentVideo === undefined){
					if (is_serverURLyoutube){
						currentVideo = urlServer.value
					} else{
						currentVideo = videoVLC
					}
				}

				
				let me = playerstatus_server.uptodate[USERID] || 0
				if (!me){
					logger.info("not up to date!!!")
					if (urlServer.user != USERID && urlServer.value != currentVideo) {
						if (!await setVideo(urlServer.value)) {
							logger.info("!!!!!smt went wrong")
							continue
						}
						// Update currentVideo after successful video change
						if (is_serverURLyoutube) {
							currentVideo = urlServer.value
						} else {
							// For non-YouTube, currentVideo will be updated after VLC changes
							currentVideo = urlServer.value
						}
						logger.info("!!!!!setvideo")
					}
					if (isplayingServer.user != USERID && isplayingServer.value != isplayingVLC){
						if (!await setPlaying(isplayingServer.value)){
							continue
						}
						if (isplayingServer.value){
							currentState = "playing"
						} else {
							currentState = "paused"
						}
						logger.debug(`set_playing ${currentState}, ${isplayingServer.value}`)
					}
					if (timeServer.user != USERID && Math.abs(timeServer.value - timeVLC) > 5) {
						if (!await setTime(timeServer.value)){
							continue
						}
						currentTime = timeServer.value
						lastSentTime = timeServer.value
						logger.debug(`set_time ${Math.abs(timeServer.value - timeVLC)} ${timeVLC} ${timeServer.value}`)
					}

					await makeRequest_server("/imuptodate")
					logger.info("it is up to date now!!!")
					continue
				} else {
					if (currentState != stateVLC) {
						logger.debug(`state changed!!stateVLC,currentState,isplayingVLC,timeVLC ${stateVLC} ${currentState} ${isplayingVLC} ${timeVLC}`)
						makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
					}

					if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 5) {
						logger.debug(`seeked!!currentTime,timeVLC ${currentTime} ${timeVLC}`)
						makeRequest_server("/update_time", {"new_time":timeVLC})
						lastSentTime = timeVLC
					}

					if (!is_serverURLyoutube && videoVLC != currentVideo) {
						logger.debug(`video changed!!`)
						makeRequest_server("/update_url", {"new_url":videoVLC})
					}

					currentState = stateVLC
					if (!is_serverURLyoutube) {
						currentVideo = videoVLC
					} else {
						currentVideo = urlServer.value
					}
					if (currentState != "ended") {
						currentTime = timeVLC
					}


					// if (videoVLC != urlServer.value){
					// 	logger.info(`video changed!!22`)
					// 	makeRequest_server("/update_url", {"new_url":videoVLC})}else 
					if (isplayingVLC != isplayingServer.value) {
						makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
						logger.info(`state regular update ${isplayingVLC} ${isplayingServer.value}`)
					} else if (timeVLC != 0 && Math.abs(lastSentTime - timeVLC) > 5){
						lastSentTime = timeVLC
						makeRequest_server("/update_time", {"new_time":timeVLC})
						logger.info(`time regular update ${lastSentTime} ${timeVLC}`)
					}
				}
			}
		} catch (err) {
			if (err.message.includes("connect ECONNREFUSED")) {
				logger.warn("connection error with vlc: connect ECONNREFUSED")
			}else if (err.message.includes("socket hang up")){
				logger.warn("connection error with socket: socket hang up")
			}else {
				logger.error(err)
				continue
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