/**
 * @id         stermio-enhanced-series-shuffle
 * @name       Stremio Enhanced Series Shuffle
 * @version    5.4.0
 * @description Series-page Shuffle Watched/All + Player icon + real shuffled autoplay (no Up-Next DOM changes).
 */

(() => {
  const DEBUG = false;
  const BAR_ID   = 'series-shuffle-bar';
  const BTN_W_ID = 'series-shuffle-watched';
  const BTN_A_ID = 'series-shuffle-all';

  const ICON_BAR_CLASS = '.control-bar-buttons-menu-container-M6L0_';
  const PLAYER_ICON_ID = 'series-shuffle-player-icon';

  const STORAGE_KEY = 'series-shuffle-session';   // { seriesId, variant, pool{seriesId,list[]}, last, plannedNext, exp }
  const MODE_TTL_MS = 6 * 60 * 60 * 1000;

  const log = (...a) => DEBUG && console.log('[SeriesShuffle]', ...a);
  const onSeriesPage = () => /#\/detail\/series\//.test(location.hash);
  const onPlayerPage = () => /#\/player\//.test(location.hash);

  // ---------- eval bridge ----------
  function _eval(js) {
    return new Promise((resolve) => {
      const event = 'series-shuffle-eval';
      const script = document.createElement('script');
      window.addEventListener(event, (e) => { script.remove(); resolve(e.detail); }, { once:true });
      script.textContent = `
        (async () => {
          try {
            const r = ${js};
            const d = r instanceof Promise ? await r : r;
            window.dispatchEvent(new CustomEvent('${event}', { detail: d }));
          } catch (err) {
            console.error('[SeriesShuffle Eval Error]', err);
            window.dispatchEvent(new CustomEvent('${event}', { detail: null }));
          }
        })();
      `;
      document.head.appendChild(script);
    });
  }
  const getMetaDetails = () => _eval(`(window.services?.core?.transport?.getState?.('meta_details'))`);
  const getPlayerState = () => _eval(`(window.services?.core?.transport?.getState?.('player'))`);

  // ---------- session ----------
  const readSession  = () => { try{ const r=sessionStorage.getItem(STORAGE_KEY); if(!r) return null; const o=JSON.parse(r); if(!o||o.exp<Date.now()) {sessionStorage.removeItem(STORAGE_KEY); return null;} return o; }catch{ return null; } };
  const writeSession = (d) => { const n={...d,exp:Date.now()+MODE_TTL_MS}; sessionStorage.setItem(STORAGE_KEY, JSON.stringify(n)); return n; };
  const updateSession= (p) => writeSession({ ...(readSession()||{}), ...p });
  const clearSession = () => sessionStorage.removeItem(STORAGE_KEY);

  // ---------- utils ----------
  function toast(msg){
    let el=document.getElementById('series-shuffle-toast');
    if(!el){
      el=document.createElement('div');
      el.id='series-shuffle-toast';
      Object.assign(el.style,{position:'fixed',top:'72px',left:'50%',transform:'translateX(-50%)',padding:'10px 14px',background:'rgba(20,20,20,.92)',color:'#fff',borderRadius:'10px',zIndex:10000,fontWeight:'600',opacity:'0',transition:'opacity .18s'});
      document.body.appendChild(el);
    }
    el.textContent=msg; void el.offsetHeight; el.style.opacity='1';
    setTimeout(()=>{el.style.opacity='0'; setTimeout(()=>el.remove(),220);},1500);
  }

  function seriesIdFromHash(){
    const m = location.hash.match(/#\/detail\/series\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function pickBestSeries(obj, hashId){
    let best=null;
    function score(c){ let s=0; if(Array.isArray(c.videos)) s+=c.videos.length; if(c.id&&hashId&&c.id===hashId) s+=10000; if(c.type==='series') s+=50; return s; }
    function consider(node, fallbackId){
      const cand={ id: node.id||node.imdb_id||fallbackId||null, videos: node.videos, type: node.type };
      const sc=score(cand); if(!best||sc>best._score) best={...cand,_score:sc};
    }
    (function visit(n,parentId=null){
      if(!n||typeof n!=='object') return;
      if(Array.isArray(n.videos)&&n.videos.length) consider(n,parentId);
      if(n.content && typeof n.content==='object' && Array.isArray(n.content.videos)){
        consider({ ...n.content, id:n.content.id||n.id }, n.id||parentId);
      }
      for(const k in n){ const v=n[k]; if(v&&typeof v==='object') visit(v,n.id||parentId); }
    })(obj,null);
    if(best) delete best._score; return best;
  }

  function makePool(seriesId, videos, watchedOnly=false){
    const list=(Array.isArray(videos)?videos:[]).map(v=>({
      id:String(v.id || `${v.season}:${v.episode}`),
      season:v.season, episode:v.episode,
      watched: !!(v.watched || v.progress===1 || v.state?.watched===true),
      name:v.name||''
    })).filter(x=>x.id && (!watchedOnly || x.watched));
    return { seriesId, list };
  }

  async function robustEpisodePool(currentSeriesId, watchedOnly=false){
    // 1) player state
    try {
      const ps=await getPlayerState();
      const meta=ps?.metaItem?.content||{};
      const vids=Array.isArray(meta?.videos)?meta.videos:[];
      const sid = meta?.id || currentSeriesId;
      if(sid && vids.length) return makePool(sid, vids, watchedOnly);
    } catch {}
    // 2) meta_details
    try {
      const md = await getMetaDetails();
      const best = pickBestSeries(md||{}, currentSeriesId);
      if(best?.id && Array.isArray(best.videos) && best.videos.length) {
        return makePool(best.id, best.videos, watchedOnly);
      }
    } catch {}
    // 3) Cinemeta (imdb fallback if tmdb)
    try {
      const ps=await getPlayerState();
      const meta=ps?.metaItem?.content||{};
      let id= meta?.id || currentSeriesId;
      if(/^tmdb:/i.test(id)) id = meta?.imdb_id || meta?.imdbId || id;
      const r = await fetch(`https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(id)}.json`);
      if(r.ok){
        const j=await r.json();
        const vids=Array.isArray(j?.meta?.videos)?j.meta.videos:[];
        if(vids.length) return makePool(id, vids, watchedOnly);
      }
    } catch {}
    return makePool(currentSeriesId, [], watchedOnly);
  }

  async function readSeriesFromMetaDetails(){
    const state = await getMetaDetails();
    const hashId = seriesIdFromHash();
    const best = pickBestSeries(state||{}, hashId);
    if(!best?.id) return { seriesId: hashId || null, videos: [] };
    return { seriesId: best.id, videos: Array.isArray(best.videos) ? best.videos : [] };
  }

  // ---------- navigation helpers ----------
  function findSourcesPanel(){
    const nodes = document.querySelectorAll('*');
    for(const el of nodes){
      const r = el.getBoundingClientRect?.(); if(!r) continue;
      if(r.left < window.innerWidth*0.5 || r.height <= 120) continue;
      const links = el.querySelectorAll?.('a[href*="#/player/"]');
      if(links && links.length) return el;
    }
    return null;
  }
  function clickWatch(timeoutMs=12000){
    const t0=Date.now();
    const tick=()=>{
      const panel=findSourcesPanel();
      if(panel){
        const link=panel.querySelector('a[href*="#/player/"]');
        if(link){ link.click(); return; }
        const btn=[...panel.querySelectorAll('button,[role="button"],a')].find(b=>/^(watch|play|resume)$/i.test((b.textContent||'').trim()));
        if(btn){ btn.click(); return; }
      }
      if(Date.now()-t0<timeoutMs) setTimeout(tick,250);
    };
    tick();
  }
  async function forceHash(h){
    return new Promise(res=>{
      const on=()=>{window.removeEventListener('hashchange',on);res();};
      window.addEventListener('hashchange',on,{once:true});
      if(location.hash===h){ location.hash='#/__ss_bounce__'; setTimeout(()=>location.hash=h,0); }
      else location.hash=h;
    });
  }
  async function goToEpisode(seriesId, episodeId){
    const base   = `#/detail/series/${encodeURIComponent(seriesId)}`;
    const target = `${base}/${encodeURIComponent(episodeId)}`;
    if(!location.hash.startsWith(base)) await forceHash(base);
    await forceHash(target);
    setTimeout(()=>clickWatch(12000), 300);
  }

  // ---------- series-page pills ----------
  function stylePill(btn){
    Object.assign(btn.style,{
      display:'inline-flex',alignItems:'center',padding:'10px 14px',
      border:'none',borderRadius:'9999px',background:'rgba(255,255,255,0.12)',
      color:'#fff',fontSize:'14px',fontWeight:'600',cursor:'pointer',
      backdropFilter:'blur(4px)',boxShadow:'0 4px 12px rgba(0,0,0,0.35)'
    });
    btn.onmouseenter=()=>btn.style.background='rgba(255,255,255,0.22)';
    btn.onmouseleave=()=>btn.style.background='rgba(255,255,255,0.12)';
  }
  async function startShuffle(watchedOnly){
    const { seriesId, videos } = await readSeriesFromMetaDetails();
    if(!seriesId) return toast('Couldn’t load series');
    const pool = makePool(seriesId, videos, watchedOnly);
    if(!pool.list.length) return toast(watchedOnly?'No watched episodes':'No episodes found');
    writeSession({ seriesId, variant: watchedOnly?'watched':'all', pool, last:null, plannedNext:null });
    const pick = pool.list[Math.floor(Math.random()*pool.list.length)];
    await goToEpisode(seriesId, pick.id);
    toast('Shuffle started');
  }
  function renderSeriesButtons(){
    let bar=document.getElementById(BAR_ID);
    if(!onSeriesPage()){ if(bar) bar.remove(); return; }
    if(!bar){
      bar=document.createElement('div'); bar.id=BAR_ID;
      Object.assign(bar.style,{position:'fixed',top:'20px',right:'26px',zIndex:9999,display:'flex',gap:'8px',flexWrap:'wrap'});
      document.body.appendChild(bar);
    }
    if(!document.getElementById(BTN_W_ID)){
      const b=document.createElement('button'); b.id=BTN_W_ID; b.textContent='Shuffle Watched'; stylePill(b);
      b.onclick=(e)=>{e.preventDefault();e.stopPropagation(); startShuffle(true);};
      bar.appendChild(b);
    }
    if(!document.getElementById(BTN_A_ID)){
      const b=document.createElement('button'); b.id=BTN_A_ID; b.textContent='Shuffle All'; stylePill(b);
      b.onclick=(e)=>{e.preventDefault();e.stopPropagation(); startShuffle(false);};
      bar.appendChild(b);
    }
  }

  // ---------- player icon & autoplay ----------
  let onceVideoHooked=false, armedForThisVideo=false;

  function paintIcon(btn,on){
    btn.style.filter='none';
    btn.style.background = on ? 'rgba(255,255,255,0.22)' : 'transparent';
    btn.setAttribute('aria-pressed', on?'true':'false');
  }
  function buildPlayerIcon(){
    const btn=document.createElement('button');
    btn.id=PLAYER_ICON_ID;
    // match SkipIntro’s styling: small button with padding only, let flex center it
    Object.assign(btn.style,{
      padding:'6px', border:'none', borderRadius:'4px', cursor:'pointer',
      background:'transparent'
    });
    const img=document.createElement('img');
    Object.assign(img,{ width:30, height:30, alt:'Shuffle icon' });
    img.style.filter='brightness(0) invert(1)';
    img.style.pointerEvents='none';
    img.src = "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='16 3 21 3 21 8'></polyline><line x1='4' y1='20' x2='21' y2='3'></line><polyline points='16 16 21 16 21 21'></polyline><line x1='4' y1='4' x2='11' y2='11'></line></svg>`
    );
    btn.appendChild(img);
    btn.onmouseenter=()=>btn.style.background='rgba(255,255,255,0.12)';
    btn.onmouseleave=()=>btn.style.background = (readSession()? 'rgba(255,255,255,0.22)' : 'transparent');
    return btn;
  }

  async function ensurePlayerIcon(){
    if(!onPlayerPage()){ const old=document.getElementById(PLAYER_ICON_ID); if(old) old.remove(); return; }
    const bar=document.querySelector(ICON_BAR_CLASS);
    if(!bar) return;

    let icon=document.getElementById(PLAYER_ICON_ID);
    if(!icon){
      icon=buildPlayerIcon();

      icon.onclick=async (e)=>{
        e.preventDefault(); e.stopPropagation();
        const ps=await getPlayerState();
        const meta=ps?.metaItem?.content||{};
        const currentSeries=meta?.id || null;

        const sess = readSession();
        if(sess && sess.seriesId===currentSeries){
          clearSession(); toast('Shuffle Next disabled'); paintIcon(icon,false); return;
        }

        const pool = await robustEpisodePool(currentSeries,false);
        if(!pool.seriesId || !pool.list.length){ toast('No episodes to shuffle'); return; }
        writeSession({ seriesId: pool.seriesId, variant:'all', pool, last:null, plannedNext:null });
        toast('Shuffle Next enabled'); paintIcon(icon,true);
      };

      // mimic SkipIntro: put our button at the **start** of the bar
      bar.prepend(icon);
    }
    paintIcon(icon, !!readSession());
  }

  function chooseNextFromPool(seriesId, epId, pool){
    if(!pool || pool.seriesId!==seriesId || !pool.list.length) return null;
    const avoid=String(epId||'');
    const list= pool.list.length>1 ? pool.list.filter(x=>x.id!==avoid) : pool.list;
    if(!list.length) return null;
    return list[Math.floor(Math.random()*list.length)];
  }

  async function planNextIfNeeded(){
    const sess=readSession(); if(!sess) return null;
    const ps=await getPlayerState();
    const meta=ps?.metaItem?.content||{};
    const seriesId=meta?.id || sess.seriesId;

    // figure current ep id
    let currentEpId=null;
    if(ps?.seriesInfo?.episode!=null) currentEpId=`${seriesId}:${ps.seriesInfo.episode}`;
    else {
      const tail=(location.hash.split('/').pop()||'');
      if(/\d+:\d+/.test(tail)) currentEpId=`${seriesId}:${tail.split(':').pop()}`;
    }

    let pool=(sess.pool && sess.pool.seriesId===seriesId && sess.pool.list.length)
      ? sess.pool
      : await robustEpisodePool(seriesId,false);

    if(!pool.list.length) return null;
    updateSession({ pool });

    const pick=chooseNextFromPool(seriesId,currentEpId,pool);
    if(!pick) return null;

    updateSession({ plannedNext: { id:pick.id, season:pick.season, episode:pick.episode, name:pick.name||'' } });
    return { seriesId, pick };
  }

  async function gotoPlannedNext(forceFresh=false){
    let sess=readSession(); if(!sess) return;
    const ps=await getPlayerState();
    const seriesId=ps?.metaItem?.content?.id || sess.seriesId;

    if(!sess.plannedNext && forceFresh){
      await planNextIfNeeded(); sess=readSession();
    }
    const target=sess.plannedNext; if(!target) return;
    updateSession({ last:target.id, plannedNext:null });
    await goToEpisode(seriesId, target.id);
  }

  async function hookVideoOnce(){
    if(!onPlayerPage()){ onceVideoHooked=false; return; }
    const video=document.querySelector('video');
    if(!video || onceVideoHooked) return;
    onceVideoHooked=true; armedForThisVideo=false;

    video.addEventListener('timeupdate', async ()=>{
      if(!readSession()) return;
      const remaining=(video.duration||0)-(video.currentTime||0);
      if(remaining<12 && !armedForThisVideo){
        const planned=await planNextIfNeeded();
        if(planned) armedForThisVideo=true;
      }
      if(remaining<0.8 && armedForThisVideo){
        armedForThisVideo=false;
        await gotoPlannedNext(true);
      }
    });
    video.addEventListener('ended', async ()=>{
      if(!readSession()) return;
      await gotoPlannedNext(true);
    });
  }

  // ---------- tick ----------
  function tick(){
    renderSeriesButtons();
    ensurePlayerIcon();
    hookVideoOnce();
  }
  setInterval(tick, 600);
  window.addEventListener('hashchange', ()=>setTimeout(tick,120));
  document.addEventListener('visibilitychange', tick);
  const mo=new MutationObserver(()=>tick());
  mo.observe(document.body,{childList:true,subtree:true});
  setTimeout(tick, 250);
})();
