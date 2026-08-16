// Spotify PRO Dynamic Audio Engine & Application Logic
document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. Audio Context & Master Equalizer Setup
    // -------------------------------------------------------------
    let audioCtx = null;
    let masterGain = null;
    let analyserNode = null;
    let audioSourceNode = null;
    let eqFilters = [];

    const youtubeAudioPlayer = document.getElementById('youtubeAudioPlayer');

    function initAudioEngine() {
        if (!audioCtx) {
            try {
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
                    console.log("Audio media element connection note:", err);
                }

                masterGain.connect(analyserNode);
                analyserNode.connect(audioCtx.destination);
            } catch (e) {
                console.error("Audio Context initialization failed:", e);
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // Synthesize procedural note for piano & built-in tracks
    function playSynthNote(freq, duration = 0.5, type = 'sawtooth') {
        initAudioEngine();
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const noteGain = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, audioCtx.currentTime);
            filter.Q.setValueAtTime(3, audioCtx.currentTime);

            noteGain.gain.setValueAtTime(0.4, audioCtx.currentTime);
            noteGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

            osc.connect(filter);
            filter.connect(masterGain || audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) {
            console.error("Synth note error:", e);
        }
    }

    // Built-in Synthwave track sound loop generator
    let synthLoopTimer = null;
    function playBuiltinSynthTrack() {
        initAudioEngine();
        const notes = [261.63, 329.63, 392.00, 493.88, 523.25, 493.88, 392.00, 329.63];
        let idx = 0;
        if (synthLoopTimer) clearInterval(synthLoopTimer);
        setPlayState(true);
        synthLoopTimer = setInterval(() => {
            if (!isPlaying || currentPlayingTrack.isYouTube) {
                clearInterval(synthLoopTimer);
                return;
            }
            playSynthNote(notes[idx % notes.length], 0.3, 'sawtooth');
            idx++;
        }, 300);
    }

    // -------------------------------------------------------------
    // 2. YouTube Client IFrame Player Initialization & Error Handling
    // -------------------------------------------------------------
    let ytClientPlayer = null;
    let isClientPlayerActive = false;

    function initYTPlayer() {
        if (ytClientPlayer || typeof YT === 'undefined' || !YT.Player) return;
        try {
            ytClientPlayer = new YT.Player('clientYtFrame', {
                height: '1',
                width: '1',
                videoId: '',
                playerVars: {
                    'autoplay': 1,
                    'controls': 0,
                    'playsinline': 1,
                    'rel': 0,
                    'modestbranding': 1,
                    'enablejsapi': 1
                },
                events: {
                    'onStateChange': onClientPlayerStateChange,
                    'onError': onClientPlayerError
                }
            });
        } catch (e) {
            console.error("YT Player init error:", e);
        }
    }

    window.onYouTubeIframeAPIReady = function() {
        initYTPlayer();
    };

    if (window.YT && window.YT.Player) {
        initYTPlayer();
    }

    function onClientPlayerStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING) {
            setPlayState(true);
            searchStatusText.textContent = `Now Playing: ${currentPlayingTrack ? currentPlayingTrack.title : ''}`;
        } else if (event.data === YT.PlayerState.PAUSED) {
            setPlayState(false);
        } else if (event.data === YT.PlayerState.ENDED) {
            if (isLoop && currentPlayingTrack) {
                playTrack(currentPlayingTrack);
            } else {
                playNextTrack();
            }
        }
    }

    // Automatic Error Recovery on restricted/blocked video embedding
    async function onClientPlayerError(event) {
        console.warn("YouTube Player error code:", event.data);
        if (event.data === 101 || event.data === 150 || event.data === 100 || event.data === 2) {
            showToast("Embedding restricted. Auto-switching to audio stream...");
            if (currentPlayingTrack) {
                try {
                    const fallbackQuery = `${currentPlayingTrack.uploader} ${currentPlayingTrack.title} audio`;
                    const resp = await fetch(`/api/search?q=${encodeURIComponent(fallbackQuery)}`);
                    const data = await resp.json();
                    if (data.results && data.results.length > 0) {
                        const altTrack = data.results.find(r => r.id !== currentPlayingTrack.id) || data.results[0];
                        if (altTrack) {
                            showToast(`Playing alternative version: ${altTrack.title}`);
                            playViaClientYTPlayer(altTrack.id);
                            return;
                        }
                    }
                } catch (err) {
                    console.error("Fallback search failed:", err);
                }
            }
        }
    }

    // Scrubber update timer
    setInterval(() => {
        if (isClientPlayerActive && ytClientPlayer && ytClientPlayer.getCurrentTime) {
            try {
                const cur = ytClientPlayer.getCurrentTime() || 0;
                const dur = ytClientPlayer.getDuration() || 0;
                if (dur > 0) {
                    const pct = `${(cur / dur) * 100}%`;
                    scrubberFill.style.width = pct;
                    if (mPlayerScrubberFill) mPlayerScrubberFill.style.width = pct;

                    const curStr = formatSecs(cur);
                    const durStr = formatSecs(dur);

                    barCurrentTime.textContent = curStr;
                    barDurationTime.textContent = durStr;
                    if (mPlayerCurrentTime) mPlayerCurrentTime.textContent = curStr;
                    if (mPlayerDurationTime) mPlayerDurationTime.textContent = durStr;

                    highlightLyricsLine(cur, dur);
                }
            } catch (e) {}
        }
    }, 400);

    // -------------------------------------------------------------
    // 3. Mobile Menu & Drawer Control
    // -------------------------------------------------------------
    const sidebarDrawer = document.getElementById('sidebarDrawer');
    const btnOpenMobileMenu = document.getElementById('btnOpenMobileMenu');
    const btnCloseSidebarMobile = document.getElementById('btnCloseSidebarMobile');

    if (btnOpenMobileMenu) {
        btnOpenMobileMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarDrawer.classList.add('open');
        });
    }

    if (btnCloseSidebarMobile) {
        btnCloseSidebarMobile.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebarDrawer.classList.remove('open');
        });
    }

    document.querySelectorAll('.nav-item, .pl-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebarDrawer.classList.remove('open');
            }
        });
    });

    // -------------------------------------------------------------
    // 4. Playlists, Liked Songs & Song Play History Persistence
    // -------------------------------------------------------------
    let likedSongs = JSON.parse(localStorage.getItem('spotify_liked_songs') || '[]');
    let userPlaylists = JSON.parse(localStorage.getItem('spotify_user_playlists') || '[]');
    let playHistory = JSON.parse(localStorage.getItem('spotify_play_history') || '[]');

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
        const el = document.getElementById('likedCount');
        if (el) el.textContent = likedSongs.length;
    }
    updateLikedCountUI();

    function updateHistoryCountUI() {
        const el = document.getElementById('historyCount');
        if (el) el.textContent = playHistory.length;
    }
    updateHistoryCountUI();

    function addToPlayHistory(track) {
        if (!track) return;
        playHistory = playHistory.filter(t => t.id !== track.id);
        playHistory.unshift({
            ...track,
            playedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        if (playHistory.length > 50) playHistory.pop();
        localStorage.setItem('spotify_play_history', JSON.stringify(playHistory));
        updateHistoryCountUI();
    }

    function renderHistoryGrid() {
        const historyGrid = document.getElementById('historyGrid');
        if (!historyGrid) return;
        historyGrid.innerHTML = '';
        if (playHistory.length === 0) {
            historyGrid.innerHTML = '<div style="color:var(--text-sub); grid-column: 1/-1; text-align:center; padding:3rem;">No listening history yet. Play any song to track it here!</div>';
            return;
        }

        playHistory.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-thumb-container">
                    <img src="${track.thumbnail}" alt="${track.title}" class="card-thumb" onerror="this.src='synthwave_album_cover.jpg'">
                    <button class="play-hover-btn" title="Play">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="#000"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="song-info">
                    <div class="card-title">${track.title}</div>
                    <div class="card-artist clickable-artist">${track.uploader}</div>
                    <div class="card-duration">Played: ${track.playedAt || ''}</div>
                </div>
            `;

            card.querySelector('.clickable-artist').addEventListener('click', (e) => {
                e.stopPropagation();
                openArtistProfile(track.uploader, track.thumbnail);
            });

            card.addEventListener('click', () => {
                currentTrackList = [...playHistory];
                currentTrackIdx = idx;
                playTrack(track);
            });
            historyGrid.appendChild(card);
        });
    }

    const btnClearHistory = document.getElementById('btnClearHistory');
    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', () => {
            if (confirm("Clear your entire listening history?")) {
                playHistory = [];
                localStorage.setItem('spotify_play_history', JSON.stringify(playHistory));
                updateHistoryCountUI();
                renderHistoryGrid();
                showToast("Listening history cleared");
            }
        });
    }

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

    // Playlist Add Modal
    const playlistModal = document.getElementById('playlistModal');
    const modalTrackTitle = document.getElementById('modalTrackTitle');
    const playlistSelectList = document.getElementById('playlistSelectList');
    const btnClosePlaylistModal = document.getElementById('btnClosePlaylistModal');
    const btnBarAddToPlaylist = document.getElementById('btnBarAddToPlaylist');

    btnBarAddToPlaylist.addEventListener('click', (e) => {
        e.stopPropagation();
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
            div.style.cssText = 'padding: 0.5rem; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 4px; cursor: pointer; color: var(--text-white); font-size: 0.85rem;';
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
    // 5. Featured Tracks & Artist Profiles
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
    const sectionHistory = document.getElementById('sectionHistory');

    // Artist Hero UI
    const artistAvatarImg = document.getElementById('artistAvatarImg');
    const artistHeroName = document.getElementById('artistHeroName');
    const artistListeners = document.getElementById('artistListeners');
    const artistBio = document.getElementById('artistBio');
    const artistTopGrid = document.getElementById('artistTopGrid');

    // Mobile Full Player Modal UI
    const mobileFullPlayerModal = document.getElementById('mobileFullPlayerModal');
    const btnCloseMobilePlayer = document.getElementById('btnCloseMobilePlayer');
    const mPlayerCover = document.getElementById('mPlayerCover');
    const mPlayerTitle = document.getElementById('mPlayerTitle');
    const mPlayerArtist = document.getElementById('mPlayerArtist');
    const mPlayerPlayPause = document.getElementById('mPlayerPlayPause');
    const mBarPlayIcon = document.getElementById('mBarPlayIcon');
    const mBarPauseIcon = document.getElementById('mBarPauseIcon');
    const mPlayerPrev = document.getElementById('mPlayerPrev');
    const mPlayerNext = document.getElementById('mPlayerNext');
    const mPlayerShuffle = document.getElementById('mPlayerShuffle');
    const mPlayerLoop = document.getElementById('mPlayerLoop');
    const mPlayerScrubberFill = document.getElementById('mPlayerScrubberFill');
    const mPlayerScrubberBg = document.getElementById('mPlayerScrubberBg');
    const mPlayerCurrentTime = document.getElementById('mPlayerCurrentTime');
    const mPlayerDurationTime = document.getElementById('mPlayerDurationTime');
    const mPlayerBtnLike = document.getElementById('mPlayerBtnLike');
    const mBtnOpenLyrics = document.getElementById('mBtnOpenLyrics');
    const mBtnOpenEQ = document.getElementById('mBtnOpenEQ');

    // Open Mobile Expanded Player Modal on mobile player bar tap
    document.querySelector('.now-playing-left').addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            mobileFullPlayerModal.classList.remove('hidden');
        }
    });

    if (btnCloseMobilePlayer) {
        btnCloseMobilePlayer.addEventListener('click', () => {
            mobileFullPlayerModal.classList.add('hidden');
        });
    }

    if (mBtnOpenLyrics) {
        mBtnOpenLyrics.addEventListener('click', () => {
            mobileFullPlayerModal.classList.add('hidden');
            showSection('lyrics');
        });
    }

    if (mBtnOpenEQ) {
        mBtnOpenEQ.addEventListener('click', () => {
            mobileFullPlayerModal.classList.add('hidden');
            showSection('equalizer');
        });
    }

    function openArtistProfile(artistName, avatarUrl) {
        showSection('artist');
        artistHeroName.textContent = artistName || "Singer / Artist Profile";
        if (avatarUrl) artistAvatarImg.src = avatarUrl;
        artistListeners.textContent = "18,920,410 Monthly Listeners • Verified Official Channel";
        artistBio.textContent = `${artistName} is a world-renowned music artist with millions of streams globally across all major streaming platforms and YouTube.`;
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
        tracks.forEach((track) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-thumb-container">
                    <img src="${track.thumbnail}" alt="${track.title}" class="card-thumb" onerror="this.src='synthwave_album_cover.jpg'">
                    <button class="play-hover-btn" title="Play">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="#000"><path d="M8 5v14l11-7z"/></svg>
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

    nowPlayingArtist.addEventListener('click', (e) => {
        e.stopPropagation();
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
            songsGrid.innerHTML = '<div style="color:var(--text-sub); grid-column: 1/-1; text-align:center; padding:3rem;">No tracks found. Search for a song or artist above!</div>';
            return;
        }

        tracks.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-thumb-container">
                    <img src="${track.thumbnail}" alt="${track.title}" class="card-thumb" onerror="this.src='synthwave_album_cover.jpg'">
                    <button class="play-hover-btn" title="Play">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="#000"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="song-info">
                    <div class="card-title">${track.title}</div>
                    <div class="card-artist clickable-artist">${track.uploader}</div>
                    <div class="card-duration">${track.durationStr || ''}</div>
                </div>
            `;
            
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

    // Search YouTube (Bulletproof with Multi-Tier Fallback)
    async function searchYouTube(query) {
        if (!query.trim()) return;
        searchStatusText.textContent = `Searching for "${query}"...`;
        searchHeading.textContent = `Search Results for "${query}"`;

        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await resp.json();

            if (data.results && data.results.length > 0) {
                currentTrackList = data.results.map(r => ({ ...r, isYouTube: true }));
                renderSongsGrid(currentTrackList);
                searchStatusText.textContent = `Found ${data.results.length} ad-free tracks. Tap any song to play!`;
                return;
            }
        } catch (err) {
            console.error("Primary search error, trying client fallback:", err);
        }

        // Client-side Invidious search fallback if server search fails
        try {
            const fallbackUrl = `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(query)}`;
            const fbResp = await fetch(fallbackUrl);
            const fbData = await fbResp.json();
            if (Array.isArray(fbData) && fbData.length > 0) {
                const results = fbData.filter(item => item.type === 'video').map(v => ({
                    id: v.videoId,
                    title: v.title,
                    uploader: v.author,
                    thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                    durationStr: formatSecs(v.lengthSeconds),
                    isYouTube: true
                }));
                if (results.length > 0) {
                    currentTrackList = results;
                    renderSongsGrid(currentTrackList);
                    searchStatusText.textContent = `Found ${results.length} ad-free tracks via client proxy.`;
                    return;
                }
            }
        } catch (fbErr) {
            console.error("Client search fallback error:", fbErr);
        }

        searchStatusText.textContent = `No results found for "${query}". Try another song name!`;
    }

    btnDoSearch.addEventListener('click', () => searchYouTube(ytSearchInput.value));
    ytSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchYouTube(ytSearchInput.value);
    });

    // -------------------------------------------------------------
    // 6. Failproof Direct Audio Stream & Playback Engine
    // -------------------------------------------------------------
    function playTrack(track) {
        initAudioEngine();
        currentPlayingTrack = track;
        addToPlayHistory(track);

        nowPlayingCover.src = track.thumbnail;
        nowPlayingTitle.textContent = track.title;
        nowPlayingArtist.textContent = `${track.uploader} • Ad-Free Stream 🛡️`;

        if (mPlayerCover) mPlayerCover.src = track.thumbnail;
        if (mPlayerTitle) mPlayerTitle.textContent = track.title;
        if (mPlayerArtist) mPlayerArtist.textContent = track.uploader;

        const isLiked = likedSongs.some(s => s.id === track.id);
        btnLikeTrack.classList.toggle('liked', isLiked);
        if (mPlayerBtnLike) mPlayerBtnLike.classList.toggle('liked', isLiked);

        updateLyricsDisplay(track);

        if (track.isYouTube) {
            searchStatusText.textContent = `Now Playing: "${track.title}"`;
            playViaClientYTPlayer(track.id);
        } else {
            // Built-in Synthesizer Track
            isClientPlayerActive = false;
            if (ytClientPlayer && ytClientPlayer.stopVideo) ytClientPlayer.stopVideo();
            playBuiltinSynthTrack();
        }
    }

    function playViaClientYTPlayer(videoId) {
        isClientPlayerActive = true;
        youtubeAudioPlayer.pause();

        initYTPlayer();
        if (ytClientPlayer && ytClientPlayer.loadVideoById) {
            ytClientPlayer.loadVideoById(videoId);
            setPlayState(true);
        } else {
            setTimeout(() => playViaClientYTPlayer(videoId), 400);
        }
    }

    function setPlayState(playing) {
        isPlaying = playing;
        if (playing) {
            barPlayIcon.classList.add('hidden');
            barPauseIcon.classList.remove('hidden');
            if (mBarPlayIcon) mBarPlayIcon.classList.add('hidden');
            if (mBarPauseIcon) mBarPauseIcon.classList.remove('hidden');
        } else {
            barPlayIcon.classList.remove('hidden');
            barPauseIcon.classList.add('hidden');
            if (mBarPlayIcon) mBarPlayIcon.classList.remove('hidden');
            if (mBarPauseIcon) mBarPauseIcon.classList.add('hidden');
        }
    }

    function togglePlayPause() {
        if (isClientPlayerActive && ytClientPlayer) {
            if (isPlaying) {
                ytClientPlayer.pauseVideo();
                setPlayState(false);
            } else {
                ytClientPlayer.playVideo();
                setPlayState(true);
            }
            return;
        }

        if (!currentPlayingTrack.isYouTube) {
            if (isPlaying) {
                setPlayState(false);
                if (synthLoopTimer) clearInterval(synthLoopTimer);
            } else {
                playBuiltinSynthTrack();
            }
            return;
        }

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
    }

    btnBarPlayPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });
    if (mPlayerPlayPause) mPlayerPlayPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlayPause(); });

    btnBarNext.addEventListener('click', (e) => { e.stopPropagation(); playNextTrack(); });
    btnBarPrev.addEventListener('click', (e) => { e.stopPropagation(); playPrevTrack(); });
    if (mPlayerNext) mPlayerNext.addEventListener('click', (e) => { e.stopPropagation(); playNextTrack(); });
    if (mPlayerPrev) mPlayerPrev.addEventListener('click', (e) => { e.stopPropagation(); playPrevTrack(); });

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

    function toggleShuffle() {
        isShuffle = !isShuffle;
        btnShuffle.classList.toggle('active', isShuffle);
        if (mPlayerShuffle) mPlayerShuffle.classList.toggle('active', isShuffle);
        showToast(isShuffle ? "Shuffle Mode Enabled 🔀" : "Shuffle Mode Off");
    }

    function toggleLoop() {
        isLoop = !isLoop;
        btnBarLoop.classList.toggle('active', isLoop);
        if (mPlayerLoop) mPlayerLoop.classList.toggle('active', isLoop);
        showToast(isLoop ? "Repeat Track Enabled 🔁" : "Repeat Off");
    }

    btnShuffle.addEventListener('click', (e) => { e.stopPropagation(); toggleShuffle(); });
    if (mPlayerShuffle) mPlayerShuffle.addEventListener('click', (e) => { e.stopPropagation(); toggleShuffle(); });

    btnBarLoop.addEventListener('click', (e) => { e.stopPropagation(); toggleLoop(); });
    if (mPlayerLoop) mPlayerLoop.addEventListener('click', (e) => { e.stopPropagation(); toggleLoop(); });

    function toggleLikeCurrentTrack() {
        if (!currentPlayingTrack) return;
        const existingIdx = likedSongs.findIndex(s => s.id === currentPlayingTrack.id);
        if (existingIdx >= 0) {
            likedSongs.splice(existingIdx, 1);
            btnLikeTrack.classList.remove('liked');
            if (mPlayerBtnLike) mPlayerBtnLike.classList.remove('liked');
            showToast("Removed from Liked Songs");
        } else {
            likedSongs.push(currentPlayingTrack);
            btnLikeTrack.classList.add('liked');
            if (mPlayerBtnLike) mPlayerBtnLike.classList.add('liked');
            showToast("Added to Liked Songs ❤️");
        }
        localStorage.setItem('spotify_liked_songs', JSON.stringify(likedSongs));
        updateLikedCountUI();
    }

    btnLikeTrack.addEventListener('click', (e) => { e.stopPropagation(); toggleLikeCurrentTrack(); });
    if (mPlayerBtnLike) mPlayerBtnLike.addEventListener('click', (e) => { e.stopPropagation(); toggleLikeCurrentTrack(); });

    // Scrubber click handlers
    function handleScrubberSeek(e, container) {
        const rect = container.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (isClientPlayerActive && ytClientPlayer && ytClientPlayer.getDuration) {
            const dur = ytClientPlayer.getDuration();
            ytClientPlayer.seekTo(pct * dur, true);
        }
    }

    scrubberBg.addEventListener('click', (e) => { e.stopPropagation(); handleScrubberSeek(e, scrubberBg); });
    if (mPlayerScrubberBg) mPlayerScrubberBg.addEventListener('click', (e) => { e.stopPropagation(); handleScrubberSeek(e, mPlayerScrubberBg); });

    spotifyVolumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        if (isClientPlayerActive && ytClientPlayer && ytClientPlayer.setVolume) {
            ytClientPlayer.setVolume(val);
        }
        youtubeAudioPlayer.volume = val / 100;
        if (masterGain) masterGain.gain.value = val / 100;
    });

    function formatSecs(secs) {
        if (isNaN(secs) || !secs) return "0:00";
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // Synchronized Lyrics
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

    // -------------------------------------------------------------
    // 7. Spotify Equalizer
    // -------------------------------------------------------------
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
    // 8. Real-Time Audio Spectrum & Waveform Visualizer
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

    function resizeCanvas() {
        if (spotifyCanvas.parentElement) {
            spotifyCanvas.width = spotifyCanvas.parentElement.clientWidth - 24;
            spotifyCanvas.height = 320;
        }
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function drawSpotifyVisualizer() {
        requestAnimationFrame(drawSpotifyVisualizer);
        ctx.clearRect(0, 0, spotifyCanvas.width, spotifyCanvas.height);

        if (!analyserNode) return;

        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        if (visMode === 'wave') {
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
            analyserNode.getByteFrequencyData(dataArray);
            const centerX = spotifyCanvas.width / 2;
            const centerY = spotifyCanvas.height / 2;

            for (let i = 0; i < bufferLength; i += 2) {
                const val = dataArray[i];
                const radius = (val / 255) * 110 + 20;
                const angle = (i / bufferLength) * Math.PI * 2;

                const x = centerX + Math.cos(angle) * radius * 2.2;
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

    // -------------------------------------------------------------
    // 9. Virtual Piano Synthesizer & Step Sequencer Implementation
    // -------------------------------------------------------------
    const pianoWrapper = document.getElementById('pianoWrapper');
    const spotifySeqGrid = document.getElementById('spotifySeqGrid');
    const btnSeqToggle = document.getElementById('btnSeqToggle');
    const btnSeqClear = document.getElementById('btnSeqClear');

    const pianoNotes = [
        { note: 'C4', freq: 261.63, key: 'A', type: 'white' },
        { note: 'C#4', freq: 277.18, key: 'W', type: 'black' },
        { note: 'D4', freq: 293.66, key: 'S', type: 'white' },
        { note: 'D#4', freq: 311.13, key: 'E', type: 'black' },
        { note: 'E4', freq: 329.63, key: 'D', type: 'white' },
        { note: 'F4', freq: 349.23, key: 'F', type: 'white' },
        { note: 'F#4', freq: 369.99, key: 'T', type: 'black' },
        { note: 'G4', freq: 392.00, key: 'G', type: 'white' },
        { note: 'G#4', freq: 415.30, key: 'Y', type: 'black' },
        { note: 'A4', freq: 440.00, key: 'H', type: 'white' },
        { note: 'A#4', freq: 466.16, key: 'U', type: 'black' },
        { note: 'B4', freq: 493.88, key: 'J', type: 'white' },
        { note: 'C5', freq: 523.25, key: 'K', type: 'white' },
        { note: 'C#5', freq: 554.37, key: 'O', type: 'black' }
    ];

    if (pianoWrapper) {
        pianoNotes.forEach(p => {
            const keyDiv = document.createElement('div');
            keyDiv.className = `piano-key ${p.type}-key`;
            keyDiv.dataset.key = p.key;
            keyDiv.dataset.note = p.note;
            keyDiv.innerHTML = `
                <span class="key-note">${p.note}</span>
                <span class="key-label">[${p.key}]</span>
            `;

            const triggerKey = () => {
                playSynthNote(p.freq, 0.4, 'sawtooth');
                keyDiv.classList.add('active');
                setTimeout(() => keyDiv.classList.remove('active'), 150);
            };

            keyDiv.addEventListener('mousedown', triggerKey);
            keyDiv.addEventListener('touchstart', (e) => { e.preventDefault(); triggerKey(); });
            pianoWrapper.appendChild(keyDiv);
        });

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            const k = e.key.toUpperCase();
            const noteObj = pianoNotes.find(p => p.key === k);
            if (noteObj) {
                playSynthNote(noteObj.freq, 0.4, 'sawtooth');
                const keyEl = pianoWrapper.querySelector(`[data-key="${k}"]`);
                if (keyEl) {
                    keyEl.classList.add('active');
                    setTimeout(() => keyEl.classList.remove('active'), 150);
                }
            }
        });
    }

    // Step Sequencer Logic
    const seqTracks = [
        { name: 'Kick 🥁', type: 'kick' },
        { name: 'Snare 🥁', type: 'snare' },
        { name: 'Hi-Hat 🎩', type: 'hihat' },
        { name: 'Synth Lead 🎹', type: 'lead' }
    ];
    const totalSteps = 16;
    const seqGridData = Array(4).fill(null).map(() => Array(totalSteps).fill(false));
    let isSeqPlaying = false;
    let seqInterval = null;
    let currentSeqStep = 0;

    // Preset default groove in step sequencer
    seqGridData[0][0] = true; seqGridData[0][4] = true; seqGridData[0][8] = true; seqGridData[0][12] = true; // Kick
    seqGridData[1][4] = true; seqGridData[1][12] = true; // Snare
    for (let s = 0; s < 16; s += 2) seqGridData[2][s] = true; // Hi-hat
    seqGridData[3][0] = true; seqGridData[3][3] = true; seqGridData[3][6] = true; seqGridData[3][10] = true; // Lead

    function renderSequencer() {
        if (!spotifySeqGrid) return;
        spotifySeqGrid.innerHTML = '';
        seqTracks.forEach((track, rIdx) => {
            const row = document.createElement('div');
            row.className = 'seq-row';

            const label = document.createElement('div');
            label.className = 'seq-track-label';
            label.textContent = track.name;
            row.appendChild(label);

            for (let cIdx = 0; cIdx < totalSteps; cIdx++) {
                const pad = document.createElement('div');
                pad.className = `seq-step-pad ${seqGridData[rIdx][cIdx] ? 'active' : ''}`;
                pad.dataset.row = rIdx;
                pad.dataset.col = cIdx;

                pad.addEventListener('click', () => {
                    seqGridData[rIdx][cIdx] = !seqGridData[rIdx][cIdx];
                    pad.classList.toggle('active', seqGridData[rIdx][cIdx]);
                    if (seqGridData[rIdx][cIdx]) playSeqSound(rIdx);
                });

                row.appendChild(pad);
            }
            spotifySeqGrid.appendChild(row);
        });
    }

    function playSeqSound(rIdx) {
        initAudioEngine();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;

        if (rIdx === 0) {
            // Kick synth sound
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.15);
            gain.gain.setValueAtTime(1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.connect(gain);
            gain.connect(masterGain || audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.15);

        } else if (rIdx === 1) {
            // Snare synth sound
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
            gain.gain.setValueAtTime(0.7, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.connect(gain);
            gain.connect(masterGain || audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.1);

        } else if (rIdx === 2) {
            // Hi-Hat synth sound
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(8000, now);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.connect(gain);
            gain.connect(masterGain || audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.05);

        } else if (rIdx === 3) {
            // Lead melodic synth sound
            const leadPitches = [329.63, 392.00, 440.00, 523.25];
            const pitch = leadPitches[currentSeqStep % leadPitches.length];
            playSynthNote(pitch, 0.2, 'sawtooth');
        }
    }

    function stepSequencerTick() {
        document.querySelectorAll('.seq-step-pad').forEach(p => p.classList.remove('current'));
        seqTracks.forEach((t, rIdx) => {
            const pad = spotifySeqGrid.querySelector(`[data-row="${rIdx}"][data-col="${currentSeqStep}"]`);
            if (pad) pad.classList.add('current');
            if (seqGridData[rIdx][currentSeqStep]) {
                playSeqSound(rIdx);
            }
        });
        currentSeqStep = (currentSeqStep + 1) % totalSteps;
    }

    if (btnSeqToggle) {
        btnSeqToggle.addEventListener('click', () => {
            isSeqPlaying = !isSeqPlaying;
            if (isSeqPlaying) {
                btnSeqToggle.textContent = 'Stop Loop ⏹️';
                btnSeqToggle.style.background = '#ef4444';
                seqInterval = setInterval(stepSequencerTick, 125); // 120 BPM
                showToast("Sequencer Playing 🎵");
            } else {
                btnSeqToggle.textContent = 'Play Loop ▶';
                btnSeqToggle.style.background = 'var(--sp-green)';
                clearInterval(seqInterval);
                document.querySelectorAll('.seq-step-pad').forEach(p => p.classList.remove('current'));
            }
        });
    }

    if (btnSeqClear) {
        btnSeqClear.addEventListener('click', () => {
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < totalSteps; c++) {
                    seqGridData[r][c] = false;
                }
            }
            renderSequencer();
            showToast("Sequencer Cleared");
        });
    }

    renderSequencer();

    // -------------------------------------------------------------
    // 10. Navigation & Section Switching
    // -------------------------------------------------------------
    document.getElementById('navHome').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navHome'); showSection('search'); renderSongsGrid(defaultFeaturedTracks); setChipActive('chipAll'); });
    document.getElementById('navSearch').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navSearch'); showSection('search'); ytSearchInput.focus(); setChipActive('chipAll'); });
    document.getElementById('navHistory').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navHistory'); showSection('history'); renderHistoryGrid(); setChipActive('chipHistory'); });
    document.getElementById('navLibrary').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navLibrary'); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); setChipActive('chipLiked'); });
    document.getElementById('navLyrics').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navLyrics'); showSection('lyrics'); });
    document.getElementById('navEqualizer').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navEqualizer'); showSection('equalizer'); });
    document.getElementById('navSynth').addEventListener('click', (e) => { e.preventDefault(); setActiveNav('navSynth'); showSection('synth'); });

    // Mobile Navigation Events
    const mNavHome = document.getElementById('mNavHome');
    const mNavSearch = document.getElementById('mNavSearch');
    const mNavLibrary = document.getElementById('mNavLibrary');
    const mNavLyrics = document.getElementById('mNavLyrics');

    if (mNavHome) mNavHome.addEventListener('click', (e) => { e.preventDefault(); setMobileNavActive(mNavHome); showSection('search'); renderSongsGrid(defaultFeaturedTracks); setChipActive('chipAll'); });
    if (mNavSearch) mNavSearch.addEventListener('click', (e) => { e.preventDefault(); setMobileNavActive(mNavSearch); showSection('search'); ytSearchInput.focus(); setChipActive('chipAll'); });
    if (mNavLibrary) mNavLibrary.addEventListener('click', (e) => { e.preventDefault(); setMobileNavActive(mNavLibrary); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); setChipActive('chipLiked'); });
    if (mNavLyrics) mNavLyrics.addEventListener('click', (e) => { e.preventDefault(); setMobileNavActive(mNavLyrics); showSection('lyrics'); });

    function setMobileNavActive(element) {
        document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
        if (element) element.classList.add('active');
    }

    document.getElementById('plLiked').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plLiked')); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); setChipActive('chipLiked'); });
    document.getElementById('plHistory').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plHistory')); showSection('history'); renderHistoryGrid(); setChipActive('chipHistory'); });
    document.getElementById('plTrending').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plTrending')); showSection('search'); searchYouTube('trending music songs 2026'); setChipActive('chipYouTube'); });
    document.getElementById('plSynth').addEventListener('click', () => { setActivePlaylistItem(document.getElementById('plSynth')); showSection('synth'); });

    function setActiveNav(id) {
        document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    function setActivePlaylistItem(item) {
        document.querySelectorAll('.pl-item').forEach(li => li.classList.remove('active'));
        if (item) item.classList.add('active');
    }

    function setChipActive(chipId) {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        const chip = document.getElementById(chipId);
        if (chip) chip.classList.add('active');
    }

    btnToggleVisView.addEventListener('click', () => {
        if (sectionVisualizer.classList.contains('hidden')) {
            showSection('visualizer');
            btnToggleVisView.classList.add('active');
            setChipActive('chipVisualizer');
        } else {
            showSection('search');
            btnToggleVisView.classList.remove('active');
            setChipActive('chipAll');
        }
    });

    function showSection(section) {
        sectionSearchResults.classList.add('hidden');
        sectionArtistProfile.classList.add('hidden');
        sectionLyrics.classList.add('hidden');
        sectionEqualizer.classList.add('hidden');
        sectionVisualizer.classList.add('hidden');
        sectionSynthEngine.classList.add('hidden');
        sectionHistory.classList.add('hidden');

        if (section === 'artist') sectionArtistProfile.classList.remove('hidden');
        else if (section === 'lyrics') sectionLyrics.classList.remove('hidden');
        else if (section === 'equalizer') sectionEqualizer.classList.remove('hidden');
        else if (section === 'visualizer') sectionVisualizer.classList.remove('hidden');
        else if (section === 'synth') sectionSynthEngine.classList.remove('hidden');
        else if (section === 'history') sectionHistory.classList.remove('hidden');
        else sectionSearchResults.classList.remove('hidden');

        // Scroll back to top smoothly when switching sections
        const contentScroll = document.querySelector('.content-scrollable');
        if (contentScroll) contentScroll.scrollTop = 0;
    }

    // Filter Chips
    document.getElementById('chipAll').addEventListener('click', () => { setChipActive('chipAll'); showSection('search'); currentTrackList = [...defaultFeaturedTracks]; renderSongsGrid(currentTrackList); });
    document.getElementById('chipHistory').addEventListener('click', () => { setChipActive('chipHistory'); showSection('history'); renderHistoryGrid(); });
    document.getElementById('chipYouTube').addEventListener('click', () => { setChipActive('chipYouTube'); showSection('search'); searchYouTube('trending music songs 2026'); });
    document.getElementById('chipArtist').addEventListener('click', () => { setChipActive('chipArtist'); openArtistProfile(currentPlayingTrack.uploader, currentPlayingTrack.thumbnail); });
    document.getElementById('chipLiked').addEventListener('click', () => { setChipActive('chipLiked'); showSection('search'); searchHeading.textContent = "Your Liked Songs Library"; currentTrackList = [...likedSongs]; renderSongsGrid(currentTrackList); });
    document.getElementById('chipVisualizer').addEventListener('click', () => { setChipActive('chipVisualizer'); showSection('visualizer'); });

    // Init
    renderSongsGrid(defaultFeaturedTracks);
    drawSpotifyVisualizer();
});
