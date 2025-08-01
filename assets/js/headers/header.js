document.addEventListener("DOMContentLoaded", ()=>{
	const headerEl = document.querySelector("header")
	
	const makeheader = ()=>{
		headerEl.innerHTML = `
		<div class="flex items-center justify-between">
            <!-- Left side buttons -->
            <div class="flex space-x-4">
            </div>
            
            <!-- Center logo -->
            <div class="flex items-center space-x-2">
                <div class="w-8 h-8 bg-turkuazz rounded flex items-center justify-center">
                    <span class="text-dark-bg font-bold text-sm">T</span>
                </div>
                <span class="text-turkuazz font-bold text-xl">TURKUAZZ</span>
            </div>
            
            <!-- Right side -->
            <div class="flex items-center space-x-4">
            </div>
        </div>
		`
	}
	makeheader()
})