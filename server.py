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
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    }

def search_youtube_fallback(query):
    # Fallback to Piped / Invidious public APIs if yt-dlp is rate-limited on cloud host IP
    apis = [
        f"https://pipedapi.kavin.rocks/search?q={urllib.parse.quote(query)}&filter=all",
        f"https://api.piped.video/search?q={urllib.parse.quote(query)}&filter=all",
        f"https://pipedapi.adminforge.de/search?q={urllib.parse.quote(query)}&filter=all"
    ]
    for api in apis:
        try:
            req = urllib.request.Request(api, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                items = data.get('items', [])
                results = []
                for item in items:
                    if item.get('type') == 'stream':
                        v_id = item.get('url', '').split('=')[-1]
                        if v_id:
                            results.append({
                                'id': v_id,
                                'title': item.get('title', 'Unknown Track'),
                                'uploader': item.get('uploaderName', 'YouTube Artist'),
                                'thumbnail': item.get('thumbnail') or f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                                'duration': item.get('duration', 0),
                                'durationStr': format_dur(item.get('duration', 0)),
                                'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                            })
                if results:
                    return results
        except Exception:
            continue
    return []

def format_dur(seconds):
    if not seconds: return "0:00"
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"

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
            
            results = []
            try:
                ydl_opts = get_yt_extractor_opts()
                ydl_opts['extract_flat'] = True
                ydl_opts['skip_download'] = True

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    res = ydl.extract_info(f"ytsearch12:{search_query}", download=False)
                    entries = res.get('entries', []) if res else []
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
                                'durationStr': format_dur(dur or 0),
                                'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                            })
            except Exception as e:
                print(f"yt-dlp search exception: {e}")

            if not results:
                results = search_youtube_fallback(search_query)

            self.send_json_response({'results': results})
            return

        # Stream Resolution Endpoint
        elif path == '/api/stream':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_json_response({'error': 'Missing video id'}, 400)
                return

            self.send_json_response({
                'id': video_id,
                'useClientPlayer': True
            })
            return

        super().do_GET()

    def send_json_response(self, data, code=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    print(f"Spotify-style YouTube Music Server running on port {PORT}")
    with socketserver.TCPServer(("", PORT), SpotifyYouTubeHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
