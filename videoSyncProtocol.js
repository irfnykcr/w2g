const WebSocket = require('ws')

const OP = {
    TIME: 0x01,
    STATE: 0x02,
    URL: 0x03,
    SYNC_REQ: 0x04,
    INIT: 0x05,
    ACK: 0x06,
    UPTODATE: 0x07,
    SUBTITLE_FLAG: 0x08
}

const ACK_SUCCESS = 1
const ACK_FAIL = 0

const MAX_TIME = 0xFFFFFFFF
const MAX_URL_LENGTH = 2048

class VideoSyncClient {
    constructor(logger) {
        this.logger = logger
        this.ws = null
        this.state = {
            url: '',
            time: 0,
            isPlaying: false,
            subtitleExist: false,
            isUpToDate: false
        }
        this.pendingRequests = new Map()
        this.requestId = 0
        this.onStateChange = null
        this.onUrlChange = null
        this.onTimeChange = null
        this.onPlayingChange = null
        this.onSubtitleFlag = null
        this.onConnectionChange = null
        this.reconnectTimeout = null
        this.lastConnectionAttempt = 0
    }

    clampTime(time) {
        if (typeof time !== 'number' || isNaN(time) || time < 0) return 0
        return Math.min(Math.floor(time), MAX_TIME)
    }

		// convert values to raw bytes for network transmission
    encodeTime(time, requestId = 0, timeoutPass = false) {
        const buf = Buffer.alloc(6) // 6 bytes
        buf.writeUInt8(OP.TIME, 0) // write opcode at byte 0
        // flags byte: bits 0-6 store requestId (max 127), bit 7 stores timeoutPass
        buf.writeUInt8((requestId & 0x7F) | (timeoutPass ? 0x80 : 0), 1) // write flags at byte 1
        buf.writeUInt32BE(this.clampTime(time), 2) // write time at bytes 2-5
        return buf // [opcode:1B][flags:1B][time:4B] = 6 bytes
    }

    encodeState(isPlaying, time, requestId = 0) {
        // 7 bytes: 1B opcode, 1B req_id, 1B playing, 4B time
        const buf = Buffer.alloc(7)
        buf.writeUInt8(OP.STATE, 0)
        buf.writeUInt8(requestId & 0x7F, 1)
        buf.writeUInt8(isPlaying ? 1 : 0, 2)
        buf.writeUInt32BE(this.clampTime(time), 3)
        return buf
    }

    encodeUrl(url, requestId = 0) {
        const truncUrl = url.slice(0, MAX_URL_LENGTH)
        const urlBuf = Buffer.from(truncUrl, 'utf8')
        // 4 + n bytes: 1B opcode, 1B req_id, 2B url_len, nB url
        const buf = Buffer.alloc(4 + urlBuf.length)
        buf.writeUInt8(OP.URL, 0)
        buf.writeUInt8(requestId & 0x7F, 1)
        buf.writeUInt16BE(urlBuf.length, 2)
        urlBuf.copy(buf, 4)
        return buf
    }

    encodeSyncReq(requestId = 0) {
        const buf = Buffer.alloc(2)
        buf.writeUInt8(OP.SYNC_REQ, 0)
        buf.writeUInt8(requestId & 0x7F, 1)
        return buf
    }

    encodeUpToDate(requestId = 0) {
        const buf = Buffer.alloc(2)
        buf.writeUInt8(OP.UPTODATE, 0)
        buf.writeUInt8(requestId & 0x7F, 1)
        return buf
    }

		// convert raw bytes back to values
    decodeMessage(data) {
        if (!Buffer.isBuffer(data)) {
            data = Buffer.from(data)
        }
        if (data.length < 2) return null // need at least opcode + flags

        const opcode = data.readUInt8(0) // read opcode at byte 0
        const flags = data.readUInt8(1)  // read flags at byte 1
        // 0x7F = 01111111, masks out bit 7, keeps bits 0-6
        // 0x80 = 10000000, checks if bit 7 is set
        const requestId = flags & 0x7F
        const passive = (flags & 0x80) !== 0

        switch (opcode) {
            case OP.TIME: {
                if (data.length < 6) return null // need 6 bytes for TIME
                return {
                    type: 'time',
                    requestId,
                    time: data.readUInt32BE(2), // read time at bytes 2-5
                    passive
                }
            }
            case OP.STATE: {
                if (data.length < 7) return null
                return {
                    type: 'state',
                    requestId,
                    isPlaying: data.readUInt8(2) === 1,
                    time: data.readUInt32BE(3)
                }
            }
            case OP.URL: {
                if (data.length < 4) return null
                const urlLen = data.readUInt16BE(2)
                if (data.length < 4 + urlLen) return null
                return {
                    type: 'url',
                    requestId,
                    url: data.slice(4, 4 + urlLen).toString('utf8')
                }
            }
            case OP.INIT: {
                if (data.length < 8) return null
                const urlLen = data.readUInt16BE(2)
                if (data.length < 10 + urlLen) return null
                return {
                    type: 'init',
                    requestId,
                    url: data.slice(4, 4 + urlLen).toString('utf8'),
                    time: data.readUInt32BE(4 + urlLen),
                    isPlaying: data.readUInt8(8 + urlLen) === 1,
                    subtitleExist: data.readUInt8(9 + urlLen) === 1
                }
            }
            case OP.ACK: {
                if (data.length < 3) return null
                const success = data.readUInt8(2) === ACK_SUCCESS
                let error = null
                if (data.length > 3) {
                    const errLen = data.readUInt8(3)
                    if (data.length >= 4 + errLen) {
                        error = data.slice(4, 4 + errLen).toString('utf8')
                    }
                }
                return {
                    type: 'ack',
                    requestId,
                    success,
                    error
                }
            }
            case OP.SUBTITLE_FLAG: {
                if (data.length < 3) return null
                return {
                    type: 'subtitle_flag',
                    requestId,
                    exists: data.readUInt8(2) === 1
                }
            }
            default:
                return null
        }
    }

    async connect(serverEndpoint, user, userPsw, roomId, roomPsw) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return true
        }

        const now = Date.now()
        if (now - this.lastConnectionAttempt < 3000) {
            return false
        }
        this.lastConnectionAttempt = now

        if (this.ws) {
            try { this.ws.close() } catch {}
            this.ws = null
        }

        const wsUrl = `wss://${serverEndpoint}/videosync/?user=${encodeURIComponent(user)}&psw=${encodeURIComponent(userPsw)}&roomid=${encodeURIComponent(roomId)}&roompsw=${encodeURIComponent(roomPsw)}`

        return new Promise((resolve) => {
            try {
                this.ws = new WebSocket(wsUrl)
                this.ws.binaryType = 'nodebuffer'

                this.ws.on('open', () => {
                    this.logger.info('VideoSync binary WebSocket connected')
                    this.state.isUpToDate = false
                    if (this.onConnectionChange) this.onConnectionChange(true)
                    resolve(true)
                })

                this.ws.on('message', (data) => {
                    this.handleMessage(data)
                })

                this.ws.on('close', () => {
                    this.logger.warn('VideoSync WebSocket disconnected')
                    this.clearPendingRequests('Connection closed')
                    this.ws = null
                    this.state.isUpToDate = false
                    if (this.onConnectionChange) this.onConnectionChange(false)
                })

                this.ws.on('error', (err) => {
                    this.logger.error('VideoSync WebSocket error:', err.message)
                    this.clearPendingRequests(err.message)
                    if (this.onConnectionChange) this.onConnectionChange(false)
                    resolve(false)
                })
            } catch (err) {
                this.logger.error('Failed to create WebSocket:', err.message)
                resolve(false)
            }
        })
    }

    disconnect() {
        this.clearPendingRequests('Disconnecting')
        if (this.ws) {
            try { this.ws.close() } catch {}
            this.ws = null
        }
        this.state.isUpToDate = false
        if (this.onConnectionChange) this.onConnectionChange(false)
    }

    clearPendingRequests(reason) {
        for (const [id, { reject }] of this.pendingRequests.entries()) {
            try { reject(new Error(reason)) } catch {}
        }
        this.pendingRequests.clear()
    }

    handleMessage(data) {
        const msg = this.decodeMessage(data)
        if (!msg) {
            this.logger.warn('Failed to decode binary message')
            return
        }

        if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
            const { resolve } = this.pendingRequests.get(msg.requestId)
            this.pendingRequests.delete(msg.requestId)
            resolve(msg)
            if (msg.type !== 'ack' && msg.type !== 'init') {
                this.processStateUpdate(msg)
            }
            return
        }

        this.processStateUpdate(msg)
    }

    processStateUpdate(msg) {
        switch (msg.type) {
            case 'init':
                this.state.url = msg.url
                this.state.time = msg.time
                this.state.isPlaying = msg.isPlaying
                this.state.subtitleExist = msg.subtitleExist
                this.state.isUpToDate = false
                if (this.onStateChange) this.onStateChange(this.state)
                break
            case 'url':
                this.state.url = msg.url
                this.state.time = 0
                this.state.isPlaying = true
                this.state.subtitleExist = false
                this.state.isUpToDate = false
                if (this.onUrlChange) this.onUrlChange(msg.url)
                break
            case 'time':
                this.state.time = msg.time
                if (!msg.passive) {
                    this.state.isUpToDate = false
                }
                if (this.onTimeChange) this.onTimeChange(msg.time, msg.passive)
                break
            case 'state':
                this.state.isPlaying = msg.isPlaying
                this.state.time = msg.time
                this.state.isUpToDate = false
                if (this.onPlayingChange) this.onPlayingChange(msg.isPlaying, msg.time)
                break
            case 'subtitle_flag':
                this.state.subtitleExist = msg.exists
                if (this.onSubtitleFlag) this.onSubtitleFlag(msg.exists)
                break
        }
    }

    async send(buffer, expectAck = true) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return { success: false, error: 'Not connected' }
        }

        const requestId = (++this.requestId) & 0x7F
        if (requestId === 0) this.requestId = 1
        buffer.writeUInt8((buffer.readUInt8(1) & 0x80) | requestId, 1)

        if (!expectAck) {
            this.ws.send(buffer)
            return { success: true }
        }

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject })

            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId)
                    resolve({ success: false, error: 'Timeout' })
                }
            }, 2000)

            try {
                this.ws.send(buffer)
            } catch (err) {
                this.pendingRequests.delete(requestId)
                resolve({ success: false, error: err.message })
            }
        })
    }

    async updateTime(time, timeoutPass = false) {
        const buf = this.encodeTime(time, 0, timeoutPass)
        const result = await this.send(buf)
        if (result.success || (result.type === 'ack' && result.success)) {
            this.state.time = time
            this.state.isUpToDate = true
        }
        return result
    }

    async updateState(isPlaying, time) {
        const buf = this.encodeState(isPlaying, time)
        const result = await this.send(buf)
        if (result.success || (result.type === 'ack' && result.success)) {
            this.state.isPlaying = isPlaying
            this.state.time = time
            this.state.isUpToDate = true
        }
        return result
    }

    async updateUrl(url) {
        const buf = this.encodeUrl(url)
        const result = await this.send(buf)
        if (result.success || (result.type === 'ack' && result.success)) {
            this.state.url = url
            this.state.time = 0
            this.state.isPlaying = true
            this.state.subtitleExist = false
            this.state.isUpToDate = true
        }
        return result
    }

    async requestSync() {
        const buf = this.encodeSyncReq()
        return await this.send(buf)
    }

    async markUpToDate() {
        const buf = this.encodeUpToDate()
        const result = await this.send(buf, false)
        if (result.success) {
            this.state.isUpToDate = true
        }
        return result
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN
    }

    getState() {
        return { ...this.state }
    }
}

module.exports = { VideoSyncClient, OP, ACK_SUCCESS, ACK_FAIL }
