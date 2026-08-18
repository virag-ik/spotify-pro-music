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

def get_related_videos(video_id):
    """Fetch related/recommended videos for a given YouTube video using InnerTube."""
    url = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false"
    body = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20260101.00.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "videoId": video_id
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
    results = []
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=8, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            panels = (
                data.get("contents", {})
                .get("twoColumnWatchNextResults", {})
                .get("secondaryResults", {})
                .get("secondaryResults", {})
                .get("results", [])
            )
            for panel in panels:
                vr = panel.get("compactVideoRenderer")
                if not vr:
                    continue
                v_id = vr.get("videoId")
                if not v_id or v_id == video_id:
                    continue
                title_runs = (vr.get("title") or {}).get("simpleText") or ""
                if not title_runs:
                    t_runs = (vr.get("title") or {}).get("runs") or []
                    title_runs = "".join(r.get("text", "") for r in t_runs)
                owner_runs = (vr.get("longBylineText") or vr.get("shortBylineText") or {}).get("runs") or []
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
                    'title': title_runs or "Unknown Track",
                    'uploader': uploader,
                    'thumbnail': f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                    'duration': dur_secs,
                    'durationStr': dur_str or format_dur(dur_secs),
                    'youtubeUrl': f"https://www.youtube.com/watch?v={v_id}"
                })
                if len(results) >= 15:
                    break
    except Exception as e:
        print(f"InnerTube related videos error: {e}")
    return results

def get_audio_stream_url(video_id):
    """Extract a direct audio stream URL for a YouTube video via Cobalt API."""
    api_url = "https://api.cobalt.tools/api/json"
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    
    payload = json.dumps({
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "isAudioOnly": True
    }).encode('utf-8')

    try:
        req = urllib.request.Request(api_url, data=payload, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            audio_url = result.get('url')
            if audio_url:
                print(f"Audio URL resolved via Cobalt API for {video_id}")
                return audio_url
    except Exception as e:
        print(f"Cobalt API extraction failed: {e}")

    return None

def search_youtube_fallback(query):
    """Secondary search fallback using public Piped/Invidious APIs."""
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
                results = search_youtube_fallback(search_query)

            self.send_json_response({'results': results})
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

        # Related Videos Endpoint — returns recommended songs for auto-play
        elif path == '/api/related':
            video_id = query.get('id', [''])[0]
            if not video_id:
                self.send_json_response({'error': 'Missing video id'}, 400)
                return

            results = get_related_videos(video_id)
            self.send_json_response({'results': results, 'id': video_id})
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
