const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	openVLC: (url, currentsec) => ipcRenderer.invoke('open-vlc', url, currentsec),
	setVideo: (url) => ipcRenderer.invoke('setvideo-vlc', url),
	setTime: (time) => ipcRenderer.invoke('settime-vlc', time),
	setPlaying: (is_playing) => ipcRenderer.invoke('setplaying-vlc', is_playing),
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
