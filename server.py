import http.server
import socketserver
import urllib.parse
import urllib.request
import json
import os
import sys
import time
import yt_dlp

PORT = int(os.environ.get('PORT', 8080))

# In-memory stream cache
url_cache = {} # video_id -> (url, expiry_time)

def get_yt_extractor_opts():
    return {
        'format': 'bestaudio[ext=m4a]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'geo_bypass': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    }

def get_direct_stream_url(video_id):
    now = time.time()
    if video_id in url_cache:
        url, exp = url_cache[video_id]
        if now < exp:
            return url

    try:
        ydl_opts = get_yt_extractor_opts()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_id, download=False)
            stream_url = info.get('url')
            if stream_url:
                url_cache[video_id] = (stream_url, now + 10800)
                return stream_url
    except Exception as e:
        print(f"yt_dlp extraction error for {video_id}: {e}")

    # Fallback to Invidious public audio API if cloud host IP is blocked by YouTube
    try:
        invidious_instances = [
            "https://inv.tux.pizza",
            "https://invidious.nerdvpn.de",
            "https://yt.artemislena.eu"
        ]
        for inst in invidious_instances:
            try:
                req = urllib.request.Request(f"{inst}/api/v1/videos/{video_id}", headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    adaptive = data.get('adaptiveFormats', [])
                    audio_formats = [f for f in adaptive if 'audio' in f.get('type', '')]
                    if audio_formats:
                        stream_url = audio_formats[0].get('url')
                        if stream_url:
                            url_cache[video_id] = (stream_url, now + 3600)
                            return stream_url
            except Exception:
                continue
    except Exception as e:
        print(f"Fallback extraction error: {e}")

    return None

class SpotifyYouTubeHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # -------------------------------------------------------------
        # API: Search YouTube Tracks
        # -------------------------------------------------------------
        if path == '/api/search':
            search_query = query.get('q', [''])[0]
            if not search_query:
                self.send_json_response({'error': 'Missing query parameter q'}, 400)
                return
            
            # Direct URL Search
            if 'youtube.com' in search_query or 'youtu.be' in search_query:
                try:
                    ydl_opts = get_yt_extractor_opts()
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(search_query, download=False)
                        video_id = info.get('id')
                        results = [{
                            'id': video_id,
                            'title': info.get('title', 'Unknown Title'),
                            'uploader': info.get('uploader', 'YouTube Artist'),
                            'thumbnail': info.get('thumbnail') or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                            'duration': info.get('duration', 0),
                            'durationStr': self.format_duration(info.get('duration', 0)),
                            'youtubeUrl': f"https://www.youtube.com/watch?v={video_id}"
                        }]
                        self.send_json_response({'results': results})
                        return
                except Exception as e:
                    print(f"Error parsing URL: {e}")

            # General Query Search
            try:
                ydl_opts = get_yt_extractor_opts()
                ydl_opts['extract_flat'] = True
                ydl_opts['skip_download'] = True

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    res = ydl.extract_info(f"ytsearch12:{search_query}", download=False)
                    entries = res.get('entries', [])
                    results = []
                    for entry in entries:
                        if entry:
                            v_id = entry.get('id')
                            dur = entry.get('duration', 0)
                            results.append({
                                'id': v_id,
                                'title': entry.get('title', 'Unknown Track'),
                                'uploader': entry.get('uploader') or entry.get('channel', 'YouTube Artist'),
                                'thumbnail': f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                                'duration': dur or 0,
                                'durationStr': self.format_duration(dur or 0),
                                'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                            })
                    self.send_json_response({'results': results})
            except Exception as e:
                print(f"Search error: {e}")
                self.send_json_response({'error': str(e)}, 500)
            return

        # -------------------------------------------------------------
        # API: Audio Stream Metadata
        # -------------------------------------------------------------
        elif path == '/api/stream':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_json_response({'error': 'Missing video id'}, 400)
                return

            try:
                stream_url = get_direct_stream_url(video_id)
                self.send_json_response({
                    'id': video_id,
                    'proxyUrl': f"/api/proxy_audio?id={video_id}",
                    'directUrl': stream_url,
                    'adBlocked': True
                })
            except Exception as e:
                print(f"Stream resolution error: {e}")
                self.send_json_response({'error': str(e)}, 500)
            return

        # -------------------------------------------------------------
        # API: Robust Audio Proxy with Range Support & Fallbacks
        # -------------------------------------------------------------
        elif path == '/api/proxy_audio':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_response(400)
                self.end_headers()
                return

            try:
                direct_url = get_direct_stream_url(video_id)
                if not direct_url:
                    self.send_response(404)
                    self.end_headers()
                    return

                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }

                range_header = self.headers.get('Range')
                if range_header:
                    headers['Range'] = range_header

                req = urllib.request.Request(direct_url, headers=headers)
                
                try:
                    resp = urllib.request.urlopen(req, timeout=10)
                except urllib.error.HTTPError as he:
                    if he.code in (403, 410):
                        if video_id in url_cache:
                            del url_cache[video_id]
                        direct_url = get_direct_stream_url(video_id)
                        req = urllib.request.Request(direct_url, headers=headers)
                        resp = urllib.request.urlopen(req, timeout=10)
                    else:
                        raise he

                self.send_response(resp.getcode())
                
                for header_key in ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']:
                    val = resp.headers.get(header_key)
                    if val:
                        self.send_header(header_key, val)

                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                chunk_size = 32 * 1024
                try:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                    pass

            except Exception as e:
                print(f"Proxy streaming error for {video_id}: {e}")
            return

        # Serve static files
        super().do_GET()

    def send_json_response(self, data, code=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def format_duration(self, seconds):
        if not seconds:
            return "0:00"
        m = int(seconds) // 60
        s = int(seconds) % 60
        return f"{m}:{s:02d}"

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    print(f"Spotify-style YouTube Music Server running on port {PORT}")
    with socketserver.TCPServer(("", PORT), SpotifyYouTubeHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
