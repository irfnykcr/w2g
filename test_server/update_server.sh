#!/bin/bash
uvicorn update_server:app --host 0.0.0.0 --port 8087 --workers 4 --timeout-keep-alive 300 --log-level info --reload --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem"
