#!/bin/bash
uvicorn wsschat:app --host 0.0.0.0 --port 8086 --workers 1 --log-level info --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem" --timeout-keep-alive 65
