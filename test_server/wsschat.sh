#!/bin/bash
uvicorn wsschat:app --reload --host 0.0.0.0 --port 8086 --workers 4 --log-level info --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem" #--ws-max-size in_bytes
