const { VideoSyncClient } = require('./videoSyncProtocol')
const axios = require('axios')

const isValidVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return false
    const trimmed = url.trim()
    if (trimmed.length === 0 || trimmed.length > 2048) return false
    if (trimmed.startsWith('-')) return false
    if (trimmed.includes('\0')) return false
    try {
        const parsed = new URL(trimmed)
        if (!['http:', 'https:'].includes(parsed.protocol)) return false
        return true
    } catch {
        return false
    }
}

class VideoSyncManager {
    constructor(logger) {
        this.logger = logger
        this.client = new VideoSyncClient(logger)
        this.serverEndpoint = null
        this.userId = null
        this.roomId = null
        this.secureStorage = null
        this.mainWindow = null
        this.isVLCwatching = false
        this.isInlineWatching = false
        this.subtitleCache = new Map()
        
        this.setupCallbacks()
    }

    setupCallbacks() {
        this.client.onConnectionChange = (connected) => {
            try {
                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
                    this.mainWindow.webContents.send('video-sync-status', { connected })
                }
            } catch {}
        }

        this.client.onUrlChange = async (url) => {
            this.logger.info('Server URL changed:', url)
            this.subtitleCache.clear()
            
            try {
                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
                    this.mainWindow.webContents.send('subtitle-status', { subtitle_exist: false })
                }
            } catch {}
            
            if (this.onUrlChange) {
                await this.onUrlChange(url)
            }
        }

        this.client.onTimeChange = async (time, passive) => {
            if (!passive) {
                this.logger.info('Server time changed:', time)
            }
            if (this.onTimeChange) {
                await this.onTimeChange(time, passive)
            }
        }

        this.client.onPlayingChange = async (isPlaying, time) => {
            this.logger.info('Server playing state changed:', isPlaying)
            if (this.onPlayingChange) {
                await this.onPlayingChange(isPlaying, time)
            }
        }

        this.client.onSubtitleFlag = async (exists) => {
            this.logger.info('Subtitle flag changed:', exists)
            try {
                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
                    this.mainWindow.webContents.send('subtitle-status', { subtitle_exist: exists })
                }
            } catch {}
            if (exists && this.onSubtitleAvailable) {
                await this.onSubtitleAvailable()
            }
            if (!exists) {
                this.subtitleCache.clear()
            }
        }

        this.client.onStateChange = (state) => {
            this.logger.info('Full state received:', state)
            try {
                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
                    this.mainWindow.webContents.send('subtitle-status', { subtitle_exist: state.subtitleExist })
                }
            } catch {}
        }
    }

    setConfig(serverEndpoint, userId, secureStorage) {
        this.serverEndpoint = serverEndpoint
        this.userId = userId
        this.secureStorage = secureStorage
    }

    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow
    }

    setRoomId(roomId) {
        this.roomId = roomId
    }

    async connect() {
        if (!this.serverEndpoint || !this.userId || !this.roomId || !this.secureStorage) {
            this.logger.warn('Cannot connect: missing configuration')
            return false
        }

        const userPsw = await this.secureStorage.getPassword('turkuazz', 'userpsw')
        const roomPsw = await this.secureStorage.getPassword('turkuazz', 'roompsw')

        return await this.client.connect(
            this.serverEndpoint,
            this.userId,
            userPsw,
            this.roomId,
            roomPsw
        )
    }

    disconnect() {
        this.client.disconnect()
    }

    isConnected() {
        return this.client.isConnected()
    }

    getState() {
        return this.client.getState()
    }

    async updateTime(time, timeoutPass = false) {
        if (!this.isVLCwatching && !this.isInlineWatching) return { success: true }
        return await this.client.updateTime(time, timeoutPass)
    }

    async updateState(isPlaying, time) {
        if (!this.isVLCwatching && !this.isInlineWatching) return { success: true }
        return await this.client.updateState(isPlaying, time)
    }

    async updateUrl(url) {
        if (!this.isVLCwatching && !this.isInlineWatching) return { success: true }
        if (!isValidVideoUrl(url)) {
            this.logger.warn('Invalid URL rejected:', url ? url.substring(0, 100) : 'null')
            return { success: false, error: 'Invalid URL' }
        }
        this.subtitleCache.clear()
        return await this.client.updateUrl(url)
    }

    async requestSync() {
        return await this.client.requestSync()
    }

    async markUpToDate() {
        return await this.client.markUpToDate()
    }

    async uploadSubtitle(base64Data, filename) {
        if (!this.serverEndpoint || !this.userId || !this.roomId) {
            return { status: false, error: 'Not configured' }
        }

        try {
            const userPsw = await this.secureStorage.getPassword('turkuazz', 'userpsw')
            const roomPsw = await this.secureStorage.getPassword('turkuazz', 'roompsw')

            const response = await axios.post(
                `https://${this.serverEndpoint}/subtitle/upload`,
                {
                    user: this.userId,
                    psw: userPsw,
                    room: this.roomId,
                    roompsw: roomPsw,
                    subtitle_data: base64Data,
                    filename: filename
                },
                { timeout: 10000 }
            )
            return response.data
        } catch (error) {
            this.logger.error('Failed to upload subtitle:', error.message)
            return { status: false, error: error.message }
        }
    }

    async downloadSubtitle() {
        if (!this.serverEndpoint || !this.roomId) {
            return { status: false, error: 'Not configured' }
        }

        try {
            const roomPsw = await this.secureStorage.getPassword('turkuazz', 'roompsw')

            const response = await axios.post(
                `https://${this.serverEndpoint}/subtitle/download`,
                {
                    room: this.roomId,
                    roompsw: roomPsw
                },
                { timeout: 10000 }
            )
            return response.data
        } catch (error) {
            this.logger.error('Failed to download subtitle:', error.message)
            return { status: false, error: error.message }
        }
    }

    setWatchingState(vlc, inline) {
        this.isVLCwatching = vlc
        this.isInlineWatching = inline
    }
}

module.exports = { VideoSyncManager }
