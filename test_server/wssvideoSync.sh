#!/bin/bash
uvicorn wssvideoSync:app --host 0.0.0.0 --port 8085 --ssl-keyfile "/etc/letsencrypt/live/turkuazz.vip/privkey.pem" --ssl-certfile "/etc/letsencrypt/live/turkuazz.vip/fullchain.pem"
