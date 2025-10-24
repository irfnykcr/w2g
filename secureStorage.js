const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

let STORAGE_FILE
let store = {}
let isInitialized = false

const init = () => {
	if (isInitialized) return
	STORAGE_FILE = path.join(app.getPath('userData'), 'credentials.dat')
	loadStore()
	isInitialized = true
}

const loadStore = () => {
	try {
		if (fs.existsSync(STORAGE_FILE)) {
			const encrypted = fs.readFileSync(STORAGE_FILE)
			const decrypted = safeStorage.decryptString(encrypted)
			store = JSON.parse(decrypted)
		}
	} catch (err) {
		console.error('Failed to load credentials:', err)
		store = {}
	}
}

const saveStore = () => {
	try {
		const json = JSON.stringify(store)
		const encrypted = safeStorage.encryptString(json)
		fs.writeFileSync(STORAGE_FILE, encrypted)
	} catch (err) {
		console.error('Failed to save credentials:', err)
	}
}

const getPassword = async (service, account) => {
	init()
	const key = `${service}:${account}`
	return store[key] || null
}

const setPassword = async (service, account, password) => {
	init()
	const key = `${service}:${account}`
	store[key] = password
	saveStore()
}

const deletePassword = async (service, account) => {
	init()
	const key = `${service}:${account}`
	delete store[key]
	saveStore()
}

module.exports = {
	getPassword,
	setPassword,
	deletePassword
}
