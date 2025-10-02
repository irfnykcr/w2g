#!/bin/bash
uvicorn wssvideoSync:app --host 0.0.0.0 --port 8085 --workers 1 --log-level info --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem" --timeout-keep-alive 600 --ws-ping-interval 30 --ws-ping-timeout 120
