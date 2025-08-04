#!/bin/bash
uvicorn server:app --reload --host "127.0.0.1" --port 8085 --workers 4 --log-level info --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem" #--ws-max-size in_bytes
