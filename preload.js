const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	openVLC: (url, currentsec) => ipcRenderer.invoke('open-vlc', url, currentsec),
	setvideoVLC: (url) => ipcRenderer.invoke('setvideo-vlc', url),
	getVLCStatus: () => ipcRenderer.invoke('get-vlc-status'),
	getWatchersStatus: () => ipcRenderer.invoke('get-watchers-status'),
	
	startInlineVideo: () => ipcRenderer.invoke('start-inline-video'),
	setInlineVideo: (url) => ipcRenderer.invoke('set-inline-video', url),
	stopInlineVideo: () => ipcRenderer.invoke('stop-inline-video'),
	stopVLC: () => ipcRenderer.invoke('stop-vlc'),

	setUserCreds: (user, userpsw) => ipcRenderer.invoke('set-usercreds', user, userpsw),
	setRoomCreds: (roomid, roompsw) => ipcRenderer.invoke('set-roomcreds', roomid, roompsw),
	showInputDialog: (message) => ipcRenderer.invoke('show-input-dialog', message),
	getUser: () => ipcRenderer.invoke('get-user'),
	logoutUser: () => ipcRenderer.invoke('logout-user'),
	getRoom: () => ipcRenderer.invoke('get-room'),
	leftTheRoom: () => ipcRenderer.invoke('left-room'),
	getServerEndpoint: () => ipcRenderer.invoke('get-serverendpoint'),
	
	getConfig: () => ipcRenderer.invoke('get-config'),
	saveConfig: (vlcport, serverendpoint, vlcfinder, vlcpath, vlchttppass) => ipcRenderer.invoke('save-config', vlcport, serverendpoint, vlcfinder, vlcpath, vlchttppass),
	
	setSubtitle: (fileData, fileName) => ipcRenderer.invoke('set-subtitle', fileData, fileName),
	addSubtitleVLC: (filePath) => ipcRenderer.invoke('add-subtitle-vlc', filePath),
	uploadSubtitle: (arrayBuffer, filename) => ipcRenderer.invoke('upload-subtitle', arrayBuffer, filename),
	requestSubtitles: () => ipcRenderer.invoke('request-subtitles'),

	onVLCstatus: (callback) => {
		ipcRenderer.on('vlc-status', (_, data) => {
			callback(data)
		})
	},

	onInlineVideoStart: (callback) => {
		ipcRenderer.on('inline-video-start', (_, data) => {
			callback(data)
		})
	},
	onInlineVideoSet: (callback) => {
		ipcRenderer.on('inline-video-set', (_, data) => {
			callback(data)
		})
	},
	onInlineVideoStop: (callback) => {
		ipcRenderer.on('inline-video-stop', (_, data) => {
			callback(data)
		})
	},
	onInlineVideoGetStatusSync: (callback) => {
		ipcRenderer.on('inline-video-get-status-sync', (_, data) => {
			callback(data)
		})
	},
	onInlineVideoSyncTime: (callback) => {
		ipcRenderer.on('inline-video-sync-time', (_, data) => {
			callback(data)
		})
	},
	onInlineVideoSyncPlaying: (callback) => {
		ipcRenderer.on('inline-video-sync-playing', (_, data) => {
			callback(data)
		})
	},
	sendInlineVideoStatusSync: (data) => ipcRenderer.invoke('inline-video-status-response-sync', data),
	
	onSubtitleReceived: (callback) => {
		ipcRenderer.on('subtitle-received', (_, data) => {
			callback(data)
		})
	},
	
	onSubtitleStatus: (callback) => {
		ipcRenderer.on('subtitle-status', (_, data) => {
			callback(data)
		})
	},
	
	onVideoSyncStatus: (callback) => {
		ipcRenderer.on('video-sync-status', (_, data) => {
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
