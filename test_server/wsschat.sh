#!/bin/bash
uvicorn wsschat:app --host 0.0.0.0 --port 8086 --workers 1 --log-level info --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem" --ws-ping-interval 20 --ws-ping-timeout 10 --timeout-keep-alive 65
