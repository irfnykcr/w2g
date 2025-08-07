const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const keytar = require('keytar')
const { Menu } = require('electron')
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
	// if (USERID === "helix222"){
	// 	VLC_PORT = 8094
	// }
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

let vlcInterval
let serverInterval

const createWindow = () => {
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
	const r = await axios.post(
		`https://${SERVER_ENDPOINT}${url}`,
		json,
		{ timeout: 5000 }
	)
	return r.data.data
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

const abortVLC = () => {
	if (proc_vlc){
		proc_vlc.kill("SIGKILL")
		logger.info(`Killed VLC process: ${proc_vlc.pid}`)
		proc_vlc = null
	}
	if (vlcInterval){
		clearInterval(vlcInterval)
		logger.info("cleared vlc interval")
	}
	if (serverInterval){
		clearInterval(serverInterval)
		logger.info("cleared server interval")
	}
	makeRequest_server("/leave")
}

const setVideo = async (url, videoVLC) => {
	while (url != videoVLC) {
		if (tried>50){
			return false
		}
		videoVLC = await getVideoUrl_VLC()
		await axios.post(
			`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=in_play&input=${encodeURIComponent(url)}`,
			null,
			{ auth: { username: '', password: VLC_HTTP_PASS } }
		)
		logger.debug("trying to sync..url,videoVLC", url, videoVLC)
		await new Promise(resolve => setTimeout(resolve, 100))
		tried+=1
	}
	return true
}
ipcMain.handle('setvideo-vlc', async (_, url) => {
	try {
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('Invalid URL provided')
		}
		await setVideo(url)
		return true
	} catch (error) {
		return false
	}
})

const setTime = async (time, timeVLC) => {
	let tried = 0
	while (Math.abs(time - timeVLC) > 5) {
		if (tried>50){
			return false
		}
		const info = await getInfo().then((r) => r.data)
		timeVLC = Math.floor(parseFloat(info.length) * parseFloat(info.position))
		await axios.post(
			`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=seek&val=${time}`,
			null,
			{ auth: { username: '', password: VLC_HTTP_PASS } }
		)
		logger.debug("trying to sync..vlc,current,server", timeVLC, time)
		await new Promise(resolve => setTimeout(resolve, 100))
		tried+=1
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
		if (tried>50){
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
		await new Promise(resolve => setTimeout(resolve, 100))
		tried+=1
	}
	logger.debug("playing its true!: is_playing,isplayingVLC", is_playing, isplayingVLC)
	return true
}
// ipcMain.handle('setplaying-vlc', async (event, is_playing) => {
// 	return await setPlaying(is_playing)
// })

ipcMain.handle('open-vlc', async (event) => {
	return await new Promise(async (resolve, reject) => {
		await makeRequest_server("/join")
		const r = await makeRequest_server("/get_playerstatus")
		let CURRENT_VIDEO_SERVER = r.url.value
		let VLC_ARGS = [
			`--intf`, `qt`,
			`--extraintf`, `http`,
			`--http-port`, `${VLC_PORT}`,
			`--http-password`, `${VLC_HTTP_PASS}`,
			`--start-time`, `${r.time.value}`,
			`${CURRENT_VIDEO_SERVER}`,
			//`--video-on-top`
		]
		logger.info("vlcargs:", VLC_ARGS)

		if (proc_vlc) {
			logger.warn("there is already a video playing.")
			return
		}
		proc_vlc = spawn(VLC_PATH, VLC_ARGS)

		proc_vlc.on('spawn', async () => {
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
					if (Date.now() - updateTimeout > 900) {
						let infoVLC = await getInfo().then((r)=>{return r.data})
						stateVLC = infoVLC.state
						if (stateVLC == "stopped"){
							// console.log("stopped..")
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
						videoVLC = await getVideoUrl_VLC()
						if (currentVideo === undefined) {
							currentVideo = videoVLC
						}
						let playerstatus_server = await makeRequest_server("/get_playerstatus")
						let isplayingServer = playerstatus_server.is_playing
						let timeServer = playerstatus_server.time
						let urlServer = playerstatus_server.url
						// logger.debug(r.uptodate, r.uptodate[USERID])
						let me = playerstatus_server.uptodate[USERID] || 0
						if (!me){
							logger.info("not up to date!!!")
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
								if (!await setTime(timeServer.value, timeVLC)){
									continue
								}
								currentTime = timeServer.value
								lastSentTime = timeServer.value
								logger.debug(`set_time ${Math.abs(timeServer.value - timeVLC)} ${timeVLC} ${timeServer.value}`)
							}
							if (urlServer.user != USERID && urlServer.value != videoVLC) {
								if (!await setVideo(urlServer.value)){
									continue
								}
								currentVideo = urlServer.value
								logger.info("!!!!!setvideo")
							}

							await makeRequest_server("/imuptodate")
							updateTimeout = Date.now()
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
							}

							if (videoVLC != currentVideo) {
								logger.debug(`video changed!!videoVLC,currentVideo ${videoVLC} ${currentVideo}`)
								makeRequest_server("/update_url", {"new_url":videoVLC})
							}

							currentState = stateVLC
							currentVideo = videoVLC
							if (currentState != "ended") {
								currentTime = timeVLC
							}
							
							// console.log("checks for up to date regular!!!")
							// if (videoVLC != urlServer.value){
							// 	console.log(`video changed!!regularr ${videoVLC} ${urlServer.value}`)
							// 	await makeRequest_server("/update_url", {"new_url":videoVLC})}else 
							// if (isplayingVLC != isplayingServer.value) {
							// 	await makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
							// 	console.log(`state regular update ${isplayingVLC} ${isplayingServer.value}`)
							// } else if (timeVLC != 0 && Math.abs(lastSentTime - timeVLC) > 5){
							// 	lastSentTime = timeVLC
							// 	makeRequest_server("/update_time", {"new_time":timeVLC})
							// 	console.log(`time regular update ${lastSentTime} ${timeVLC}`)
							// }
						}
					}
				} catch (err) {
					if (err.message.includes("connect ECONNREFUSED")) {
						logger.warn("connection error with vlc: connect ECONNREFUSED")
					}else if (err.message.includes("socket hang up")){
						logger.warn("connection error with socket: socket hang up")
					}else {
						logger.error(err)
					}
					break
				}
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
				reject(`VLC exited with code ${code}`)
			}
			return abortVLC()
		})
	})
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