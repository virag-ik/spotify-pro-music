import http.server
import socketserver
import urllib.parse
import urllib.request
import json
import os
import sys
import time
import ssl
import re
import base64

try:
    from pyDes import des, ECB, PAD_PKCS5
except ImportError:
    des = None

PORT = int(os.environ.get('PORT', 8080))
ssl_ctx = ssl.create_default_context()

audio_stream_cache = {}

def decrypt_saavn_url(encrypted_url):
    if not encrypted_url:
        return None
    try:
        if des is not None:
            cipher = des(b"38346591", ECB, b"\0\0\0\0\0\0\0\0", pad=None, padmode=PAD_PKCS5)
            dec = cipher.decrypt(base64.b64decode(encrypted_url.strip())).decode('utf-8')
            return dec.replace("_96.mp4", "_320.mp4").replace("_160.mp4", "_320.mp4")
    except Exception as e:
        print(f"DES decryption error: {e}")
    return None

def format_dur(seconds):
    if not seconds:
        return "0:00"
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"

def search_studio_music(query):
    """Search studio-quality tracks from the open JioSaavn catalog with 320kbps direct streams."""
    url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=20&q={urllib.parse.quote(query)}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    results = []
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            raw_results = data.get('results', [])
            
            pids_to_fetch = [item.get('id') for item in raw_results if item.get('id')]
            details_map = {}
            if pids_to_fetch:
                try:
                    det_url = f"https://www.jiosaavn.com/api.php?__call=song.getDetails&pids={','.join(pids_to_fetch[:20])}&_format=json&_marker=0&cc=in"
                    det_req = urllib.request.Request(det_url, headers=headers)
                    with urllib.request.urlopen(det_req, timeout=6, context=ssl_ctx) as det_resp:
                        details_map = json.loads(det_resp.read().decode('utf-8', 'replace'))
                except Exception as e:
                    print(f"Batch details fetch error: {e}")

            for item in raw_results:
                s_id = item.get('id')
                if not s_id:
                    continue
                info = details_map.get(s_id, item)
                
                title = info.get('song') or item.get('song') or "Unknown Track"
                artist = info.get('primary_artists') or info.get('singers') or item.get('primary_artists') or "Studio Artist"
                album = info.get('album') or item.get('album') or ""
                dur_secs = int(info.get('duration') or item.get('duration') or 0)
                
                img = info.get('image') or item.get('image') or ""
                if img:
                    img = img.replace("150x150", "500x500").replace("50x50", "500x500")
                else:
                    img = "synthwave_album_cover.jpg"
                
                enc_url = info.get('encrypted_media_url') or item.get('encrypted_media_url')
                stream_url = decrypt_saavn_url(enc_url)
                if stream_url:
                    audio_stream_cache[s_id] = (stream_url, time.time())

                results.append({
                    'id': s_id,
                    'title': title,
                    'uploader': artist,
                    'album': album,
                    'thumbnail': img,
                    'duration': dur_secs,
                    'durationStr': format_dur(dur_secs),
                    'url': stream_url or ""
                })
    except Exception as e:
        print(f"Studio search error: {e}")
    return results

def get_studio_stream_url(song_id):
    """Retrieve 320kbps direct audio stream URL for a given song ID."""
    now = time.time()
    if song_id in audio_stream_cache:
        cached_url, cached_time = audio_stream_cache[song_id]
        if now - cached_time < 14400:
            return cached_url

    url = f"https://www.jiosaavn.com/api.php?__call=song.getDetails&pids={song_id}&_format=json&_marker=0&cc=in"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            info = data.get(song_id, {})
            enc_url = info.get('encrypted_media_url')
            if enc_url:
                stream_url = decrypt_saavn_url(enc_url)
                if stream_url:
                    audio_stream_cache[song_id] = (stream_url, now)
                    return stream_url
    except Exception as e:
        print(f"Stream resolution error for {song_id}: {e}")
    return None

def get_studio_recommendations(song_id):
    """Fetch Song Radio recommendations with direct 320kbps MP3 links."""
    url = f"https://www.jiosaavn.com/api.php?__call=reco.getreco&pid={song_id}&_format=json&_marker=0&cc=in"
    headers = {"User-Agent": "Mozilla/5.0"}
    results = []
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            items = data.get(song_id) if isinstance(data, dict) else data
            if isinstance(items, dict):
                items = list(items.values())
            if isinstance(items, list):
                for item in items:
                    s_id = item.get('id')
                    if not s_id or s_id == song_id:
                        continue
                    title = item.get('song') or "Unknown Track"
                    artist = item.get('primary_artists') or item.get('singers') or "Studio Artist"
                    album = item.get('album') or ""
                    dur_secs = int(item.get('duration') or 0)
                    img = (item.get('image') or "").replace("150x150", "500x500").replace("50x50", "500x500")
                    enc_url = item.get('encrypted_media_url')
                    stream_url = decrypt_saavn_url(enc_url)
                    if stream_url:
                        audio_stream_cache[s_id] = (stream_url, time.time())

                    results.append({
                        'id': s_id,
                        'title': title,
                        'uploader': artist,
                        'album': album,
                        'thumbnail': img or "synthwave_album_cover.jpg",
                        'duration': dur_secs,
                        'durationStr': format_dur(dur_secs),
                        'url': stream_url or ""
                    })
                    if len(results) >= 15:
                        break
    except Exception as e:
        print(f"Recommendations error for {song_id}: {e}")
    return results

def get_studio_lyrics(song_id):
    """Fetch official lyrics for a song ID."""
    url = f"https://www.jiosaavn.com/api.php?__call=lyrics.getLyrics&lyrics_id={song_id}&_format=json&_marker=0&cc=in"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            if data and data.get('lyrics'):
                return data.get('lyrics')
    except Exception as e:
        print(f"Lyrics fetch error: {e}")
    return None

def get_studio_charts(category='global'):
    """Fetch Top 50 trending chart tracks with 320kbps streams."""
    chart_query_map = {
        'global': 'Top Pop Hits',
        'trending': 'Trending Hits',
        'english': 'English Hits',
        'bollywood': 'Bollywood Top',
        'viral': 'Global Pop'
    }
    query = chart_query_map.get(category, 'Top Pop Hits')
    return search_studio_music(query)

class InfiStreamStudioHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS, POST')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # Healthcheck Endpoint
        if path == '/api/health':
            self.send_json_response({'status': 'ok', 'timestamp': int(time.time())})
            return

        # Top Charts & Global Trending Hits
        if path == '/api/charts':
            category = query.get('category', ['global'])[0].strip()
            results = get_studio_charts(category)
            self.send_json_response({'results': results, 'category': category})
            return

        # Search Endpoint
        if path == '/api/search':
            search_query = query.get('q', [''])[0].strip()
            if not search_query:
                self.send_json_response({'error': 'Missing query parameter q'}, 400)
                return

            results = search_studio_music(search_query)
            if not results:
                # Fuzzy clean query (remove extra noise words)
                clean_q = re.sub(r'(?i)\b(video|song|official|lyrics|audio|mp3|hd|4k|download)\b', '', search_query).strip()
                if clean_q and clean_q != search_query:
                    results = search_studio_music(clean_q)

            self.send_json_response({'results': results})
            return

        # Lyrics Endpoint
        elif path == '/api/lyrics':
            song_id = query.get('id', [''])[0]
            if not song_id:
                self.send_json_response({'error': 'Missing song id'}, 400)
                return

            lyrics_text = get_studio_lyrics(song_id)
            if lyrics_text:
                self.send_json_response({'lyrics': lyrics_text, 'id': song_id})
            else:
                self.send_json_response({'lyrics': None, 'id': song_id, 'message': 'Lyrics not available for this track'})
            return

        # Direct Audio URL Endpoint — returns 320kbps MP3 audio stream URL
        elif path == '/api/audio-url':
            song_id = query.get('id', [''])[0]
            if not song_id:
                self.send_json_response({'error': 'Missing song id'}, 400)
                return

            audio_url = get_studio_stream_url(song_id)
            if audio_url:
                self.send_json_response({'url': audio_url, 'id': song_id})
            else:
                self.send_json_response({'error': 'Could not resolve audio stream', 'id': song_id}, 404)
            return

        # Related Videos / Song Radio Endpoint — returns recommended songs for auto-play
        elif path == '/api/related':
            song_id = query.get('id', [''])[0]
            if not song_id:
                self.send_json_response({'error': 'Missing song id'}, 400)
                return

            results = get_studio_recommendations(song_id)
            self.send_json_response({'results': results, 'id': song_id})
            return

        super().do_GET()

    def send_json_response(self, data, code=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    print(f"InfiStream Studio Music Server running on port {PORT}")
    with socketserver.TCPServer(("", PORT), InfiStreamStudioHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
