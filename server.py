import http.server
import socketserver
import urllib.parse
import urllib.request
import json
import os
import sys
import time
import yt_dlp

PORT = 8080

# In-memory stream cache
url_cache = {} # video_id -> (url, expiry_time)

def get_direct_stream_url(video_id):
    now = time.time()
    if video_id in url_cache:
        url, exp = url_cache[video_id]
        if now < exp:
            return url

    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_id, download=False)
        stream_url = info.get('url')
        url_cache[video_id] = (stream_url, now + 14400)
        return stream_url

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
            
            if 'youtube.com' in search_query or 'youtu.be' in search_query:
                try:
                    ydl_opts = {'quiet': True}
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(search_query, download=False)
                        video_id = info.get('id')
                        results = [{
                            'id': video_id,
                            'title': info.get('title', 'Unknown Title'),
                            'uploader': info.get('uploader', 'YouTube'),
                            'thumbnail': info.get('thumbnail') or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                            'duration': info.get('duration', 0),
                            'durationStr': self.format_duration(info.get('duration', 0)),
                            'youtubeUrl': f"https://www.youtube.com/watch?v={video_id}"
                        }]
                        self.send_json_response({'results': results})
                        return
                except Exception as e:
                    print(f"Error parsing URL: {e}")

            try:
                ydl_opts = {
                    'quiet': True,
                    'extract_flat': True,
                    'skip_download': True
                }
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
                                'uploader': entry.get('uploader') or entry.get('channel', 'YouTube'),
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
                    'streamUrl': f"/api/proxy_audio?id={video_id}",
                    'directUrl': stream_url,
                    'adBlocked': True
                })
            except Exception as e:
                print(f"Stream resolution error: {e}")
                self.send_json_response({'error': str(e)}, 500)
            return

        # -------------------------------------------------------------
        # API: Robust Audio Proxy with Range Support & Socket Handling
        # -------------------------------------------------------------
        elif path == '/api/proxy_audio':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_response(400)
                self.end_headers()
                return

            try:
                direct_url = get_direct_stream_url(video_id)
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }

                range_header = self.headers.get('Range')
                if range_header:
                    headers['Range'] = range_header

                req = urllib.request.Request(direct_url, headers=headers)
                
                try:
                    resp = urllib.request.urlopen(req)
                except urllib.error.HTTPError as he:
                    if he.code in (403, 410):
                        if video_id in url_cache:
                            del url_cache[video_id]
                        direct_url = get_direct_stream_url(video_id)
                        req = urllib.request.Request(direct_url, headers=headers)
                        resp = urllib.request.urlopen(req)
                    else:
                        raise he

                self.send_response(resp.getcode())
                
                for header_key in ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']:
                    val = resp.headers.get(header_key)
                    if val:
                        self.send_header(header_key, val)

                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()

                chunk_size = 64 * 1024
                try:
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                    # Gracefully catch socket close when browser seeks or pauses
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
    print(f"Spotify-style YouTube Music Server running at http://localhost:{PORT}")
    with socketserver.TCPServer(("", PORT), SpotifyYouTubeHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
