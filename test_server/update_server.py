from fastapi import FastAPI, Form, HTTPException, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from json import dump, load
from hashlib import sha256, sha512, md5
import shutil
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
from os import getenv
import logging
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger("update_server")

PASSWORD_HASH = getenv("VERSION_UPLOAD_PASSWORD_HASH")
SERVER = getenv("UPDATES_SERVER")
def verify_password(password: str) -> bool:
    if not PASSWORD_HASH:
        return False
    password_hash = sha256(password.encode()).hexdigest()
    return password_hash == PASSWORD_HASH

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

updates_dir = Path("./updates")
updates_dir.mkdir(exist_ok=True)
(updates_dir / "downloads").mkdir(exist_ok=True)
(updates_dir / "downloads" / "windows").mkdir(exist_ok=True)
(updates_dir / "downloads" / "linux").mkdir(exist_ok=True)
(updates_dir / "downloads" / "darwin").mkdir(exist_ok=True)

def get_sha512(file_path):
    h = sha512()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            h.update(chunk)
    return h.hexdigest()

def remove_old_versions(os_type):
    downloads_dir = updates_dir / "downloads" / os_type
    if downloads_dir.exists():
        for file_path in downloads_dir.iterdir():
            if file_path.is_file():
                file_path.unlink()

@app.get("/latest-linux.yml")
def get_latest_linux(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Version check from {client_ip}: Linux latest.yml requested")
    
    yml_file = updates_dir / "downloads" / "linux" / "latest.yml"
    if yml_file.exists():
        return FileResponse(yml_file, media_type="text/yaml")
    raise HTTPException(status_code=404, detail="No version available")

@app.get("/latest-mac.yml")
def get_latest_mac(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Version check from {client_ip}: macOS latest.yml requested")
    
    yml_file = updates_dir / "downloads" / "darwin" / "latest.yml"
    if yml_file.exists():
        return FileResponse(yml_file, media_type="text/yaml")
    raise HTTPException(status_code=404, detail="No version available")

@app.get("/latest.yml")
def get_latest_windows(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Version check from {client_ip}: Windows latest.yml requested")
    
    yml_file = updates_dir / "downloads" / "windows" / "latest.yml"
    if yml_file.exists():
        return FileResponse(yml_file, media_type="text/yaml")
    raise HTTPException(status_code=404, detail="No version available")

@app.get("/downloads/{filename}")
def download(filename: str, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Download request from {client_ip}: {filename}")
    
    print(f"got request for: {filename}")
    for os_type in ["linux", "darwin", "windows"]:
        file_path = updates_dir / "downloads" / os_type / filename
        if file_path.exists():
            print(f"found in: {os_type}")
            
            def file_generator():
                with open(file_path, "rb") as f:
                    while True:
                        chunk = f.read(8192)
                        if not chunk:
                            break
                        yield chunk
            
            headers = {
                "Content-Length": str(file_path.stat().st_size),
                "Accept-Ranges": "bytes",
                "Content-Disposition": f"attachment; filename=\"{filename}\"",
                "Cache-Control": "no-cache, no-store, must-revalidate"
            }
            return StreamingResponse(
                file_generator(), 
                media_type="application/octet-stream",
                headers=headers
            )
    raise HTTPException(status_code=404, detail="File not found")

@app.post("/upload/start")
def start_upload(
    request: Request,
    filename: str = Form(...),
    total_size: int = Form(...),
    version: str = Form(...),
    notes: str = Form("Update"),
    sha512: str = Form(...),
    password: str = Form("")
):
    client_ip = request.client.host if request.client else "unknown"
    logger.info(f"Upload start from {client_ip}: {filename} v{version} ({total_size} bytes)")
    
    if not verify_password(password):
        raise HTTPException(status_code=401, detail="Invalid password")
    
    if not filename.endswith(('.exe', '.AppImage')):
        raise HTTPException(status_code=400, detail="Only .exe and .AppImage files allowed")
    
    upload_id = md5(f"{filename}{datetime.now()}".encode()).hexdigest()
    (updates_dir / "temp").mkdir(exist_ok=True)
    
    upload_info = {
        "filename": filename,
        "total_size": total_size,
        "version": version,
        "notes": notes,
        "sha512": sha512,
        "upload_path": str(updates_dir / "temp" / f"{upload_id}_{filename}")
    }
    
    with open(updates_dir / "temp" / f"{upload_id}.json", "w") as f:
        dump(upload_info, f)
    
    return {"upload_id": upload_id, "chunk_size": 5242880}

@app.post("/upload/chunk/{upload_id}/{chunk_number}")
async def upload_chunk(
    upload_id: str,
    chunk_number: int,
    request: Request,
    password: str = Query(...)
):
    client_ip = request.client.host if request.client else "unknown"
    
    if not verify_password(password):
        raise HTTPException(status_code=401, detail="Invalid password")
    upload_info_file = updates_dir / "temp" / f"{upload_id}.json"
    if not upload_info_file.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    
    with open(upload_info_file, "r") as f:
        upload_info = load(f)
    
    upload_path = Path(upload_info["upload_path"])
    
    chunk_data = await request.body()
    with open(upload_path, "ab") as f:
        f.write(chunk_data)
    
    current_size = upload_path.stat().st_size if upload_path.exists() else 0
    progress = (current_size / upload_info["total_size"]) * 100
    
    logger.info(f"Upload chunk from {client_ip}: {upload_info['filename']} chunk {chunk_number} - {progress:.1f}% ({current_size}/{upload_info['total_size']} bytes)")
    
    return {
        "chunk": chunk_number,
        "progress": round(progress, 2),
        "uploaded": current_size,
        "total": upload_info["total_size"]
    }

@app.post("/upload/complete")
def complete_upload(request: Request, upload_id: str = Form(...), os_type: str = Form(...), password: str = Form("")):
    client_ip = request.client.host if request.client else "unknown"
    
    if not verify_password(password):
        raise HTTPException(status_code=401, detail="Invalid password")
    upload_info_file = updates_dir / "temp" / f"{upload_id}.json"
    if not upload_info_file.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    
    with open(upload_info_file, "r") as f:
        upload_info = load(f)
    
    temp_path = Path(upload_info["upload_path"])
    if not temp_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    remove_old_versions(os_type)
    
    os_dir = updates_dir / "downloads" / os_type
    os_dir.mkdir(parents=True, exist_ok=True)
    final_path = os_dir / upload_info["filename"]
    shutil.move(str(temp_path), str(final_path))
    
    size = final_path.stat().st_size
    expected_size = upload_info["total_size"]
    
    if size != expected_size:
        final_path.unlink()
        raise HTTPException(status_code=400, detail=f"Size mismatch: expected {expected_size}, got {size}")
    
    uploaded_sha = get_sha512(final_path)
    expected_sha = upload_info["sha512"]
    
    if uploaded_sha != expected_sha:
        final_path.unlink()
        raise HTTPException(status_code=400, detail=f"SHA512 mismatch: expected {expected_sha}, got {uploaded_sha}")
    
    yml_content = f"""version: {upload_info["version"]}
files:
  - url: downloads/{upload_info["filename"]}
    sha512: {expected_sha}
    size: {size}
path: downloads/{upload_info["filename"]}
releaseDate: '{datetime.now().isoformat()}Z'"""
    
    (os_dir / "latest.yml").write_text(yml_content)
    
    upload_info_file.unlink()
    
    logger.info(f"Upload completed from {client_ip}: {upload_info['filename']} v{upload_info['version']} ({size} bytes) for {os_type}")
    
    return {"version": upload_info["version"], "file": upload_info["filename"]}