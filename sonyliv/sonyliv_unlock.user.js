// ==UserScript==
// @name         Sonyliv
// @version      2024-07-27
// @description  Watch Sonyliv videos even when logged out
// @author       You
// @match        https://www.sonyliv.com/privacy-policy
// @grant        none
// @run-at       document-body
// ==/UserScript==

// TODOs:
// - [] get .mpd streams to work correctly (see notes in loadPlugin section)
// - [] test loading Show ID (`getShowDetail` function)

(function() {
    'use strict';

    // can also run this manually on tos page
    // https://www.sonyliv.com/terms-of-use

    const HOME_PAGE = 'https://www.sonyliv.com';
    const VIDEO_API_BASE = 'https://apiv2.sonyliv.com/AGL/3.8/A/ENG/WEB/IN/TG/CONTENT/VIDEOURL/VOD';
    const DETAILS_API_BASE = 'https://apiv2.sonyliv.com/AGL/3.5/A/ENG/WEB/IN/TG/DETAIL-V2';

    function executeInWebWorker(code) {
        return new Promise((resolve, reject) => {
            const workerCode = `
                self.onmessage = function(event) {
                    const code = event.data;
                    try {
                        const result = eval(code);
                        self.postMessage({ success: true, result });
                    } catch (error) {
                        self.postMessage({ success: false, error });
                    }
                };
            `;
            const url = URL.createObjectURL(new Blob([ workerCode ], { type: 'application/javascript' }));
            const worker = new Worker(url);
            worker.onmessage = function(event) {
                if (event.data.success) {
                    resolve(event.data.result);
                } else {
                    reject(event.data.error);
                }
                // cleanup
                worker.terminate();
                URL.revokeObjectURL(url);
            };
            worker.onerror = function(error) {
                reject(error);
                worker.terminate();
                URL.revokeObjectURL(url);
            };

            worker.postMessage(code);
        });
    }

    async function getHomeInitialState() {
        const r = await fetch(HOME_PAGE);
        const homeHtml = await r.text();
        const pattern = new RegExp('(?<js>window\.INITIAL_STATE=.*?)<\/script>');
        const m = homeHtml.match(pattern);
        if (!m) {
            throw "unable to find INITIAL_STATE script tag in homepage";
        }
        let code = m.groups.js;
        const initialState = await executeInWebWorker(`var window = {};  ${code} ; window.INITIAL_STATE`);
        return initialState;
    }

    function parseShows(initialState){
        // tries to parse shows information stored in homepage's INITITAL_STATE.landingpage
        const lp = initialState.landingpagedata.resultObj;
        const out = new Map();
        for (let container of lp.containers) {
            if (container.assets && container.assets.containers && container.assets.containers.length > 0) {
                for (let asset of container.assets.containers) {
                    if (asset.metadata && asset.id == asset.metadata.contentId) {
                        out.set(asset.id, {
                            ID: asset.id,
                            type: asset.metadata.contentSubtype,
                            title: asset.metadata.title,
                            subtitle: asset.metadata.episodeTitle,
                            thumbnail: asset.metadata.emfAttributes && asset.metadata.emfAttributes.thumbnail,
                        });
                    }
                }
            }
        }
        return [ ...out.values() ];
    }

    window.API_CALLS = [];
    window.API_TOKEN = null;
    function postAPIWithToken(url) {
        window.API_CALLS.push(url);

        // might not be available sometimes as I run at document-body
        // const token = window.INITIAL_STATE.securityToken.resultObj;

        const token = window.API_TOKEN;

        return fetch(url, {
            headers: {
                security_token: token,
            },
            method: "POST",
        });
    }

    async function getShowVideoURL(showID) {
        // try to get show details
        // including videoURL
        let r = await postAPIWithToken(`${VIDEO_API_BASE}/${showID}/freepreview`);
        if (!r.ok) {
            r = await postAPIWithToken(`${VIDEO_API_BASE}/${showID}`);
        }
        const j = await r.json();
        let videoURL;
        if (r.ok && j && j.resultObj) {
            videoURL = j.resultObj.videoURL;
        }
        return {
            success: r.ok,
            code: r.status,
            details: j,
            videoURL
        };
    }

    async function getShowDetail(showID) {
        const r = await postAPIWithToken(`${DETAILS_API_BASE}/${showID}`);
        try {
            const j = r.json();
            for (let c of j.resultObj.containers) {
                if (c.id == showID) {
                    return {
                        success: true,
                        result: {
                            ID: showID,
                            title: c.metadata.title,
                            subtitle: c.metadata.episodeTitle,
                            thumbnail: c.metadata.emfAttributes && c.metadata.emfAttributes.thumbnail,
                        },
                    }
                }
            } 
        } catch (err) {
            console.error(`unable to detais for show ${showID}: err = `, err);
        }
        return {
            success: false,
        };
    }

    async function loadScript(scriptUrl) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.onload = function () {
                resolve(true);    
            };
            script.onerror = function (err) {
                reject(err);
            };
            script.setAttribute('src', scriptUrl);
            document.head.appendChild(script);
        });
    }

    function initUI(initialShows) {
        const { html, render, useState, useEffect } = window.htmPreact;

        const favShowTypes = [ "LIVE_SPORT", "HIGHLIGHTS", "SPORTS_CLIPS" ];

        function ShowTypeSelector({ showByTypes, selectedType, handleTypeInput }) {
            const m = new Map(showByTypes);
            let showTypes = [{
                type: 'ALL',
                count: m.get('ALL').length,
            }];
            m.delete('ALL');

            // show favorite types first
            for (let fav of favShowTypes) {
                if (m.has(fav)) {
                    showTypes.push({
                        type: fav,
                        count: m.get(fav).length,
                    });
                    m.delete(fav);
                }
            }

            // sort remaining in descending order of count
            const l = [ ...m.entries() ].map(([ type, arr ]) => ({ type, count: arr.length }));
            l.sort((a, b) => (b.count - a.count));
            showTypes = showTypes.concat(l);


            return html`<label>
                Show Type: <select
                    value=${selectedType}
                    onChange=${e => handleTypeInput(e.target.value)}
                >
                    ${showTypes.map(({ type, count }) => html`<option value=${type}>${type} (${count})</option>`)}
                </select>
            </label>`;
        }

        function ShowUI({ show, urlDetails, shouldDisplayShowType, handleReloadUrl }) {
            const [ playerLoaded, setPlayerLoaded ] = useState(false);
            const [ isShowingDetails, setIsShowingDetails ] = useState(true);

            const playerContainerID = `player-${show.ID}`;
            const url = !urlDetails.loading && urlDetails.r && urlDetails.r.success && urlDetails.r.videoURL;
            const details = {
                ID: show.ID,
                videoURL: url,
            }
            if (url) {
                // try and parse token from url;
                const rawToken = (new URL(url)).searchParams.get("hdnea");
                if (rawToken) {
                    const token = {};
                    for (let part of rawToken.split("~")) {
                        for (let [key, value] of (new URLSearchParams(part)).entries()) {
                            token[key] = value;
                        }
                    }
                    if (token.exp) {
                        const exp = new Date(parseInt(token.exp) * 1000);
                        token.expStr = exp.toString();
                    }
                    details.token = token;
                }
            };

            const loadPlayer = () => {
                if (!url) {
                    alert(`Video Not Found for ${show.ID}`);
                    return;
                }

                let player;
                if (window.VID_PLAYERS.has(show.ID)) {
                    const p = window.VID_PLAYERS.get(show.ID);
                    if (p.url !== url) {
                        p.player.destroy();
                        window.VID_PLAYERS.delete(show.ID);
                    } else {
                        player = p.player;
                    }
                }
                if (!player) {
                    const clapprConfig = {
                        source: urlDetails.r.videoURL,
                        poster: show.thumbnail,
                        plugins: [ window.DashShakaPlayback ],
                        parent: document.getElementById(playerContainerID),
                        width: 700,
                    };
                    if (details.token && details.token.id) {
                        // as per my tests
                        // x-playback-session-id is required for mpd streams
                        // DashShakaPlayback does not use it
                        clapprConfig.hlsjsConfig = {
                            xhrSetup: (xhr) => {
                                xhr.setRequestHeader('x-playback-session-id', details.token.id);
                            }
                        };

                        // setting session id using shaka
                        // not sufficient to get the stream to work
                        // looking at the Sonyliv's player it calls
                        // https://wv.service.expressplay.com/hms/wv/rights/?ExpressPlayToken=<token>
                        // to do something - not sure exactly what - but most likely related to DRM
                        // this url is returned by VIDEO_API_BASE/<showID> (when logged in)
                        // in LA_Details key
                        clapprConfig.shakaOnBeforeLoad = function(player) {
                            player.getNetworkingEngine().registerRequestFilter(function(type, request) {
                                request.headers['x-playback-session-id'] = details.token.id;
                            });
                        };
                    }
                    player = new window.Clappr.Player(clapprConfig);
                    window.VID_PLAYERS.set(show.ID, {
                        url,
                        player,
                    });
                }
                player.play();
                setPlayerLoaded(true);
            }
            const removePlayer = () => {
                if (window.VID_PLAYERS.has(show.ID)) {
                    const { player } = window.VID_PLAYERS.get(show.ID); 
                    player.destroy();
                    window.VID_PLAYERS.delete(show.ID);
                }
                setPlayerLoaded(false);
            }

            return html`<div id=${show.ID}>
                ${ shouldDisplayShowType && html`<code>${show.type}</code>` }
                <h1>${show.title}</h1>
                ${ show.subtitle && html`<p>${show.subtitle}</p>` }
                <div id=${playerContainerID} style=${{ width: 700 }}>
                    ${
                        (urlDetails.loading || !playerLoaded) &&
                            html`<img src=${ show.thumbnail } style=${{ width: 700 }} />`
                    }
                </div>
                ${
                    urlDetails.loading && html`<div>Loading URL ...</div>`
                }
                ${ isShowingDetails && html`<code>
                    <pre style=${{
                        border: '1px solid',
                        padding: 10,
                    }}>
                        ${JSON.stringify(details, null, 2)}
                    </pre>
                </code>` }
                
                ${ url && html`<button onClick=${() => { playerLoaded ? removePlayer() : loadPlayer(); }}>${ playerLoaded ? "Remove Player" : "Load Player" }</button>` }
                <button onClick=${() => setIsShowingDetails(!isShowingDetails)}>${isShowingDetails ? "Hide Details" : "Show Details"}</button>
                <button onClick=${() => { removePlayer(); handleReloadUrl() }}>Reload URL</button>
                <hr />
            </div>`;
        }


        function App() {
            const [ shows, setShows ] = useState(initialShows);
            const [ includeNonURLShows, setIncludeNonURLShows ] = useState( shows.length <= 1 ? true: false );
            const [ showUrls, setShowUrls ] = useState(new Map(
                shows.map(show => [
                    show.ID,
                    {
                        loading: true,
                    }
                ])
            ));
            const [ selectedShowTypeInput, setSelectedShowTypeInput ] = useState(null);

            const loadShowVideoURL = (showID) => {
                getShowVideoURL(showID).then(r => {
                    setShowUrls(m => {
                        m.set(showID, {
                            loading: false,
                            r,
                        });
                        return new Map(m);
                    });
                });
            }
            useEffect(() => {
                for (let show of shows) {
                    loadShowVideoURL(show.ID);
                }
            }, [ shows ]);

            const handleShowIDSubmit = async (e) => {
                e.preventDefault();
                const form = e.target;
                const formData = new FormData(form);
                const showID = formData.get('showIDInput');
                const { success, show } = await getShowDetail(showID);
                if (!success) {
                    alert(`Invalid Show ID = ${showID}`);
                }
                setShows([ show ]);
            };


            const showByTypes = (() => {
                const types = new Map();
                const allShows = [];
                for (let show of shows) {
                    if (!includeNonURLShows) {
                        const urlDetails = showUrls.get(show.ID);
                        if (!urlDetails.loading) {
                            if (!urlDetails.r.success || !urlDetails.r.videoURL) {
                                // skip non-video
                                continue;
                            }
                        }
                    }
                    const l = types.get(show.type) || [];
                    l.push(show);
                    types.set(show.type, l);
                    allShows.push(show);
                }
                types.set("ALL", allShows);
                return types;
            })();
            const selectedShowType = (() => {
                if (selectedShowTypeInput && showByTypes.has(selectedShowTypeInput)) {
                    return selectedShowTypeInput;
                }
                for (let f of favShowTypes) {
                    if (showByTypes.has(f)) {
                        return f;
                    }
                }
                return "ALL";
            })();
            const filteredShows = showByTypes.get(selectedShowType);


            return html`<div style=${{
                padding: 10,
            }}>
                <style>
                ${`
                    body {
                        font-family: sans-serif;
                    }
                    code {
                        font-size: 0.8em;
                    }

                    pre {
                        max-width: 80%;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                    }
                `}
                </style>

                <div style=${{
                    border: '1px solid',
                    padding: 10,
                    margin: 5,
                }}>
                    <details>
                        <summary>Load by Show ID</summary>
                        <form onSubmit=${handleShowIDSubmit}>
                            <label>
                                Enter Show ID: <input name="showIDInput" />
                            </label>
                            <button type="submit">Load Show</button>
                            <p>Hint: If the url is <code>/live-sport/india-tour-of-sri-lanka-2024-1700000759/cricket-1st-t20i-27-jul-2024-1000283778?watch=true</code> then show ID is <code>1000283778</code></p>
                        </form>
                    </details>

                    <div><label>
                        Include Shows without url?
                        <input type="checkbox" checked=${includeNonURLShows} onChange=${e => setIncludeNonURLShows(e.target.checked)} disabled=${shows.length <= 1}/>
                    </label></div>
                    <div><${ShowTypeSelector} 
                        showByTypes=${showByTypes}
                        selectedType=${selectedShowType}
                        handleTypeInput=${setSelectedShowTypeInput}
                    /></div>
                </div>

                ${filteredShows.map(show => (html`<${ShowUI}
                    key=${show.ID}
                    show=${show}
                    urlDetails=${showUrls.get(show.ID)}
                    shouldDisplayShowType=${selectedShowType === 'ALL'}
                    handleReloadUrl=${() => {loadShowVideoURL(show.ID)}}
                />`))}
            </div>`;
        }

        window.VID_PLAYERS = new Map();
        render(html`<${App} />`, document.body);
    }

    function loadScripts() {
        return Promise.all([
            (async () => {
                // load Clappr Player
                await loadScript("https://cdn.jsdelivr.net/npm/clappr@latest/dist/clappr.min.js");

                // load plugin to play Dash (.mpd) streams
                await loadScript("https://cdn.jsdelivr.net/gh/clappr/dash-shaka-playback@latest/dist/dash-shaka-playback.js");
                
                // I also tried another plugin for dash - github.com/leandromoreira/clappr-dash-dashjs
                // with dash.js from https://www.npmjs.com/package/dashjs
                // couldn't get that working

                // even with shaka plugin .mpd streams don't work correctly
                // sonliv's player set x-playback-session-id header
                // I'm able to set that using shakaOnBeforeLoad config (see license server auth doc)
                // most likely it is an issue with License Server Auth / DRM
                //
                // For some .mpd streams I'm getting shaka error: Error code: dash_shaka_playback:6_6012
                //
                // I might want to comeback to this and get mpd streams to work. docs:
                // - License Server Auth doc: https://shaka-player-demo.appspot.com/docs/api/tutorial-license-server-auth.html
                // - DRM doc: https://shaka-player-demo.appspot.com/docs/api/tutorial-drm-config.html
                // - Shaka 6012 error: https://github.com/shaka-project/shaka-player/issues/513
                //
                // I can also try embedding Sonyliv's own player instead of Clappr
                // player url: https://player.sonyliv.com/assets/web/100/2.21.7/v2/sp-player-web.js?bust=3.5.76
            })(),


            // load preact and htm
            // - load separately
            // loadScript("https://unpkg.com/preact@latest/dist/preact.min.js"), 
            // loadScript("https://cdnjs.cloudflare.com/ajax/libs/preact/10.23.1/preact.min.js"), // https://cdnjs.com/libraries/preact
            // loadScript("https://cdnjs.cloudflare.com/ajax/libs/htm/3.1.1/htm.min.js"), // https://cdnjs.com/libraries/htm
            // - instead of loading preact and htm separately
            loadScript("https://unpkg.com/htm@3.1.1/preact/standalone.umd.js"),
        ]);
    }


    async function init() {
        // document.body.innerHTML = '';
        document.write("<html> <head></head> <body></body> </html>");
        document.title = 'Sonyliv Unlocked';

        const scriptsLoaded = loadScripts();

        const homeInitialState = await getHomeInitialState();
        let availableShows = parseShows(homeInitialState);

        window.API_TOKEN = homeInitialState.securityToken.resultObj;

        await scriptsLoaded;
        initUI(availableShows);
    }

    init();
})();
