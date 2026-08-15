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

url_cache = {}

def get_yt_extractor_opts():
    return {
        'format': 'bestaudio[ext=m4a]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'ignoreerrors': True,
        'geo_bypass': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['mweb', 'android']
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
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
            if info:
                stream_url = info.get('url')
                if stream_url:
                    url_cache[video_id] = (stream_url, now + 10800)
                    return stream_url
    except Exception as e:
        print(f"yt_dlp extraction error for {video_id}: {e}")

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

        # Search Endpoint
        if path == '/api/search':
            search_query = query.get('q', [''])[0]
            if not search_query:
                self.send_json_response({'error': 'Missing query parameter q'}, 400)
                return
            
            try:
                ydl_opts = get_yt_extractor_opts()
                ydl_opts['extract_flat'] = True
                ydl_opts['skip_download'] = True

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    res = ydl.extract_info(f"ytsearch12:{search_query}", download=False)
                    entries = res.get('entries', []) if res else []
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
                self.send_json_response({'results': []})
            return

        # Stream Resolution Endpoint
        elif path == '/api/stream':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_json_response({'error': 'Missing video id'}, 400)
                return

            stream_url = get_direct_stream_url(video_id)
            if stream_url:
                self.send_json_response({
                    'id': video_id,
                    'proxyUrl': f"/api/proxy_audio?id={video_id}",
                    'directUrl': stream_url,
                    'useClientPlayer': False
                })
            else:
                # If cloud IP is blocked by YouTube bot check, signal client browser player fallback!
                self.send_json_response({
                    'id': video_id,
                    'useClientPlayer': True
                })
            return

        # Audio Proxy Endpoint
        elif path == '/api/proxy_audio':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_response(400)
                self.end_headers()
                return

            direct_url = get_direct_stream_url(video_id)
            if not direct_url:
                self.send_response(404)
                self.end_headers()
                return

            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15'
                }
                range_header = self.headers.get('Range')
                if range_header:
                    headers['Range'] = range_header

                req = urllib.request.Request(direct_url, headers=headers)
                resp = urllib.request.urlopen(req, timeout=10)

                self.send_response(resp.getcode())
                for header_key in ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']:
                    val = resp.headers.get(header_key)
                    if val:
                        self.send_header(header_key, val)

                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                chunk_size = 32 * 1024
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

            except Exception as e:
                print(f"Proxy streaming error for {video_id}: {e}")
            return

        super().do_GET()

    def send_json_response(self, data, code=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def format_duration(self, seconds):
        if not seconds: return "0:00"
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
