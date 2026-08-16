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

try:
    import yt_dlp
except ImportError:
    yt_dlp = None

PORT = int(os.environ.get('PORT', 8080))
ssl_ctx = ssl.create_default_context()

def format_dur(seconds):
    if not seconds:
        return "0:00"
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"

def search_youtube_innertube(query):
    """Primary high-speed search using YouTube InnerTube API (works on cloud hosts like Render without bot blocks)."""
    url = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false"
    body = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20260101.00.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
        "params": "EgIQAQ=="  # Filter for videos
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
    }
    results = []
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=6, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            sections = (
                data.get("contents", {})
                .get("twoColumnSearchResultsRenderer", {})
                .get("primaryContents", {})
                .get("sectionListRenderer", {})
                .get("contents", [])
            )
            for section in sections:
                items = (section.get("itemSectionRenderer") or {}).get("contents") or []
                for item in items:
                    vr = item.get("videoRenderer")
                    if not vr:
                        continue
                    v_id = vr.get("videoId")
                    if not v_id:
                        continue
                    title_runs = (vr.get("title") or {}).get("runs") or []
                    title = "".join(r.get("text", "") for r in title_runs) or "Unknown Track"
                    owner_runs = (vr.get("ownerText") or vr.get("longBylineText") or {}).get("runs") or []
                    uploader = "".join(r.get("text", "") for r in owner_runs) or "YouTube Artist"
                    dur_str = ((vr.get("lengthText") or {}).get("simpleText")) or ""

                    dur_secs = 0
                    if dur_str:
                        parts = dur_str.split(':')
                        try:
                            if len(parts) == 2:
                                dur_secs = int(parts[0]) * 60 + int(parts[1])
                            elif len(parts) == 3:
                                dur_secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                        except ValueError:
                            dur_secs = 0

                    results.append({
                        'id': v_id,
                        'title': title,
                        'uploader': uploader,
                        'thumbnail': f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                        'duration': dur_secs,
                        'durationStr': dur_str or format_dur(dur_secs),
                        'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                    })
    except Exception as e:
        print(f"InnerTube search error: {e}")
    return results

def get_audio_stream_url(video_id):
    """Extract a direct audio stream URL for a YouTube video via Piped proxies or yt-dlp."""
    piped_instances = [
        f"https://pipedapi.kavin.rocks/streams/{video_id}",
        f"https://api.piped.video/streams/{video_id}",
        f"https://pipedapi.in.projectsegfau.lt/streams/{video_id}",
    ]
    for api_url in piped_instances:
        try:
            req = urllib.request.Request(api_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=6, context=ssl_ctx) as resp:
                data = json.loads(resp.read().decode('utf-8', 'replace'))
                streams = data.get('audioStreams') or []
                best = None
                for s in streams:
                    url = s.get('url', '')
                    mime = s.get('mimeType', '')
                    if url and 'audio' in mime:
                        if not best or (s.get('bitrate', 0) > best.get('bitrate', 0)):
                            best = s
                if best and best.get('url'):
                    print(f"Audio URL resolved via Piped for {video_id}")
                    return best['url']
        except Exception as e:
            print(f"Piped audio extraction failed ({api_url}): {e}")
            continue

    if yt_dlp:
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'skip_download': True,
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
                }
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
                audio_url = info.get('url')
                if audio_url:
                    print(f"Audio URL resolved via yt-dlp for {video_id}")
                    return audio_url
        except Exception as e:
            print(f"yt-dlp audio extraction failed: {e}")

    return None

def search_youtube_ytdlp(query):
    """Secondary search using yt_dlp flat extraction."""
    if not yt_dlp:
        return []
    results = []
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'ignoreerrors': True,
            'extract_flat': True,
            'skip_download': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"ytsearch12:{query}", download=False)
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
    return results

def search_youtube_fallback(query):
    """Tertiary search fallback using public Piped/Invidious APIs."""
    apis = [
        f"https://pipedapi.kavin.rocks/search?q={urllib.parse.quote(query)}&filter=all",
        f"https://api.piped.video/search?q={urllib.parse.quote(query)}&filter=all",
        f"https://inv.tux.pizza/api/v1/search?q={urllib.parse.quote(query)}",
        f"https://invidious.nerdvpn.de/api/v1/search?q={urllib.parse.quote(query)}"
    ]
    for api in apis:
        try:
            req = urllib.request.Request(api, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=4, context=ssl_ctx) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                items = data if isinstance(data, list) else data.get('items', [])
                results = []
                for item in items:
                    v_id = item.get('id') or item.get('videoId')
                    if not v_id and item.get('url'):
                        v_id = item.get('url', '').split('=')[-1]
                    if v_id:
                        title = item.get('title', 'Unknown Track')
                        uploader = item.get('uploaderName') or item.get('author') or 'YouTube Artist'
                        dur = item.get('duration', 0)
                        results.append({
                            'id': v_id,
                            'title': title,
                            'uploader': uploader,
                            'thumbnail': item.get('thumbnail') or f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                            'duration': dur,
                            'durationStr': format_dur(dur),
                            'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                        })
                if results:
                    return results
        except Exception:
            continue
    return []

class SpotifyYouTubeHandler(http.server.SimpleHTTPRequestHandler):
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

        # Search Endpoint
        if path == '/api/search':
            search_query = query.get('q', [''])[0].strip()
            if not search_query:
                self.send_json_response({'error': 'Missing query parameter q'}, 400)
                return

            # Check if query is a direct YouTube URL
            yt_url_match = re.search(r'(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})', search_query)
            if yt_url_match:
                v_id = yt_url_match.group(1)
                direct_result = [{
                    'id': v_id,
                    'title': f'YouTube Video ({v_id})',
                    'uploader': 'Direct YouTube Link',
                    'thumbnail': f'https://i.ytimg.com/vi/{v_id}/hqdefault.jpg',
                    'duration': 0,
                    'durationStr': '3:30',
                    'youtubeUrl': f'https://www.youtube.com/watch?v={v_id}'
                }]
                self.send_json_response({'results': direct_result})
                return

            # Execute tiered search
            results = search_youtube_innertube(search_query)
            if not results:
                results = search_youtube_ytdlp(search_query)
            if not results:
                results = search_youtube_fallback(search_query)

            self.send_json_response({'results': results})
            return

        # Stream Resolution Endpoint (legacy)
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

        # Direct Audio URL Endpoint — returns a playable audio stream URL
        elif path == '/api/audio-url':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_json_response({'error': 'Missing video id'}, 400)
                return

            audio_url = get_audio_stream_url(video_id)
            if audio_url:
                self.send_json_response({'url': audio_url, 'id': video_id})
            else:
                self.send_json_response({'error': 'Could not resolve audio stream', 'id': video_id}, 404)
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
    print(f"Spotify PRO Music Server running on port {PORT}")
    with socketserver.TCPServer(("", PORT), SpotifyYouTubeHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
