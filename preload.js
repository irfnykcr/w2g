const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	openVLC: (url, currentsec) => ipcRenderer.invoke('open-vlc', url, currentsec),
	setVideoVLC: (url) => ipcRenderer.invoke('setvideo-vlc', url),
	getVLCStatus: () => ipcRenderer.invoke('get-vlc-status'),

	setUserCreds: (user, userpsw) => ipcRenderer.invoke('set-usercreds', user, userpsw),
	setRoomCreds: (roomid, roompsw) => ipcRenderer.invoke('set-roomcreds', roomid, roompsw),
	showInputDialog: (message) => ipcRenderer.invoke('show-input-dialog', message),
	getUser: () => ipcRenderer.invoke('get-user'),
	logoutUser: () => ipcRenderer.invoke('logout-user'),
	getRoom: () => ipcRenderer.invoke('get-room'),
	leftTheRoom: () => ipcRenderer.invoke('left-room'),
	getServerEndpoint: () => ipcRenderer.invoke('get-serverendpoint'),

	onVLCstatus: (callback) => {
		ipcRenderer.on('vlc-status', (_, data) => {
			callback(data)
		})
	},
	onServerStatus: (callback) => {
		ipcRenderer.on('server-status', (_, data) => {
			callback(data)
		})
	},

	gotoRoomJoin: () => ipcRenderer.send('goto-room_join'),
	gotoIndex: () => ipcRenderer.send('goto-index'),
	gotoLogin: () => ipcRenderer.send('goto-login'),
})
