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
    """Search studio-quality tracks with 50+ results, correct HD artwork, and smart de-duplication."""
    url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=50&q={urllib.parse.quote(query)}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    results = []
    seen_keys = set()

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            raw_results = data.get('results', [])
            
            pids_to_fetch = [item.get('id') for item in raw_results if item.get('id')]
            details_map = {}
            if pids_to_fetch:
                # Fetch details in chunks of 25 to avoid URL length issues
                for i in range(0, len(pids_to_fetch), 25):
                    chunk = pids_to_fetch[i:i+25]
                    try:
                        det_url = f"https://www.jiosaavn.com/api.php?__call=song.getDetails&pids={','.join(chunk)}&_format=json&_marker=0&cc=in"
                        det_req = urllib.request.Request(det_url, headers=headers)
                        with urllib.request.urlopen(det_req, timeout=6, context=ssl_ctx) as det_resp:
                            chunk_map = json.loads(det_resp.read().decode('utf-8', 'replace'))
                            if isinstance(chunk_map, dict):
                                details_map.update(chunk_map)
                    except Exception as e:
                        print(f"Batch details chunk error: {e}")

            for item in raw_results:
                s_id = item.get('id')
                if not s_id:
                    continue
                info = details_map.get(s_id) or item
                
                title = info.get('song') or item.get('song') or "Unknown Track"
                artist = info.get('primary_artists') or info.get('singers') or item.get('primary_artists') or "Studio Artist"
                album = info.get('album') or item.get('album') or ""
                dur_secs = int(info.get('duration') or item.get('duration') or 0)
                
                # Smart De-Duplication: check normalized title + artist
                norm_key = re.sub(r'[^a-zA-Z0-9]', '', (title + artist[:12]).lower())
                if norm_key in seen_keys:
                    continue
                seen_keys.add(norm_key)

                # Correct 500x500 HD Cover Art
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

def search_youtube_music(query):
    """Search pure YouTube Music catalog across all cards, shelves and item sections (100% music only)."""
    results = []
    seen = set()
    url = 'https://music.youtube.com/youtubei/v1/search'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/'
    }

    search_queries = [query, f"{query} songs"]
    for q in search_queries:
        if len(results) >= 30:
            break
        payload = {
            'context': {'client': {'clientName': 'WEB_REMIX', 'clientVersion': '1.20240101.01.00', 'hl': 'en', 'gl': 'US'}},
            'query': q
        }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
            with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as resp:
                data = json.loads(resp.read().decode('utf-8', 'replace'))
                tabs = data.get('contents', {}).get('tabbedSearchResultsRenderer', {}).get('tabs', [{}])
                contents = tabs[0].get('tabRenderer', {}).get('content', {}).get('sectionListRenderer', {}).get('contents', [])
                
                for sec in contents:
                    # 1. Top Music Card Shelf
                    if 'musicCardShelfRenderer' in sec:
                        card = sec['musicCardShelfRenderer']
                        title_runs = card.get('title', {}).get('runs', [])
                        if title_runs:
                            main_title = title_runs[0].get('text', '')
                            sub_runs = card.get('subtitle', {}).get('runs', [])
                            artist = sub_runs[0].get('text', '') if sub_runs else 'Artist'
                            ep = card.get('title', {}).get('runs', [{}])[0].get('navigationEndpoint', {}).get('watchEndpoint', {})
                            vid = ep.get('videoId')
                            if not vid and card.get('onTap'):
                                vid = card.get('onTap', {}).get('watchEndpoint', {}).get('videoId')
                            if vid and vid not in seen:
                                seen.add(vid)
                                results.append({'id': vid, 'title': main_title, 'uploader': artist, 'durationStr': '3:30', 'thumbnail': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', 'source': 'youtube', 'isYouTube': True})
                        
                        for item in card.get('contents', []):
                            mr = item.get('musicResponsiveListItemRenderer', {})
                            if not mr: continue
                            flex = mr.get('flexColumns', [])
                            title = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '') if flex else ''
                            artist = flex[1].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '') if len(flex) > 1 else 'Artist'
                            ep = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('navigationEndpoint', {}).get('watchEndpoint', {}) if flex else {}
                            vid = ep.get('videoId')
                            if not vid:
                                overlay = mr.get('overlay', {}).get('musicItemThumbnailOverlayRenderer', {}).get('content', {}).get('musicPlayButtonRenderer', {}).get('playNavigationEndpoint', {}).get('watchEndpoint', {})
                                vid = overlay.get('videoId')
                            if vid and vid not in seen:
                                seen.add(vid)
                                results.append({'id': vid, 'title': title, 'uploader': artist, 'durationStr': '3:30', 'thumbnail': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', 'source': 'youtube', 'isYouTube': True})

                    # 2. Main Music Shelf
                    if 'musicShelfRenderer' in sec:
                        for item in sec['musicShelfRenderer'].get('contents', []):
                            mr = item.get('musicResponsiveListItemRenderer', {})
                            if not mr: continue
                            flex = mr.get('flexColumns', [])
                            title = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '') if flex else ''
                            artist = flex[1].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '') if len(flex) > 1 else 'Artist'
                            ep = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('navigationEndpoint', {}).get('watchEndpoint', {}) if flex else {}
                            vid = ep.get('videoId')
                            if not vid:
                                overlay = mr.get('overlay', {}).get('musicItemThumbnailOverlayRenderer', {}).get('content', {}).get('musicPlayButtonRenderer', {}).get('playNavigationEndpoint', {}).get('watchEndpoint', {})
                                vid = overlay.get('videoId')
                            if vid and vid not in seen:
                                seen.add(vid)
                                results.append({'id': vid, 'title': title, 'uploader': artist, 'durationStr': '3:30', 'thumbnail': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', 'source': 'youtube', 'isYouTube': True})

                    # 3. Item Sections (all 20+ individual song result sections)
                    if 'itemSectionRenderer' in sec:
                        for item in sec['itemSectionRenderer'].get('contents', []):
                            mr = item.get('musicResponsiveListItemRenderer', {}) or item.get('compactVideoRenderer', {}) or item.get('videoRenderer', {})
                            if not mr: continue
                            flex = mr.get('flexColumns', [])
                            title = ''
                            artist = 'Artist'
                            vid = None
                            if flex:
                                title = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '')
                                if len(flex) > 1:
                                    artist = flex[1].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('text', '')
                                ep = flex[0].get('musicResponsiveListItemFlexColumnRenderer', {}).get('text', {}).get('runs', [{}])[0].get('navigationEndpoint', {}).get('watchEndpoint', {})
                                vid = ep.get('videoId')
                            if not vid and mr.get('videoId'):
                                vid = mr.get('videoId')
                                title = mr.get('title', {}).get('runs', [{}])[0].get('text', '') or mr.get('title', {}).get('simpleText', '')
                            if not vid:
                                overlay = mr.get('overlay', {}).get('musicItemThumbnailOverlayRenderer', {}).get('content', {}).get('musicPlayButtonRenderer', {}).get('playNavigationEndpoint', {}).get('watchEndpoint', {})
                                vid = overlay.get('videoId')
                            if vid and vid not in seen:
                                seen.add(vid)
                                results.append({'id': vid, 'title': title or 'Track', 'uploader': artist, 'durationStr': '3:30', 'thumbnail': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg', 'source': 'youtube', 'isYouTube': True})
        except Exception as e:
            print(f"YouTube Music search error: {e}")

    return results

def get_youtube_recommendations(video_id):
    """Fetch YouTube recommendations or fallback to related studio tracks."""
    url = 'https://www.youtube.com/youtubei/v1/next'
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Content-Type': 'application/json'}
    payload = {
        'context': {'client': {'clientName': 'WEB', 'clientVersion': '2.20240101.00.00', 'hl': 'en', 'gl': 'US'}},
        'videoId': video_id
    }
    results = []
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
        with urllib.request.urlopen(req, timeout=5, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
            contents = data.get('contents', {}).get('twoColumnWatchNextResults', {}).get('secondaryResults', {}).get('secondaryResults', {}).get('results', [])
            for item in contents:
                cr = item.get('compactVideoRenderer', {})
                vid_id = cr.get('videoId')
                if vid_id and vid_id != video_id:
                    title = cr.get('title', {}).get('simpleText') or cr.get('title', {}).get('runs', [{}])[0].get('text', '')
                    artist = cr.get('shortBylineText', {}).get('runs', [{}])[0].get('text', 'YouTube Artist')
                    dur = cr.get('lengthText', {}).get('simpleText', '3:30')
                    img = f'https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg'
                    results.append({
                        'id': vid_id,
                        'title': title,
                        'uploader': artist,
                        'durationStr': dur,
                        'thumbnail': img,
                        'source': 'youtube',
                        'isYouTube': True
                    })
                    if len(results) >= 15:
                        break
    except Exception as e:
        print(f"YouTube recommendations error: {e}")
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
            engine = query.get('engine', ['studio'])[0].strip().lower()
            category = query.get('category', ['global'])[0].strip()
            if engine == 'youtube':
                results = search_youtube_music(f"Trending Top Hits {category}")
            else:
                results = get_studio_charts(category)
            self.send_json_response({'results': results, 'category': category, 'engine': engine})
            return

        # Search Endpoint
        if path == '/api/search':
            search_query = query.get('q', [''])[0].strip()
            engine = query.get('engine', ['studio'])[0].strip().lower()

            if not search_query:
                self.send_json_response({'error': 'Missing query parameter q'}, 400)
                return

            if engine == 'youtube':
                results = search_youtube_music(search_query)
            else:
                results = search_studio_music(search_query)
                if not results:
                    clean_q = re.sub(r'(?i)\b(video|song|official|lyrics|audio|mp3|hd|4k|download)\b', '', search_query).strip()
                    if clean_q and clean_q != search_query:
                        results = search_studio_music(clean_q)

            self.send_json_response({'results': results, 'engine': engine})
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

        # Direct Audio URL Endpoint
        elif path == '/api/audio-url':
            song_id = query.get('id', [''])[0]
            engine = query.get('engine', ['studio'])[0].strip().lower()

            if not song_id:
                self.send_json_response({'error': 'Missing song id'}, 400)
                return

            if engine == 'youtube' or len(song_id) == 11:
                # 100% Pure YouTube: Return direct YouTube video identity for native player
                self.send_json_response({'isYouTube': True, 'videoId': song_id, 'id': song_id})
            else:
                # 100% Pure Studio Master: Return direct 320kbps CD master audio stream
                audio_url = get_studio_stream_url(song_id)
                if audio_url:
                    self.send_json_response({'url': audio_url, 'id': song_id, 'isStudio': True})
                else:
                    self.send_json_response({'error': 'Could not resolve 320kbps studio stream', 'id': song_id}, 404)
            return

        # Related Videos / Song Radio Endpoint — returns recommended songs for auto-play
        elif path == '/api/related':
            song_id = query.get('id', [''])[0]
            engine = query.get('engine', ['studio'])[0].strip().lower()

            if not song_id:
                self.send_json_response({'error': 'Missing song id'}, 400)
                return

            if engine == 'youtube' or len(song_id) == 11:
                results = get_youtube_recommendations(song_id)
            else:
                results = get_studio_recommendations(song_id)

            self.send_json_response({'results': results, 'id': song_id, 'engine': engine})
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
