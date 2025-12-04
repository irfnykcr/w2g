import asyncio
import aiomysql
import logging
from os import getenv
from dotenv import load_dotenv
from bcrypt import checkpw

load_dotenv()

logger = logging.getLogger("async_db")

pool = None

async def init_pool():
	global pool
	if pool is None:
		pool = await aiomysql.create_pool(
			host=getenv("MYSQL_HOST"),
			user=getenv("MYSQL_USER"),
			password=getenv("MYSQL_PASSWORD"),
			db=getenv("MYSQL_DATABASE"),
			minsize=2,
			maxsize=10,
			autocommit=False
		)
	return pool

async def get_pool():
	global pool
	retries = 0
	while pool is None:
		await init_pool()
		if pool is None:
			retries += 1
			if retries > 5:
				raise Exception("Failed to initialize database connection pool")
			await asyncio.sleep(1)
	return pool

async def close_pool():
	global pool
	if pool:
		pool.close()
		await pool.wait_closed()
		pool = None

async def check_user(user: str, psw: str) -> bool:
	if not user or not psw:
		return False
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("SELECT password_hash FROM users WHERE user = %s", (user,))
				result = await cursor.fetchone()
				if result and checkpw(psw.encode(), result[0].encode()):
					return True
		return False
	except Exception as e:
		logger.error(f"check_user error: {e}")
		return False

async def check_room(roomid: str, roompsw: str) -> bool:
	if not roomid or not roompsw:
		return False
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("SELECT password_hash FROM rooms WHERE roomid = %s", (roomid,))
				result = await cursor.fetchone()
				if result and checkpw(roompsw.encode(), result[0].encode()):
					return True
		return False
	except Exception as e:
		logger.error(f"check_room error: {e}")
		return False

async def check_room_get_name(roomid: str, roompsw: str):
	if not roomid or not roompsw:
		return False
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("SELECT password_hash, name FROM rooms WHERE roomid = %s", (roomid,))
				result = await cursor.fetchone()
				if result and checkpw(roompsw.encode(), result[0].encode()):
					return result[1]
		return False
	except Exception as e:
		logger.error(f"check_room_get_name error: {e}")
		return False

async def get_user_image(username: str) -> str:
	if not username:
		return ""
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("SELECT imageurl FROM users WHERE user = %s", (username,))
				result = await cursor.fetchone()
				if result and result[0]:
					return result[0]
		return ""
	except Exception as e:
		logger.error(f"get_user_image error: {e}")
		return ""

async def add_to_history(roomid: str, user: str, url: str, success: bool):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"INSERT INTO room_history (roomid, user, link, success) VALUES (%s, %s, %s, %s)",
					(roomid, user, url, 1 if success else 0)
				)
				await conn.commit()
				from datetime import datetime
				return {
					"id": cursor.lastrowid,
					"user": user,
					"url": url,
					"success": success,
					"date": datetime.now().strftime("%Y-%m-%d %H:%M")
				}
	except Exception as e:
		logger.error(f"add_to_history error: {e}")
		return None

async def get_video_history(roomid: str, limit: int = 15):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"SELECT id, user, link, success, created_at FROM room_history WHERE roomid = %s ORDER BY id DESC LIMIT %s",
					(roomid, limit)
				)
				results = await cursor.fetchall()
				history = []
				for row in results:
					entry = {
						"id": row[0],
						"user": row[1],
						"url": row[2],
						"success": bool(row[3]),
						"date": row[4].strftime("%Y-%m-%d %H:%M") if row[4] else ""
					}
					history.append(entry)
				return history
	except Exception as e:
		logger.error(f"get_video_history error: {e}")
		return []

async def insert_message(roomid: str, user: str, message: str, message_type: str, reply_to=None):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"INSERT INTO messages (roomid, user, message, message_type, reply_to) VALUES (%s, %s, %s, %s, %s)",
					(roomid, user, message, message_type, reply_to)
				)
				await conn.commit()
				return cursor.lastrowid
	except Exception as e:
		logger.error(f"insert_message error: {e}")
		return None

async def get_message_by_id(message_id: int):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"SELECT user, message, removed FROM messages WHERE id = %s",
					(message_id,)
				)
				return await cursor.fetchone()
	except Exception as e:
		logger.error(f"get_message_by_id error: {e}")
		return None

async def get_message_owner(message_id: int, roomid: str):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"SELECT user, removed FROM messages WHERE id = %s AND roomid = %s",
					(message_id, roomid)
				)
				return await cursor.fetchone()
	except Exception as e:
		logger.error(f"get_message_owner error: {e}")
		return None

async def mark_message_removed(message_id: int):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("UPDATE messages SET removed = 1 WHERE id = %s", (message_id,))
				await cursor.execute("UPDATE messages SET removed = 1 WHERE reply_to = %s AND message_type = 'new_reaction'", (message_id,))
				await conn.commit()
				return True
	except Exception as e:
		logger.error(f"mark_message_removed error: {e}")
		return False

async def get_existing_reaction(roomid: str, user: str, reply_to: int):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute(
					"SELECT id, message, removed FROM messages WHERE roomid = %s AND user = %s AND message_type = 'new_reaction' AND reply_to = %s",
					(roomid, user, reply_to)
				)
				return await cursor.fetchone()
	except Exception as e:
		logger.error(f"get_existing_reaction error: {e}")
		return None

async def update_reaction(reaction_id: int, emoji = None, removed = None):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				if emoji is not None and removed is not None:
					await cursor.execute("UPDATE messages SET message = %s, removed = %s WHERE id = %s", (emoji, removed, reaction_id))
				elif removed is not None:
					await cursor.execute("UPDATE messages SET removed = %s WHERE id = %s", (removed, reaction_id))
				await conn.commit()
				return True
	except Exception as e:
		logger.error(f"update_reaction error: {e}")
		return False

async def get_messages_history(roomid: str, last_message_date: float = 0, before_message_id = None, limit: int = 15):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				if last_message_date > 0:
					await cursor.execute(
						"SELECT id, user, message, message_type, date, reply_to, removed FROM messages WHERE roomid = %s AND UNIX_TIMESTAMP(date) > %s ORDER BY id ASC",
						(roomid, last_message_date)
					)
				elif before_message_id:
					await cursor.execute(
						"SELECT id, user, message, message_type, date, reply_to, removed FROM messages WHERE roomid = %s AND id < %s AND message_type = 'new_message' ORDER BY id DESC LIMIT %s",
						(roomid, before_message_id, limit)
					)
				else:
					await cursor.execute(
						"SELECT id, user, message, message_type, date, reply_to, removed FROM messages WHERE roomid = %s AND message_type = 'new_message' ORDER BY id DESC LIMIT %s",
						(roomid, limit)
					)
				message_rows = await cursor.fetchall()
				
				reaction_rows = []
				if message_rows:
					message_ids = [str(row[0]) for row in message_rows]
					if message_ids:
						placeholders = ','.join(['%s'] * len(message_ids))
						await cursor.execute(
							f"SELECT id, user, message, message_type, date, reply_to, removed FROM messages WHERE roomid = %s AND message_type = 'new_reaction' AND reply_to IN ({placeholders})",
							[roomid] + message_ids
						)
						reaction_rows = await cursor.fetchall()
				
				all_rows = list(message_rows) + list(reaction_rows)
				all_rows.sort(key=lambda x: x[0])
				
				if before_message_id:
					all_rows = list(reversed(all_rows))
				
				messages = []
				for row in all_rows:
					thedate = row[4].timestamp() if row[4] else 0
					reply_to_data = None
					
					if row[5]:
						await cursor.execute("SELECT user, message, removed FROM messages WHERE id = %s", (row[5],))
						reply_result = await cursor.fetchone()
						if reply_result:
							if reply_result[2]:
								reply_to_data = {"id": row[5], "user": reply_result[0], "message": None, "is_deleted": True}
							else:
								reply_to_data = {"id": row[5], "user": reply_result[0], "message": reply_result[1], "is_deleted": False}
					
					messages.append({
						"id": row[0],
						"user": row[1],
						"message": row[2],
						"message_type": row[3],
						"date": thedate,
						"reply_to": reply_to_data if not bool(row[6]) else None,
						"is_deleted": bool(row[6])
					})
				
				has_more = False
				if limit and len(message_rows) == limit:
					oldest_id = min(row[0] for row in message_rows)
					await cursor.execute(
						"SELECT COUNT(*) FROM messages WHERE roomid = %s AND id < %s AND message_type = 'new_message'",
						(roomid, oldest_id)
					)
					count_result = await cursor.fetchone()
					has_more = count_result[0] > 0 if count_result else False
				
				return messages, has_more, before_message_id is not None
	except Exception as e:
		logger.error(f"get_messages_history error: {e}")
		return [], False, False

async def save_room_state(roomid: str, url: str, time_val: int, is_playing: bool, subtitle_exist: bool):
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("""
					INSERT INTO plyr_status (roomid, url, time, is_playing, subtitle_exist)
					VALUES (%s, %s, %s, %s, %s)
					ON DUPLICATE KEY UPDATE url=%s, time=%s, is_playing=%s, subtitle_exist=%s
				""", (roomid, url, time_val, is_playing, subtitle_exist, url, time_val, is_playing, subtitle_exist))
				await conn.commit()
	except Exception as e:
		logger.error(f"save_room_state error: {e}")

async def load_all_room_states():
	try:
		p = await get_pool()
		async with p.acquire() as conn:
			async with conn.cursor() as cursor:
				await cursor.execute("SELECT roomid, url, time, is_playing, subtitle_exist FROM plyr_status")
				return await cursor.fetchall()
	except Exception as e:
		logger.error(f"load_all_room_states error: {e}")
		return []
