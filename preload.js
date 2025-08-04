const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	openVLC: (url, currentsec) => ipcRenderer.invoke('open-vlc', url, currentsec),
    setVideoVLC: (url) => ipcRenderer.invoke('setvideo-vlc', url),
    // setTime: (time) => ipcRenderer.invoke('settime-vlc', time),
	getUser: () => ipcRenderer.invoke('get-user'),
	getUserPsw: () => ipcRenderer.invoke('get-userpsw'),
	getRoom: () => ipcRenderer.invoke('get-room'),
	getRoomPsw: () => ipcRenderer.invoke('get-roompsw'),
	getServerEndpoint: () => ipcRenderer.invoke('get-serverendpoint'),
	// setPlaying: (is_playing) => ipcRenderer.invoke('setplaying-vlc', is_playing),
	onVLCstatus: (callback) => {
        ipcRenderer.on('vlc-status', (_, data) => {
            callback(data)
        })
    },
	onServerStatus: (callback) => {
        ipcRenderer.on('server-status', (_, data) => {
            callback(data)
        })
    }
})
