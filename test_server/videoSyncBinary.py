import struct
from enum import IntEnum
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from fastapi import WebSocket
import logging

logger = logging.getLogger("videoSyncBinary")

# opcodes
class OP(IntEnum):
    TIME = 0x01
    STATE = 0x02
    URL = 0x03
    SYNC_REQ = 0x04
    INIT = 0x05
    ACK = 0x06
    UPTODATE = 0x07
    SUBTITLE_FLAG = 0x08

ACK_SUCCESS = 1
ACK_FAIL = 0

@dataclass
class PlayerState:
    url: str = ""
    time: int = 0
    is_playing: bool = False
    subtitle_exist: bool = False
    url_user: str = ""
    time_user: str = ""
    playing_user: str = ""

@dataclass
class Connection:
    websocket: WebSocket
    user: str
    is_uptodate: bool = False
    last_action_time: dict = field(default_factory=dict)

class Room:
    def __init__(self, roomid: str):
        self.roomid = roomid
        self.state = PlayerState()
        self.connections: dict[str, Connection] = {}
        self.timeout_secs = 0.5
    
    def add_connection(self, user: str, websocket: WebSocket) -> Optional[Connection]:
        existing = self.connections.get(user)
        if existing:
            return existing
        conn = Connection(websocket=websocket, user=user, is_uptodate=False)
        self.connections[user] = conn
        return None
    
    def remove_connection(self, user: str):
        self.connections.pop(user, None)
    
    def get_connection(self, user: str) -> Optional[Connection]:
        return self.connections.get(user)
    
    def mark_all_not_uptodate(self, except_user: str):
        for user, conn in self.connections.items():
            conn.is_uptodate = (user == except_user)
    
    def can_update(self, user: str, action: str, timeout_pass: bool = False) -> bool:
        conn = self.connections.get(user)
        if not conn:
            return False
        if timeout_pass:
            return True
        if not conn.is_uptodate:
            logger.debug(f"{user} not uptodate, rejecting update")
            return False
        if action == 'time':
            now = datetime.now()
            last = conn.last_action_time.get(action)
            if last and (now - last) < timedelta(seconds=self.timeout_secs):
                logger.debug(f"{user} timeout not passed for {action}")
                return False
            conn.last_action_time[action] = now
        return True

class BinaryProtocol:
		# convert values to raw bytes for network transmission - pack values into bytes
    @staticmethod
    def encode_time(time: int, request_id: int = 0, passive: bool = False) -> bytes:
        # bits 0-6 store request_id (max 127), bit 7 stores passive flag
        flags = (request_id & 0x7F) | (0x80 if passive else 0) 
        return struct.pack('>BBL', OP.TIME, flags, int(time)) # [opcode:1B][flags:1B][time:4B] = 6 bytes
    
    @staticmethod
    def encode_state(is_playing: bool, time: int, request_id: int = 0) -> bytes:
        # >BBBL = 1B opcode, 1B req_id, 1B playing, 4B time
        return struct.pack('>BBBL', OP.STATE, request_id & 0x7F, 1 if is_playing else 0, int(time))
    
    @staticmethod
    def encode_url(url: str, request_id: int = 0) -> bytes:
        url_bytes = url.encode('utf-8')
        # >BBH{n}s = 1B opcode, 1B req_id, 2B url_len, nB url
        return struct.pack(f'>BBH{len(url_bytes)}s', OP.URL, request_id & 0x7F, len(url_bytes), url_bytes)
    
    @staticmethod
    def encode_init(state: PlayerState, request_id: int = 0) -> bytes:
        url_bytes = state.url.encode('utf-8')
        # >BBH{n}sLBB = 1B op, 1B req_id, 2B url_len, nB url, 4B time, 1B playing, 1B subtitle
        return struct.pack(
            f'>BBH{len(url_bytes)}sLBB',
            OP.INIT,
            request_id & 0x7F,
            len(url_bytes),
            url_bytes,
            int(state.time),
            1 if state.is_playing else 0,
            1 if state.subtitle_exist else 0
        )
    
    @staticmethod
    def encode_ack(success: bool, request_id: int = 0, error: Optional[str] = None) -> bytes:
        if error:
            err_bytes = error.encode('utf-8')[:255]
            # with error: 1B op, 1B req_id, 1B status, 1B err_len, nB err
            return struct.pack(f'>BBBB{len(err_bytes)}s', OP.ACK, request_id & 0x7F, ACK_FAIL, len(err_bytes), err_bytes)
        # no error: 1B op, 1B req_id, 1B status
        return struct.pack('>BBB', OP.ACK, request_id & 0x7F, ACK_SUCCESS if success else ACK_FAIL)
    
    @staticmethod
    def encode_subtitle_flag(exists: bool, request_id: int = 0) -> bytes:
        return struct.pack('>BBB', OP.SUBTITLE_FLAG, request_id & 0x7F, 1 if exists else 0)
    
		# convert raw bytes back to values - unpacks bytes to values
    @staticmethod
    def decode(data: bytes) -> Optional[dict]:
        # data[i] reads single byte
        if len(data) < 2:
            return None
        opcode = data[0]
        flags = data[1]
        # 0x7F = 01111111, masks out bit 7, keeps bits 0-6
        # 0x80 = 10000000, checks if bit 7 is set
        request_id = flags & 0x7F
        timeout_pass = bool(flags & 0x80)
        
        try:
            if opcode == OP.TIME:
                if len(data) < 6:
                    return None
                # >L = 4B unsigned long (time in seconds)
                time = struct.unpack('>L', data[2:6])[0]
                return {'type': 'time', 'request_id': request_id, 'time': time, 'timeout_pass': timeout_pass}
            
            elif opcode == OP.STATE:
                if len(data) < 7:
                    return None
                is_playing = data[2] == 1
                time = struct.unpack('>L', data[3:7])[0]
                return {'type': 'state', 'request_id': request_id, 'is_playing': is_playing, 'time': time}
            
            elif opcode == OP.URL:
                if len(data) < 4:
                    return None
                # >H = 2B unsigned short (url length)
                url_len = struct.unpack('>H', data[2:4])[0]
                if len(data) < 4 + url_len:
                    return None
                url = data[4:4+url_len].decode('utf-8')
                return {'type': 'url', 'request_id': request_id, 'url': url}
            
            elif opcode == OP.SYNC_REQ:
                return {'type': 'sync_req', 'request_id': request_id}
            
            elif opcode == OP.UPTODATE:
                return {'type': 'uptodate', 'request_id': request_id}
            
            else:
                return None
        except Exception as e:
            logger.error(f"Decode error: {e}")
            return None

class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
    
    def get_or_create_room(self, roomid: str) -> Room:
        if roomid not in self.rooms:
            self.rooms[roomid] = Room(roomid)
        return self.rooms[roomid]
    
    def get_room(self, roomid: str) -> Optional[Room]:
        return self.rooms.get(roomid)
    
    def cleanup_empty_rooms(self):
        pass
    
    def get_all_states(self) -> dict:
        return {rid: room.state for rid, room in self.rooms.items()}
