import requests
import sys
import os
import time
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

PASSWORD = os.getenv("VERSION_UPLOAD_PASSWORD")
SERVER = os.getenv("UPDATES_SERVER")


def format_bytes(b):
    if b < 1024**2:
        return f"{b/1024:.1f}KB"
    elif b < 1024**3:
        return f"{b/(1024**2):.1f}MB"
    else:
        return f"{b/(1024**3):.1f}GB"

def chunked_upload(file_path, version, os_type, notes="Update"):
    file_path = Path(file_path)
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return False
    
    file_size = file_path.stat().st_size
    print(f"Uploading {file_path.name} ({format_bytes(file_size)})")
    
    start_data = {
        "filename": file_path.name,
        "total_size": file_size,
        "version": version,
        "notes": notes,
        "password": PASSWORD
    }
    
    response = requests.post(f"{SERVER}/upload/start", data=start_data)
    if response.status_code != 200:
        print(f"Start failed: {response.text}")
        return False
    
    upload_data = response.json()
    upload_id = upload_data["upload_id"]
    chunk_size = upload_data["chunk_size"]
    
    chunk_number = 0
    start_time = time.time()
    
    with open(file_path, "rb") as f:
        while True:
            chunk_data = f.read(chunk_size)
            if not chunk_data:
                break
            
            files = {"chunk": ("chunk", chunk_data)}
            data = {"upload_id": upload_id, "chunk_number": chunk_number, "password": PASSWORD}
            
            response = requests.post(f"{SERVER}/upload/chunk", files=files, data=data)
            if response.status_code != 200:
                print(f"Chunk {chunk_number} failed: {response.text}")
                return False
            
            result = response.json()
            progress = result["progress"]
            uploaded = result["uploaded"]
            
            elapsed = time.time() - start_time
            speed = uploaded / elapsed if elapsed > 0 else 0
            remaining = (file_size - uploaded) / speed if speed > 0 else 0
            
            print(f"\r{progress:5.1f}% | {format_bytes(uploaded)}/{format_bytes(file_size)} | {format_bytes(speed)}/s | {remaining:.0f}s", end="")
            
            chunk_number += 1
    
    print()
    
    complete_data = {"upload_id": upload_id, "password": PASSWORD, "os_type": os_type}
    response = requests.post(f"{SERVER}/upload/complete", data=complete_data)
    
    if response.status_code != 200:
        print(f"Complete failed: {response.text}")
        return False
    
    result = response.json()
    print(f"Completed: {result['version']} - {result['file']}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python chunked_upload.py <file> <version> <os_type> [notes]")
        exit(1)
    
    file_path = sys.argv[1]
    version = sys.argv[2]
    os_type = sys.argv[3]
    notes = sys.argv[4]
    
    chunked_upload(file_path, version, os_type, notes)