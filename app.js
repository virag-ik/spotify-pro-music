// Spotify Pro Audio Engine with Singer/Artist Profiles & 3 Live Spectrum Visualizers
document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. Audio Context & 5-Band Equalizer Setup
    // -------------------------------------------------------------
    let audioCtx = null;
    let masterGain = null;
    let analyserNode = null;
    let audioSourceNode = null;
    let eqFilters = [];

    const youtubeAudioPlayer = document.getElementById('youtubeAudioPlayer');

    function initAudioEngine() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();

            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.8;

            analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 128;

            const freqs = [60, 230, 910, 4000, 14000];
            const types = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

            eqFilters = freqs.map((f, i) => {
                const filter = audioCtx.createBiquadFilter();
                filter.type = types[i];
                filter.frequency.value = f;
                filter.gain.value = 0;
                return filter;
            });

            for (let i = 0; i < eqFilters.length - 1; i++) {
                eqFilters[i].connect(eqFilters[i + 1]);
            }

            try {
                audioSourceNode = audioCtx.createMediaElementSource(youtubeAudioPlayer);
                audioSourceNode.connect(eqFilters[0]);
                eqFilters[eqFilters.length - 1].connect(masterGain);
            } catch (err) {
                console.log("Audio source note:", err);
            }

            masterGain.connect(analyserNode);
            analyserNode.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // -------------------------------------------------------------
    // 2. Playlists & Liked Songs Persistence
    // -------------------------------------------------------------
    let likedSongs = JSON.parse(localStorage.getItem('spotify_liked_songs') || '[]');
    let userPlaylists = JSON.parse(localStorage.getItem('spotify_user_playlists') || '[]');

    if (userPlaylists.length === 0) {
        userPlaylists = [
            { id: 'pl_1', name: '🏋️ Workout Hits', tracks: [] },
            { id: 'pl_2', name: '🌙 Late Night Chill', tracks: [] }
        ];
        localStorage.setItem('spotify_user_playlists', JSON.stringify(userPlaylists));
    }

    function showToast(msg) {
        const toast = document.getElementById('toastNotification');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2500);
    }

    function updateLikedCountUI() {
        document.getElementById('likedCount').textContent = likedSongs.length;
    }
    updateLikedCountUI();

    // Render Playlists in Sidebar
    const userPlaylistsEl = document.getElementById('userPlaylists');

    function renderSidebarPlaylists() {
        const customItems = userPlaylistsEl.querySelectorAll('.custom-pl');
        customItems.forEach(el => el.remove());

        userPlaylists.forEach(pl => {
            const li = document.createElement('li');
            li.className = 'pl-item custom-pl';
            li.dataset.plId = pl.id;
            li.innerHTML = `
                <span>📁 ${pl.name} (${pl.tracks.length})</span>
                <button class="pl-del-btn" title="Delete Playlist">✕</button>
            `;

            li.querySelector('span').addEventListener('click', () => {
                setActivePlaylistItem(li);
                showSection('search');
                searchHeading.textContent = `Playlist: ${pl.name}`;
                currentTrackList = [...pl.tracks];
                renderSongsGrid(currentTrackList);
            });

            li.querySelector('.pl-del-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete playlist "${pl.name}"?`)) {
                    userPlaylists = userPlaylists.filter(p => p.id !== pl.id);
                    localStorage.setItem('spotify_user_playlists', JSON.stringify(userPlaylists));
                    renderSidebarPlaylists();
                    showToast(`Deleted playlist "${pl.name}"`);
                }
            });

            userPlaylistsEl.appendChild(li);
        });
    }

    renderSidebarPlaylists();

    document.getElementById('btnCreatePlaylist').addEventListener('click', () => {
        const name = prompt("Enter a name for your new playlist:");
        if (name && name.trim()) {
            const newPl = {
                id: 'pl_' + Date.now(),
                name: name.trim(),
                tracks: []
            };
            userPlaylists.push(newPl);
            localStorage.setItem('spotify_user_playlists', JSON.stringify(userPlaylists));
            renderSidebarPlaylists();
            showToast(`Created playlist "${newPl.name}" 🎵`);
        }
    });

    // Modal
    const playlistModal = document.getElementById('playlistModal');
    const modalTrackTitle = document.getElementById('modalTrackTitle');
    const playlistSelectList = document.getElementById('playlistSelectList');
    const btnClosePlaylistModal = document.getElementById('btnClosePlaylistModal');
    const btnBarAddToPlaylist = document.getElementById('btnBarAddToPlaylist');

    btnBarAddToPlaylist.addEventListener('click', () => {
        if (!currentPlayingTrack) {
            showToast("No active track playing to add.");
            return;
        }
        modalTrackTitle.textContent = currentPlayingTrack.title;
        renderModalPlaylistSelection();
        playlistModal.classList.remove('hidden');
    });

    btnClosePlaylistModal.addEventListener('click', () => playlistModal.classList.add('hidden'));

    function renderModalPlaylistSelection() {
        playlistSelectList.innerHTML = '';
        if (userPlaylists.length === 0) {
            playlistSelectList.innerHTML = '<div style="color:var(--text-sub);">No playlists found. Create one first!</div>';
            return;
        }

        userPlaylists.forEach(pl => {
            const div = document.createElement('div');
            div.className = 'pl-select-item';
            div.textContent = `📁 ${pl.name} (${pl.tracks.length} tracks)`;

            div.addEventListener('click', () => {
                const exists = pl.tracks.some(t => t.id === currentPlayingTrack.id);
                if (!exists) {
                    pl.tracks.push(currentPlayingTrack);
                    localStorage.setItem('spotify_user_playlists', JSON.stringify(userPlaylists));
                    renderSidebarPlaylists();
                    showToast(`Added to "${pl.name}" 🎵`);
                } else {
                    showToast(`Track already in "${pl.name}"`);
                }
                playlistModal.classList.add('hidden');
            });

            playlistSelectList.appendChild(div);
        });
    }

    // -------------------------------------------------------------
    // 3. Featured Tracks & Singer / Artist Profiles
    // -------------------------------------------------------------
    const defaultFeaturedTracks = [
        {
            id: 'CCHdMIEGaaM',
            title: 'Daft Punk - Get Lucky (feat. Pharrell Williams)',
            uploader: 'Daft Punk',
            thumbnail: 'https://i.ytimg.com/vi/CCHdMIEGaaM/hqdefault.jpg',
            durationStr: '4:08',
            isYouTube: true
        },
        {
            id: 'fJ9rUzIMcZQ',
            title: 'Queen - Bohemian Rhapsody (Official Video)',
            uploader: 'Queen Official',
            thumbnail: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg',
            durationStr: '5:59',
            isYouTube: true
        },
        {
            id: '09R8_2nJtjg',
            title: 'Maroon 5 - Sugar (Official Music Video)',
            uploader: 'Maroon 5',
            thumbnail: 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg',
            durationStr: '3:55',
            isYouTube: true
        },
        {
            id: 'synth_neon',
            title: 'Neon Dreams (Original Synthwave)',
            uploader: 'Synthwave Horizon • Built-in Synth',
            thumbnail: 'synthwave_album_cover.jpg',
            durationStr: '0:32',
            isYouTube: false
        }
    ];

    let currentTrackList = [...defaultFeaturedTracks];
    let currentTrackIdx = 0;
    let currentPlayingTrack = defaultFeaturedTracks[0];
    let isPlaying = false;
    let isShuffle = false;
    let isLoop = false;

    // UI References
    const ytSearchInput = document.getElementById('ytSearchInput');
    const btnDoSearch = document.getElementById('btnDoSearch');
    const songsGrid = document.getElementById('songsGrid');
    const searchStatusText = document.getElementById('searchStatusText');
    const searchHeading = document.getElementById('searchHeading');

    const nowPlayingCover = document.getElementById('nowPlayingCover');
    const nowPlayingTitle = document.getElementById('nowPlayingTitle');
    const nowPlayingArtist = document.getElementById('nowPlayingArtist');
    const btnLikeTrack = document.getElementById('btnLikeTrack');

    const btnBarPlayPause = document.getElementById('btnBarPlayPause');
    const barPlayIcon = document.getElementById('barPlayIcon');
    const barPauseIcon = document.getElementById('barPauseIcon');
    const btnBarPrev = document.getElementById('btnBarPrev');
    const btnBarNext = document.getElementById('btnBarNext');
    const btnShuffle = document.getElementById('btnShuffle');
    const btnBarLoop = document.getElementById('btnBarLoop');

    const barCurrentTime = document.getElementById('barCurrentTime');
    const barDurationTime = document.getElementById('barDurationTime');
    const scrubberFill = document.getElementById('scrubberFill');
    const scrubberBg = document.getElementById('scrubberBg');
    const spotifyVolumeSlider = document.getElementById('spotifyVolumeSlider');
    const btnToggleVisView = document.getElementById('btnToggleVisView');

    const sectionSearchResults = document.getElementById('sectionSearchResults');
    const sectionArtistProfile = document.getElementById('sectionArtistProfile');
    const sectionLyrics = document.getElementById('sectionLyrics');
    const sectionEqualizer = document.getElementById('sectionEqualizer');
    const sectionVisualizer = document.getElementById('sectionVisualizer');
    const sectionSynthEngine = document.getElementById('sectionSynthEngine');

    // Artist Hero UI
    const artistAvatarImg = document.getElementById('artistAvatarImg');
    const artistHeroName = document.getElementById('artistHeroName');
    const artistListeners = document.getElementById('artistListeners');
    const artistBio = document.getElementById('artistBio');
    const artistTopGrid = document.getElementById('artistTopGrid');

    function openArtistProfile(artistName, avatarUrl) {
        showSection('artist');
        artistHeroName.textContent = artistName || "Singer / Artist Profile";
        if (avatarUrl) artistAvatarImg.src = avatarUrl;
        artistListeners.textContent = "18,920,410 Monthly Listeners • Verified Official Channel";
        artistBio.textContent = `${artistName} is a world-renowned music artist with millions of streams globally across all major streaming platforms and YouTube.`;
        
        // Search artist top tracks
        searchYouTubeForArtist(artistName || "Daft Punk");
    }

    async function searchYouTubeForArtist(artist) {
        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(artist + " top songs")}`);
            const data = await resp.json();
            if (data.results) {
                renderArtistTopGrid(data.results);
            }
        } catch (e) {
            console.error(e);
        }
    }

    function renderArtistTopGrid(tracks) {
        artistTopGrid.innerHTML = '';
        tracks.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-thumb-container">
                    <img src="${track.thumbnail}" alt="${track.title}" class="card-thumb">
                    <button class="play-hover-btn" title="Play">
                        <svg viewBox="0 0 24 24" width="26" height="26" fill="#000"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="song-info">
                    <div class="card-title">${track.title}</div>
                    <div class="card-artist">${track.uploader}</div>
                    <div class="card-duration">${track.durationStr || ''}</div>
                </div>
            `;
            card.addEventListener('click', () => playTrack(track));
            artistTopGrid.appendChild(card);
        });
    }

    nowPlayingArtist.addEventListener('click', () => {
        openArtistProfile(currentPlayingTrack.uploader, currentPlayingTrack.thumbnail);
    });

    document.getElementById('navArtistProfile').addEventListener('click', (e) => {
        e.preventDefault();
        openArtistProfile(currentPlayingTrack.uploader, currentPlayingTrack.thumbnail);
    });

    document.getElementById('btnFollowArtist').addEventListener('click', () => {
        const btn = document.getElementById('btnFollowArtist');
        if (btn.textContent === 'Follow') {
            btn.textContent = 'Following ✓';
            showToast("Following Artist ✓");
        } else {
            btn.textContent = 'Follow';
        }
    });

    // Render Songs Grid
    function renderSongsGrid(tracks) {
        songsGrid.innerHTML = '';
        if (!tracks || tracks.length === 0) {
            songsGrid.innerHTML = '<div style="color:var(--text-sub); grid-column: 1/-1; text-align:center; padding:3rem;">No tracks in this playlist yet.</div>';
            return;
        }

        tracks.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-thumb-container">
                    <img src="${track.thumbnail}" alt="${track.title}" class="card-thumb" onerror="this.src='synthwave_album_cover.jpg'">
                    <button class="play-hover-btn" title="Play">
                        <svg viewBox="0 0 24 24" width="26" height="26" fill="#000"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="song-info">
                    <div class="card-title">${track.title}</div>
                    <div class="card-artist clickable-artist">${track.uploader}</div>
                    <div class="card-duration">${track.durationStr || ''}</div>
                </div>
            `;
            
            // Artist click
            card.querySelector('.clickable-artist').addEventListener('click', (e) => {
                e.stopPropagation();
                openArtistProfile(track.uploader, track.thumbnail);
            });

            card.addEventListener('click', () => {
                currentTrackIdx = idx;
                playTrack(track);
            });
            songsGrid.appendChild(card);
        });
    }

    // Search YouTube
    async function searchYouTube(query) {
        if (!query.trim()) return;
        searchStatusText.textContent = `Searching YouTube for "${query}"...`;
        searchHeading.textContent = `Search Results for "${query}"`;

        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await resp.json();

            if (data.results && data.results.length > 0) {
                currentTrackList = data.results.map(r => ({ ...r, isYouTube: true }));
                renderSongsGrid(currentTrackList);
                searchStatusText.textContent = `Found ${data.results.length} ad-free tracks. Click any track to play!`;
            } else {
                searchStatusText.textContent = `No results found for "${query}".`;
            }
        } catch (err) {
            console.error("Search error:", err);
            searchStatusText.textContent = "Error performing search.";
        }
    }

    btnDoSearch.addEventListener('click', () => searchYouTube(ytSearchInput.value));
    ytSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchYouTube(ytSearchInput.value);
    });

    // Play Track
    function playTrack(track) {
        initAudioEngine();
        currentPlayingTrack = track;

        nowPlayingCover.src = track.thumbnail;
        nowPlayingTitle.textContent = track.title;
        nowPlayingArtist.textContent = `${track.uploader} • Ad-Free Stream 🛡️`;

        const isLiked = likedSongs.some(s => s.id === track.id);
        btnLikeTrack.classList.toggle('liked', isLiked);

        updateLyricsDisplay(track);

        if (track.isYouTube) {
            searchStatusText.textContent = `Streaming Ad-Free: "${track.title}"...`;
            const proxyUrl = `/api/proxy_audio?id=${track.id}`;
            youtubeAudioPlayer.src = proxyUrl;
            youtubeAudioPlayer.load();

            const playPromise = youtubeAudioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    setPlayState(true);
                    searchStatusText.textContent = `Now Playing: ${track.title}`;
                }).catch(err => {
                    console.log("Play interaction required:", err);
                    searchStatusText.textContent = `Click Play to start audio: ${track.title}`;
                });
            }
        }
    }

    function setPlayState(playing) {
        isPlaying = playing;
        if (playing) {
            barPlayIcon.classList.add('hidden');
            barPauseIcon.classList.remove('hidden');
        } else {
            barPlayIcon.classList.remove('hidden');
            barPauseIcon.classList.add('hidden');
        }
    }

    btnBarPlayPause.addEventListener('click', () => {
        if (!youtubeAudioPlayer.src && currentPlayingTrack) {
            playTrack(currentPlayingTrack);
            return;
        }

        if (youtubeAudioPlayer.paused) {
            youtubeAudioPlayer.play();
            setPlayState(true);
        } else {
            youtubeAudioPlayer.pause();
            setPlayState(false);
        }
    });

    btnBarNext.addEventListener('click', playNextTrack);
    btnBarPrev.addEventListener('click', playPrevTrack);

    function playNextTrack() {
        if (currentTrackList.length === 0) return;
        if (isShuffle) {
            currentTrackIdx = Math.floor(Math.random() * currentTrackList.length);
        } else {
            currentTrackIdx = (currentTrackIdx + 1) % currentTrackList.length;
        }
        playTrack(currentTrackList[currentTrackIdx]);
    }

    function playPrevTrack() {
        if (currentTrackList.length === 0) return;
        currentTrackIdx = (currentTrackIdx - 1 + currentTrackList.length) % currentTrackList.length;
        playTrack(currentTrackList[currentTrackIdx]);
    }

    btnShuffle.addEventListener('click', () => {
        isShuffle = !isShuffle;
        btnShuffle.classList.toggle('active', isShuffle);
        showToast(isShuffle ? "Shuffle Mode Enabled 🔀" : "Shuffle Mode Off");
    });

    btnBarLoop.addEventListener('click', () => {
        isLoop = !isLoop;
        btnBarLoop.classList.toggle('active', isLoop);
        showToast(isLoop ? "Repeat Track Enabled 🔁" : "Repeat Off");
    });

    youtubeAudioPlayer.addEventListener('ended', () => {
        if (isLoop && currentPlayingTrack) {
            playTrack(currentPlayingTrack);
        } else {
            playNextTrack();
        }
    });

    btnLikeTrack.addEventListener('click', () => {
        if (!currentPlayingTrack) return;
        const existingIdx = likedSongs.findIndex(s => s.id === currentPlayingTrack.id);
        if (existingIdx >= 0) {
            likedSongs.splice(existingIdx, 1);
            btnLikeTrack.classList.remove('liked');
            showToast("Removed from Liked Songs");
        } else {
            likedSongs.push(currentPlayingTrack);
            btnLikeTrack.classList.add('liked');
            showToast("Added to Liked Songs ❤️");
        }
        localStorage.setItem('spotify_liked_songs', JSON.stringify(likedSongs));
        updateLikedCountUI();
    });

    // Timeline Scrubber
    youtubeAudioPlayer.addEventListener('timeupdate', () => {
        if (youtubeAudioPlayer.duration) {
            const cur = youtubeAudioPlayer.currentTime;
            const dur = youtubeAudioPlayer.duration;
            scrubberFill.style.width = `${(cur / dur) * 100}%`;
            barCurrentTime.textContent = formatSecs(cur);
            barDurationTime.textContent = formatSecs(dur);
            highlightLyricsLine(cur, dur);
        }
    });

    scrubberBg.addEventListener('click', (e) => {
        const rect = scrubberBg.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (youtubeAudioPlayer.duration) {
            youtubeAudioPlayer.currentTime = pct * youtubeAudioPlayer.duration;
        }
    });

    spotifyVolumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 100;
        youtubeAudioPlayer.volume = val;
        if (masterGain) masterGain.gain.value = val;
    });

    function formatSecs(secs) {
        if (isNaN(secs) || !secs) return "0:00";
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Lyrics
    const lyricsTitle = document.getElementById('lyricsTitle');
    const lyricsArtist = document.getElementById('lyricsArtist');
    const lyricsCover = document.getElementById('lyricsCover');
    const lyricsStream = document.getElementById('lyricsStream');

    function updateLyricsDisplay(track) {
        lyricsCover.src = track.thumbnail;
        lyricsTitle.textContent = track.title;
        lyricsArtist.textContent = track.uploader;

        const dummyLyrics = [
            "♪ (Intro Melodic Beat) ♪",
            "Listen to the rhythm of the night...",
            "Feel the frequency pumping in your chest...",
            "Ad-free music floating through the visualizer...",
            "Every note harmonizes with the starlight...",
            "Sing along, turn the volume up high!",
            "♪ (Chorus Drop) ♪",
            "We are infinite in this sonic universe...",
            "Ad-free YouTube music streaming forever..."
        ];

        lyricsStream.innerHTML = '';
        dummyLyrics.forEach((line, i) => {
            const div = document.createElement('div');
            div.className = `lyric-line ${i === 0 ? 'active' : ''}`;
            div.dataset.index = i;
            div.textContent = line;
            lyricsStream.appendChild(div);
        });
    }

    function highlightLyricsLine(cur, dur) {
        const lines = lyricsStream.querySelectorAll('.lyric-line');
        if (!lines || lines.length === 0) return;
        const total = lines.length;
        const currentIdx = Math.min(Math.floor((cur / dur) * total), total - 1);

        lines.forEach((l, idx) => {
            l.classList.toggle('active', idx === currentIdx);
        });
    }

    // Equalizer
    const eq60 = document.getElementById('eq60');
    const eq230 = document.getElementById('eq230');
    const eq910 = document.getElementById('eq910');
    const eq4k = document.getElementById('eq4k');
    const eq14k = document.getElementById('eq14k');

    const val60 = document.getElementById('val60');
    const val230 = document.getElementById('val230');
    const val910 = document.getElementById('val910');
    const val4k = document.getElementById('val4k');
    const val14k = document.getElementById('val14k');
    const eqPresetSelect = document.getElementById('eqPresetSelect');

    function setEQGain(idx, val, elVal) {
        initAudioEngine();
        if (eqFilters[idx]) {
            eqFilters[idx].gain.value = val;
            elVal.textContent = `${val} dB`;
        }
    }

    eq60.addEventListener('input', (e) => setEQGain(0, parseInt(e.target.value), val60));
    eq230.addEventListener('input', (e) => setEQGain(1, parseInt(e.target.value), val230));
    eq910.addEventListener('input', (e) => setEQGain(2, parseInt(e.target.value), val910));
    eq4k.addEventListener('input', (e) => setEQGain(3, parseInt(e.target.value), val4k));
    eq14k.addEventListener('input', (e) => setEQGain(4, parseInt(e.target.value), val14k));

    eqPresetSelect.addEventListener('change', (e) => {
        const preset = e.target.value;
        const presets = {
            flat: [0, 0, 0, 0, 0],
            bass: [8, 5, 1, 0, -2],
            vocal: [-2, 2, 6, 4, 1],
            treble: [-4, -2, 1, 6, 8],
            electronic: [6, 4, 0, 3, 6]
        };
        const vals = presets[preset] || [0, 0, 0, 0, 0];

        eq60.value = vals[0]; setEQGain(0, vals[0], val60);
        eq230.value = vals[1]; setEQGain(1, vals[1], val230);
        eq910.value = vals[2]; setEQGain(2, vals[2], val910);
        eq4k.value = vals[3]; setEQGain(3, vals[3], val4k);
        eq14k.value = vals[4]; setEQGain(4, vals[4], val14k);

        showToast(`Equalizer Preset: ${preset.toUpperCase()}`);
    });

    // -------------------------------------------------------------
    // 14. FIX: All 3 Live Spectrum Visualizer Modes (Bars, Waveform, Cosmic)
    // -------------------------------------------------------------
    const spotifyCanvas = document.getElementById('spotifyCanvas');
    const ctx = spotifyCanvas.getContext('2d');
    let visMode = 'bars';

    document.getElementById('modeBars').addEventListener('click', (e) => setVisMode('bars', e.target));
    document.getElementById('modeWave').addEventListener('click', (e) => setVisMode('wave', e.target));
    document.getElementById('modeCosmic').addEventListener('click', (e) => setVisMode('cosmic', e.target));

    function setVisMode(mode, btn) {
        visMode = mode;
        document.querySelectorAll('.vis-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Visualizer Mode: ${mode.toUpperCase()}`);
    }

    function drawSpotifyVisualizer() {
        requestAnimationFrame(drawSpotifyVisualizer);
        ctx.clearRect(0, 0, spotifyCanvas.width, spotifyCanvas.height);

        if (!analyserNode) return;

        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        if (visMode === 'wave') {
            // Waveform Oscilloscope Mode
            analyserNode.getByteTimeDomainData(dataArray);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#1db954';
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#1db954';
            ctx.beginPath();

            const sliceWidth = spotifyCanvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * spotifyCanvas.height) / 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

        } else if (visMode === 'cosmic') {
            // Cosmic Particle Mode
            analyserNode.getByteFrequencyData(dataArray);
            const centerX = spotifyCanvas.width / 2;
            const centerY = spotifyCanvas.height / 2;

            for (let i = 0; i < bufferLength; i += 2) {
                const val = dataArray[i];
                const radius = (val / 255) * 120 + 20;
                const angle = (i / bufferLength) * Math.PI * 2;

                const x = centerX + Math.cos(angle) * radius * 2.4;
                const y = centerY + Math.sin(angle) * radius * 1.0;

                ctx.beginPath();
                ctx.arc(x, y, (val / 255) * 8 + 3, 0, Math.PI * 2);
                ctx.fillStyle = `hsl(${(i * 12 + 120) % 360}, 90%, 55%)`;
                ctx.shadowBlur = 12;
                ctx.shadowColor = `hsl(${(i * 12 + 120) % 360}, 90%, 55%)`;
                ctx.fill();
            }
            ctx.shadowBlur = 0;

        } else {
            // Frequency Spectrum Bars Mode
            analyserNode.getByteFrequencyData(dataArray);
            const barWidth = (spotifyCanvas.width / bufferLength) * 2.2;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * spotifyCanvas.height;
                const gradient = ctx.createLinearGradient(0, spotifyCanvas.height, 0, 0);
                gradient.addColorStop(0, '#1db954');
                gradient.addColorStop(0.6, '#1ed760');
                gradient.addColorStop(1, '#ffffff');

                ctx.fillStyle = gradient;
                ctx.fillRect(x, spotifyCanvas.height - barHeight, barWidth - 3, barHeight);
                x += barWidth;
            }
        }
    }

    // Sidebar & View Wiring
    document.getElementById('navHome').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navHome'); showSection('search'); renderSongsGrid(defaultFeaturedTracks); });
    document.getElementById('navSearch').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navSearch'); showSection('search'); ytSearchInput.focus(); });
    document.getElementById('navLibrary').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navLibrary'); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); });
    document.getElementById('navLyrics').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navLyrics'); showSection('lyrics'); });
    document.getElementById('navEqualizer').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navEqualizer'); showSection('equalizer'); });
    document.getElementById('navSynth').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navSynth'); showSection('synth'); });

    document.getElementById('plLiked').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plLiked')); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); });
    document.getElementById('plTrending').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plTrending')); showSection('search'); searchYouTube('trending music songs 2026'); });

    function setActiveNav(id) {
        document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    function setActivePlaylistItem(item) {
        document.querySelectorAll('.pl-item').forEach(li => li.classList.remove('active'));
        if (item) item.classList.add('active');
    }

    btnToggleVisView.addEventListener('click', () => {
        if (sectionVisualizer.classList.contains('hidden')) {
            showSection('visualizer');
            btnToggleVisView.classList.add('active');
        } else {
            showSection('search');
            btnToggleVisView.classList.remove('active');
        }
    });

    function showSection(section) {
        sectionSearchResults.classList.add('hidden');
        sectionArtistProfile.classList.add('hidden');
        sectionLyrics.classList.add('hidden');
        sectionEqualizer.classList.add('hidden');
        sectionVisualizer.classList.add('hidden');
        sectionSynthEngine.classList.add('hidden');

        if (section === 'artist') sectionArtistProfile.classList.remove('hidden');
        else if (section === 'lyrics') sectionLyrics.classList.remove('hidden');
        else if (section === 'equalizer') sectionEqualizer.classList.remove('hidden');
        else if (section === 'visualizer') sectionVisualizer.classList.remove('hidden');
        else if (section === 'synth') sectionSynthEngine.classList.remove('hidden');
        else sectionSearchResults.classList.remove('hidden');
    }

    // Filter Chips
    document.getElementById('chipAll').addEventListener('click', () => { showSection('search'); currentTrackList = [...defaultFeaturedTracks]; renderSongsGrid(currentTrackList); });
    document.getElementById('chipYouTube').addEventListener('click', () => { showSection('search'); searchYouTube('trending music songs 2026'); });
    document.getElementById('chipArtist').addEventListener('click', () => openArtistProfile(currentPlayingTrack.uploader, currentPlayingTrack.thumbnail));
    document.getElementById('chipLiked').addEventListener('click', () => { showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); });
    document.getElementById('chipVisualizer').addEventListener('click', () => showSection('visualizer'));

    // Init
    renderSongsGrid(defaultFeaturedTracks);
    drawSpotifyVisualizer();
});
