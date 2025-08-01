



window.electronAPI.onVLCstatus((data) => {
	console.log('VLC Status:', data)
})



window.electronAPI.onServerStatus((data) => {
	console.log('SERVER Status:', data)
})



document.addEventListener('DOMContentLoaded', async () => {
	const url = "https://www.sample-videos.com/video321/mp4/240/big_buck_bunny_240p_30mb.mp4"
	const currentsec = 0
	await window.electronAPI.openVLC(url, currentsec)
	
});