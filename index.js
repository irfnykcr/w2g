const { app, BrowserWindow, ipcMain } = require('electron/main')
const axios = require('axios')
const path = require('node:path')
const dotenv = require('dotenv')
const { spawn } = require('child_process')
const fs = require('fs')

const isPrimeTakenPath = path.join(__dirname, 'is_primetaken.pid')
let USERID = "0"
let VLC_PORT = 8093
if (fs.existsSync(isPrimeTakenPath)) {
	console.log('THIS IS THE SECOND')
	USERID = "1"
	VLC_PORT = 8094
} else {
	fs.writeFileSync(isPrimeTakenPath, '')
	console.log('Created file: is_primetaken')
}

const ENDPOINT = "http://127.0.0.1:5000"
const VLC_PATH = '/usr/bin/vlc'
const VLC_HTTP_PASS = 'w1Vam0l3chtgrRWP'
const VLC_ARGS = [`--intf`, `qt`, `--extraintf`, `http`, `--http-port`, `${VLC_PORT}`, `--http-password`, `${VLC_HTTP_PASS}`]
	
let mainWindow
let proc_vlc

let vlcInterval
let serverInterval

const createWindow = () => {
	const win = new BrowserWindow({
		width: 640,
		height: 640,
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	})
	
	mainWindow = win
	win.loadFile(path.join(__dirname, 'views/index.html'))
	win.webContents.openDevTools()
}

const makeRequest_server = async (url, json) => {
	if (!json) json = {}
	json.userid = USERID
	return await axios.post(
		`${ENDPOINT}/${url}`,
		json
	).then(async (r)=>{
		return r.data.data
	})
}

const getInfo = async () => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}

const abortVLC = () => {
	if (USERID === "0"){
		fs.unlinkSync(isPrimeTakenPath)
		console.log('Removed file: is_primetaken')
	}
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
		`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=in_play&input=${url}`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}
ipcMain.handle('setvideo-vlc', async (event, url) => {
	return await setVideo(url)
})

const setTime = async (time) => {
	return await axios.post(
		`http://127.0.0.1:${VLC_PORT}/requests/status.json?command=seek&val=${time}`,
		null,
		{ auth: { username: '', password: VLC_HTTP_PASS } }
	)
}
ipcMain.handle('settime-vlc', async (event, time) => {
	return await setTime(time)
})

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
ipcMain.handle('setplaying-vlc', async (event, is_playing) => {
	return await setPlaying(is_playing)
})

ipcMain.handle('open-vlc', async (event) => {
	return await new Promise(async (resolve, reject) => {
		await makeRequest_server("/join")
		const r = await makeRequest_server("/get_playerstatus")
		CURRENT_VIDEO = r.url.value
		VLC_ARGS.push('--start-time', `${r.time.value}`, CURRENT_VIDEO)

		proc_vlc = spawn(VLC_PATH, VLC_ARGS)

		proc_vlc.on('spawn', async () => {
			if (vlcInterval) clearInterval(vlcInterval)
			if (serverInterval) clearInterval(serverInterval)

			let currentState = undefined
			let currentTime = undefined
			let lastSentTime = undefined
			let stateVLC = undefined
			let timeVLC = 0
			let isplayingVLC = undefined
			let updateTimeout = Date.now()

			while (true){
				try{
					const r = await getInfo().then((r)=>{return r.data})
					console.log(r)
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
					// mainWindow.webContents.send('vlc-status', r.data)
					stateVLC = r.state
					if (currentState === undefined){
						currentState = stateVLC
					} else if (stateVLC === "stopped"){
						console.log("stopped..")
						continue
					}
					timeVLC = Math.floor(parseFloat(r.length) * parseFloat(r.position))
					if (currentTime === undefined || lastSentTime === undefined){
						currentTime = timeVLC
						lastSentTime = timeVLC
					}
					isplayingVLC = stateVLC != "paused"

					if (Date.now() - updateTimeout > 900) {
						updateTimeout = Date.now()
						const r = await makeRequest_server("/get_playerstatus")
						// mainWindow.webContents.send('server-status', r.data.data)
						const isplayingServer = r.is_playing
						const time = r.time
						const me = r.users.value[USERID]
						if (!me.uptodate){
							console.log("not up to date!!!")
							const timeABSserver = Math.abs(time.value - timeVLC)
							const url = r.url
							if (isplayingServer.user != USERID && isplayingServer.value != isplayingVLC){
								await setPlaying(isplayingServer.value)
								if (isplayingServer.value === "paused"){
									currentState = "paused"
								} else {
									currentState = "playing"
								}
								console.log(`set_playing ${isplayingVLC}, ${isplayingServer.value}`)
							}
							if (time.user != USERID && timeABSserver > 5) {
								await setTime(time.value)
								currentTime = time.value
								lastSentTime = time.value
								console.log(`set_time ${timeABSserver} ${timeVLC} ${time.value}`)
							}
							if (url.user != USERID && url.value != CURRENT_VIDEO) {
								await setVideo(url.value)
								console.log("!!!!!setvideo")
							}
							await makeRequest_server("/imuptodate")
							console.log("it is up to date now!!!")
							continue
						} else {
							// console.log("checks for up to date regular!!!")
							if (isplayingVLC != isplayingServer.value) {
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

					currentState = stateVLC
					if (currentState != "ended") {
						currentTime = timeVLC
					}
				} catch (err) {
					// console.log(err)
					console.log("some errorrrrrr!!!")
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