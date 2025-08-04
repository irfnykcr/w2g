const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const { spawn } = require('child_process')
const fs = require('fs')
const { remote } = require('electron');
const { Menu } = require('electron');
// const bcrypt = require('bcryptjs')

const ROOMPSW = "password_room1_password"
ipcMain.handle('get-roompsw', (event) => {
	return ROOMPSW
})
const USERPSW = "123"
ipcMain.handle('get-userpsw', (event) => {
	return USERPSW
})
// console.log(bcrypt.hashSync(ROOMPSW, 10))
// process.exit()
const ROOMNAME = "room1"
ipcMain.handle('get-room', (event) => {
	return ROOMNAME
})
const isDev = !app.isPackaged;
const __apppath = isDev ? __dirname : process.resourcesPath;
console.log("******APPPATH:", __apppath);
const appConfigPath = isDev ? path.join(__apppath, 'resources/config/config.json') : path.join(__apppath, 'config/config.json');

let appConfig = {}
if (!fs.existsSync(appConfigPath)) {
	console.log("config not found")
	process.exit()
}

const configData = fs.readFileSync(appConfigPath, 'utf-8')
appConfig = JSON.parse(configData)
console.log('Loaded app config:', appConfig)


let USERID = appConfig.USERID
ipcMain.handle('get-user', (event) => {
	return USERID
})
const SERVER_ENDPOINT = appConfig.SERVER_ENDPOINT
ipcMain.handle('get-serverendpoint', (event) => {
	return SERVER_ENDPOINT
})

let VLC_PORT = appConfig.VLC_PORT
const VLC_PATH = appConfig.VLC_PATH
const VLC_HTTP_PASS = appConfig.VLC_HTTP_PASS
// const VLC_ARGS = [`--intf`, `qt`, `--extraintf`, `http`, `--http-port`, `${VLC_PORT}`, `--http-password`, `${VLC_HTTP_PASS}`, `--video-on-top`]
const VLC_ARGS = [`--intf`, `qt`, `--extraintf`, `http`, `--http-port`, `${VLC_PORT}`, `--http-password`, `${VLC_HTTP_PASS}`]
	
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
		]);
		menu.popup({ window: win });
	});
	mainWindow = win
	win.loadFile(path.join(__dirname, 'views/index.html'))
	win.webContents.openDevTools()
}

const makeRequest_server = async (url, json) => {
	if (!json) json = {}
	json.userid = USERID
	json.roompsw = ROOMPSW
	json.roomname = ROOMNAME
	const r = await axios.post(
		`https://${SERVER_ENDPOINT}/${url}`,
		json
	).then(async (r)=>{
		return r.data.data
	})
	return r 
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
		console.log(`Killed VLC process: ${proc_vlc.pid}`)
		proc_vlc = null
	}
	if (vlcInterval){
		clearInterval(vlcInterval)
		console.log("cleared vlc interval")
	}
	if (serverInterval){
		clearInterval(serverInterval)
		console.log("cleared server interval")
	}
	makeRequest_server("/leave")
}

const setVideo = async (url) => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=in_play&input=${encodeURIComponent(url)}`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}
ipcMain.handle('setvideo-vlc', async (_, url) => {
	try {
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error('Invalid URL provided');
		}
		await setVideo(url)
		return true
	} catch (error) {
		return false
	}
});

const setTime = async (time) => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=seek&val=${time}`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
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
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=${command}`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}
// ipcMain.handle('setplaying-vlc', async (event, is_playing) => {
// 	return await setPlaying(is_playing)
// })

ipcMain.handle('open-vlc', async (event) => {
	return await new Promise(async (resolve, reject) => {
		await makeRequest_server("/join")
		const r = await makeRequest_server("/get_playerstatus")
		let CURRENT_VIDEO_SERVER = r.url.value
		VLC_ARGS.push('--start-time', `${r.time.value}`, CURRENT_VIDEO_SERVER)

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
			let updateTimeout = Date.now()

			setTimeout(() => {}, 250)

			while (true){
				try{
					const r = await getInfo().then((r)=>{return r.data})
					if (r.length !== -1){
						break
					}
				} catch {
				}
				setTimeout(() => {}, 100)
			}
			while (true){
				setTimeout(() => {}, 100)
				try {
					const r = await getInfo().then((r)=>{return r.data})
					stateVLC = r.state
					if (stateVLC == "stopped"){
						// console.log("stopped..")
						continue
					}else if (currentState === undefined){
						currentState = stateVLC
					}
					timeVLC = Math.floor(parseFloat(r.length) * parseFloat(r.position))
					if (currentTime === undefined || lastSentTime === undefined){
						currentTime = timeVLC
						lastSentTime = timeVLC
					}
					isplayingVLC = stateVLC != "paused"
					videoVLC = await getVideoUrl_VLC()
					if (currentVideo === undefined) {
						currentVideo = videoVLC
					}


					if (Date.now() - updateTimeout > 900) {
						updateTimeout = Date.now()
						const r = await makeRequest_server("/get_playerstatus")
						const isplayingServer = r.is_playing
						const timeServer = r.time
						const urlServer = r.url
						const me = r.users.value[USERID]
						if (!me.uptodate){
							console.log("not up to date!!!")
							const timeABSserver = Math.abs(timeServer.value - timeVLC)
							if (isplayingServer.user != USERID && isplayingServer.value != isplayingVLC){
								await setPlaying(isplayingServer.value)
								if (isplayingServer.value === "paused"){
									currentState = "paused"
								} else {
									currentState = "playing"
								}
								console.log(`set_playing ${isplayingVLC}, ${isplayingServer.value}`)
							}
							if (timeServer.user != USERID && timeABSserver > 5) {
								await setTime(timeServer.value)
								currentTime = timeServer.value
								lastSentTime = timeServer.value
								console.log(`set_time ${timeABSserver} ${timeVLC} ${timeServer.value}`)
							}
							if (urlServer.user != USERID && urlServer.value != videoVLC) {
								await setVideo(urlServer.value)
								currentVideo = urlServer.value
								console.log("!!!!!setvideo")
							}
							await makeRequest_server("/imuptodate")
							console.log("it is up to date now!!!")
							continue
						} else {
							// console.log("checks for up to date regular!!!")
							if (videoVLC != urlServer.value){
								console.log(`video changed!!regularr ${videoVLC} ${urlServer.value}`)
								await makeRequest_server("/update_url", {"new_url":videoVLC})
							}else if (isplayingVLC != isplayingServer.value) {
								await makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
								console.log(`state regular update ${isplayingVLC} ${isplayingServer.value}`)
							} else if (timeVLC != 0 && Math.abs(lastSentTime - timeVLC) > 5){
								lastSentTime = timeVLC
								await makeRequest_server("/update_time", {"new_time":timeVLC})
								console.log(`time regular update ${lastSentTime} ${timeVLC}`)
							}
						}
					}

					if (currentState != stateVLC) {
						console.log(`state changed! ${stateVLC} ${currentState} ${timeVLC}`)
						await makeRequest_server("/update_isplaying", {"is_playing": isplayingVLC, "new_time": timeVLC})
					}

					if (currentTime !== 0 && Math.abs(currentTime - timeVLC) > 5) {
						console.log(`seeked!! ${currentTime} ${timeVLC}`)
						await makeRequest_server("/update_time", {"new_time":timeVLC})
					}

					if (videoVLC != currentVideo) {
						console.log(`video changed!! ${videoVLC} ${currentVideo}`)
						await makeRequest_server("/update_url", {"new_url":videoVLC})
					}

					currentState = stateVLC
					currentVideo = videoVLC
					if (currentState != "ended") {
						currentTime = timeVLC
					}
				} catch (err) {
					if (err.message.includes("connect ECONNREFUSED")) {
						console.log("connection error with vlc: connect ECONNREFUSED")
					}else if (err.message.includes("socket hang up")){
						console.log("connection error with socket: socket hang up")
					}else {
						console.log(err)
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