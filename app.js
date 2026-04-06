// --- HACHA V15.1 | MOTOR DE JUEGO (app.js) ---

const AVATAR_LIST = ['🦊','🦁','🐷','🐸','🐵','🐲','🦄','👽','🤖','🐼','🐻','🐨','🐯','🐮','🐶'];
const PLAYER_COLORS = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const CAT_COLORS = { "Geografía": "#3b82f6", "Arte y Literatura": "#a16207", "Historia": "#eab308", "Entretenimiento": "#ec4899", "Ciencias y Naturaleza": "#22c55e", "Deportes": "#f97316" };
const CAT_CLASSES = { "Geografía": "cat-geo", "Arte y Literatura": "cat-art", "Historia": "cat-his", "Entretenimiento": "cat-ent", "Ciencias y Naturaleza": "cat-sci", "Deportes": "cat-spo" };

const AudioEngine = {
    ctx: null, init: function() { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    playTone: function(f, t, d, v=0.1) { if(!this.ctx) return; const o=this.ctx.createOscillator(); const g=this.ctx.createGain(); o.type=t; o.frequency.setValueAtTime(f, this.ctx.currentTime); g.gain.setValueAtTime(v, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.00001, this.ctx.currentTime+d); o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+d); },
    buzz: function() { this.playTone(150, 'sawtooth', 0.5, 0.3); }, correct: function() { this.playTone(600, 'sine', 0.1); setTimeout(()=>this.playTone(800, 'sine', 0.3), 100); }, wrong: function() { this.playTone(200, 'square', 0.4, 0.2); }, tick: function() { this.playTone(1000, 'sine', 0.05, 0.05); }, pop: function() { this.playTone(400, 'sine', 0.1, 0.05); }, win: function() { [400,600,800,1000].forEach((f,i)=>setTimeout(()=>this.playTone(f,'sine',0.3), i*150)); }
};

class HistoryManager {
    constructor() { this.key = 'hacha_used_qs'; this.used = JSON.parse(localStorage.getItem(this.key)) || []; }
    isUsed(qText) { return this.used.includes(qText); }
    markUsed(qText) { if(!this.isUsed(qText)) { this.used.push(qText); localStorage.setItem(this.key, JSON.stringify(this.used)); } }
    clearHistory() { this.used = []; localStorage.removeItem(this.key); }
}

class HachaEngine {
    constructor() {
        this.peer=null; this.connections={}; this.players={}; this.phase=0; this.selectedAvatar = null;
        this.history = new HistoryManager();
        this.r2Submissions = {}; this.r2Timer=45; this.r1Idx=0; this.r1Questions=[];
        this.r3Order = []; this.r3TurnIdx = 0;
        this.r4Finalists = []; this.r4TurnIdx = 0; this.r4CurrentCat = ""; this.r4Interval = null; this.r4WildcardActive = false;
        this.refereeTargetId = null;
        this.init();
    }

    async init() {
        try { const r=await fetch('preguntas.json'); this.db=await r.json(); document.getElementById('load-status').innerText="✅ Listo"; document.getElementById('btn-host-start').disabled=false; } catch(e){ document.getElementById('load-status').innerText="❌ Error DB"; }
        if(sessionStorage.getItem('hacha_state')) document.getElementById('btn-host-resume').style.display='block';
        const grid = document.getElementById('avatar-selector'); if(grid) grid.innerHTML = AVATAR_LIST.map(a => `<div class="avatar-item" onclick="app.selectAvatar(this, '${a}')">${a}</div>`).join('');
    }

    selectAvatar(el, a) { document.querySelectorAll('.avatar-item').forEach(i => i.classList.remove('selected')); el.classList.add('selected'); this.selectedAvatar = a; }
    hostGame() { AudioEngine.init(); this.roomCode = Math.random().toString(36).substring(2,6).toUpperCase(); this.setupHost(); }
    resumeGame() { const s = JSON.parse(sessionStorage.getItem('hacha_state')); this.roomCode=s.roomCode; this.players=s.players; this.phase=s.phase; this.r4Finalists=s.r4Finalists||[]; this.r3Order=s.r3Order||[]; this.setupHost(); }

    setupHost() {
        this.peer = new Peer(`hacha-room-${this.roomCode}`);
        this.peer.on('open', () => {
            document.getElementById('display-code').innerText = this.roomCode; this.show(this.phase === 0 ? 'screen-lobby' : 'screen-ranking');
            new QRCode(document.getElementById("qrcode"), { text: `${window.location.origin}${window.location.pathname}?code=${this.roomCode}`, width: 150, height: 150 });
            this.updateScoreboard(); this.updateLobbyList();
        });
        this.peer.on('connection', c => { c.on('data', d => this.handleHostData(c, d)); c.on('close', () => { this.sync(); }); this.connections[c.peer] = c; });
    }

    handleHostData(c, d) {
        if(d.type==='join') {
            let p = Object.values(this.players).find(x => x.name === d.name);
            if(p) {
                this.players[c.peer] = p; delete this.players[p.id]; p.id = c.peer;
                c.send({ type: 'joined_ok', avatar: p.avatar, color: p.color }); c.send({ type: 'scoreUpdate', score: p.score });
                if(this.phase > 0) c.send({ type: 'phase', phase: this.phase });
                if(this.phase === 4) this.broadcastR4State();
            } else {
                const col = PLAYER_COLORS[Object.keys(this.players).length % PLAYER_COLORS.length];
                this.players[c.peer] = { id: c.peer, name: d.name, avatar: d.avatar, color: col, score: 0, lives: 3, quesitos: [], eliminated: false, wildcards: 0 };
                c.send({ type: 'joined_ok', avatar: d.avatar, color: col });
            }
            this.updateLobbyList(); this.updateScoreboard(); this.sync();
        }
        if(d.type==='buzz') this.handleBuzz(c.peer);
        if(d.type==='reaction' && !this.r4WildcardActive) { AudioEngine.pop(); const el = document.createElement('div'); el.className = 'reaction-fly'; el.innerText = d.emoji; el.style.left = Math.random() * 80 + 10 + '%'; document.body.appendChild(el); setTimeout(() => el.remove(), 2500); }
        if(d.type==='r2_submit' && this.r2Timer > 0) this.r2Submissions[c.peer] = { val: d.val, time: this.r2Timer };
        
        if(d.type==='r4_wildcard_submit' && this.r4WildcardActive) {
            AudioEngine.pop(); const p = this.players[c.peer]; const ansDiv = document.getElementById('r4-wildcard-answers');
            ansDiv.innerHTML += `<div class="wildcard-answer">${p.avatar}: ${d.val}</div>`;
        }
    }

    sync() { sessionStorage.setItem('hacha_state', JSON.stringify({ roomCode: this.roomCode, players: this.players, phase: this.phase, r4Finalists: this.r4Finalists, r3Order: this.r3Order })); }
    show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); document.getElementById('live-scoreboard').style.display = (id.includes('game') || id.includes('ranking')) ? 'block' : 'none'; }
    broadcast(m) { Object.values(this.connections).forEach(c => c.send(m)); }

    getSafeQuestion(dMax, dMin=1, cat=null) {
        let p = this.db.filter(q => q.dif >= dMin && q.dif <= dMax && !this.history.isUsed(q.q));
        if(cat) p = p.filter(x => x.cat === cat);
        if(p.length === 0) { this.history.clearHistory(); p = this.db.filter(q => q.dif >= dMin && q.dif <= dMax); if(cat) p=p.filter(x=>x.cat===cat); }
        const q = p[Math.floor(Math.random()*p.length)]; this.history.markUsed(q.q); return q;
    }

    openReferee(id) { this.refereeTargetId = id; document.getElementById('ref-name').innerText = `${this.players[id].avatar} ${this.players[id].name}`; document.getElementById('referee-modal').style.display = 'flex'; }
    adjScore(v) { if(this.refereeTargetId) { this.players[this.refereeTargetId].score += v; this.updateScoreboard(); this.sync(); } }
    adjLife(v) { if(this.refereeTargetId) { const p=this.players[this.refereeTargetId]; p.lives+=v; p.eliminated=(p.lives<=0); if(this.phase===3) { this.updateR3LivesUI(); this.broadcastTurnR3(this.currentAnswererId); } this.updateScoreboard(); this.sync(); } }
    updateScoreboard() { const s=Object.values(this.players).sort((a,b)=>b.score-a.score); document.getElementById('score-list').innerHTML = s.map(p=>`<div class="score-row-host" onclick="app.openReferee('${p.id}')"><span>${p.avatar} ${p.name}</span><span style="color:var(--primary)">${p.score}</span></div>`).join(''); this.broadcast({type:'scoreUpdate'}); }
    updateLobbyList() { document.getElementById('players-list').innerHTML = Object.values(this.players).map(p=>`<span style="border:2px solid ${p.color}; padding:10px 15px; border-radius:20px; margin:5px; display:inline-block;">${p.avatar} ${p.name}</span>`).join(''); }

    // R1
    startRound1Intro() { this.phase=1; this.sync(); this.show('screen-r1-intro'); }
    startRound1() { this.r1Idx = 0; this.r1Questions=[]; for(let i=0;i<10;i++) this.r1Questions.push(this.getSafeQuestion(2)); this.broadcast({ type: 'phase', phase: 1 }); this.nextQuestion(); }
    nextQuestion() {
        if(this.r1Idx >= 10) { this.showRanking(); return; }
        const q = this.r1Questions[this.r1Idx]; this.r1Idx++;
        this.show('screen-r1-game'); document.getElementById('q-counter').innerText = `Q ${this.r1Idx}/10`;
        document.getElementById('r1-card-element').className = this.r1Idx >= 8 ? 'card fire-mode' : 'card';
        document.getElementById('q-text').innerText = q.q; document.getElementById('q-answer').innerText = q.a; document.getElementById('q-answer').classList.add('blur-mode');
        
        document.getElementById('r1-controls-reading').style.display = 'block'; 
        document.getElementById('r1-controls-judging').style.display = 'none'; 
        document.getElementById('r1-controls-next').style.display='none';
        
        this.buzzerLocked = true; this.broadcast({ type: 'status', msg: 'ESCUCHA...', locked: true });
    }
    startCountdown() { document.getElementById('r1-controls-reading').style.display='none'; let c=3; this.showOverlay(c); this.broadcast({type:'countdown', val:c}); AudioEngine.tick(); const t=setInterval(()=>{ c--; if(c>0){this.showOverlay(c); this.broadcast({type:'countdown', val:c}); AudioEngine.tick();} else {clearInterval(t); this.showOverlay("YA!"); this.broadcast({type:'countdown', val:"YA!"}); setTimeout(()=>{this.hideOverlay(); this.unlockBuzzers();}, 800); } }, 1000); }
    unlockBuzzers() { this.buzzerLocked=false; this.broadcast({type:'status', msg:'¡PULSA!', color:'red', locked:false}); if(this.r1Timeout) clearTimeout(this.r1Timeout); this.r1Timeout=setTimeout(()=>{ if(!this.buzzerLocked){ const ids=Object.keys(this.players); if(ids.length>0){ const v=ids[Math.floor(Math.random()*ids.length)]; this.showOverlay("¡TIEMPO!"); AudioEngine.wrong(); setTimeout(()=>{this.hideOverlay(); this.handleBuzz(v);}, 1500); } } }, 15000); }
    
    handleBuzz(id) { 
        if(this.buzzerLocked) return; this.buzzerLocked=true; this.currentAnswererId=id; if(this.r1Timeout) clearTimeout(this.r1Timeout); AudioEngine.buzz(); 
        
        document.getElementById('r1-controls-judging').style.display='block'; 
        document.getElementById('btn-reveal-judge').style.display='block';
        document.getElementById('judge-buttons').style.display='none';
        
        const p=this.players[id]; 
        document.getElementById('answering-name').innerHTML=`<span style="font-size:2rem">${p.avatar}</span> <span style="color:${p.color}">${p.name}</span>`; 
        Object.values(this.connections).forEach(c => { if(c.peer===id) c.send({type:'status', msg:'¡TU TURNO!', color:'orange', locked:true}); else c.send({type:'status', msg:`${p.name} RESPONDE`, color:'grey', locked:true}); }); 
    }
    
    confirmReveal() {
        document.getElementById('q-answer').classList.remove('blur-mode'); 
        document.getElementById('btn-reveal-judge').style.display='none'; 
        document.getElementById('judge-buttons').style.display='flex'; 
    }

    judge(ok) { const p=this.players[this.currentAnswererId]; const pts=(this.r1Idx>=8)?2:1; if(ok){p.score+=pts; AudioEngine.correct();} else {p.score-=pts; AudioEngine.wrong();} this.updateScoreboard(); this.sync(); this.finishQ(); }
    finishQ() { document.getElementById('q-answer').classList.remove('blur-mode'); document.getElementById('r1-controls-judging').style.display='none'; document.getElementById('r1-controls-next').style.display='block'; this.broadcast({type:'status', msg:'ESPERA...', locked:true}); }
    toggleAnswer() { document.getElementById('q-answer').classList.toggle('blur-mode'); }
    showRanking() { this.show('screen-ranking'); const s=Object.values(this.players).sort((a,b)=>b.score-a.score); document.getElementById('ranking-list').innerHTML = s.map((p,i)=>`<div style="background:rgba(0,0,0,0.4); padding:15px; border-radius:10px; margin-bottom:10px; display:flex; justify-content:space-between; font-size:1.4rem; border-left:5px solid ${p.color};"><span>${i+1}. ${p.avatar} ${p.name}</span><span style="color:var(--primary)">${p.score} PTS</span></div>`).join(''); }
    nextPhaseFromRanking() { if(this.phase===1){this.phase=2; this.sync(); this.show('screen-r2-intro');} else if(this.phase===2){this.startRound3Intro();} else if(this.phase===3){this.startRound4Intro();} }

    // R2
    startRound2() { this.subRound = 0; this.broadcast({ type: 'phase', phase: 2 }); this.setupSubRound(); }
    setupSubRound() { this.show('screen-r2-game'); this.r2Submissions = {}; this.r2Timer=45; document.getElementById('r2-controls-start').style.display='block'; document.getElementById('r2-controls-score').style.display='none'; const isM = (this.subRound % 2 === 0); document.getElementById('r2-title').innerText = isM ? "CÁLCULO" : "LÉXICO"; if(isM) { document.getElementById('math-target').style.display='block'; this.r2Target = Math.floor(Math.random()*900)+100; document.getElementById('math-target').innerText=this.r2Target; let t=[1,2,3,4,5,6,7,8,9,10,25,50,75,100].sort(()=>.5-Math.random()).slice(0,6); document.getElementById('tiles-container').innerHTML = t.map(x=>`<div class="tile">${x}</div>`).join(''); this.broadcast({type:'r2-data', text:`OBJ: ${this.r2Target}\nCIFRAS: ${t.join(' ')}`, isMath:true}); } else { document.getElementById('math-target').style.display='none'; const v="AAAAAEEEEEEIIIIOOOOUU".split('').sort(()=>.5-Math.random()); const c="BCDFGHLLLMNNPRRRSTV".split('').sort(()=>.5-Math.random()); let l=[...v.slice(0,4), ...c.slice(0,5)].sort(()=>.5-Math.random()); document.getElementById('tiles-container').innerHTML = l.map(x=>`<div class="tile letter">${x}</div>`).join(''); this.broadcast({type:'r2-data', text:`LETRAS:\n${l.join(' ')}`, isMath:false}); } }
    startR2Timer() { document.getElementById('r2-controls-start').style.display = 'none'; this.broadcast({ type: 'r2-unlock' }); this.r2Interval = setInterval(() => { this.r2Timer--; this.broadcast({ type: 'r2-timer', val: this.r2Timer }); document.getElementById('r2-timer').innerText = this.r2Timer; if(this.r2Timer <= 5 && this.r2Timer > 0) AudioEngine.tick(); if(this.r2Timer <= 0) { clearInterval(this.r2Interval); this.r2End(); } }, 1000); }
    r2End() { document.getElementById('r2-controls-score').style.display='block'; this.broadcast({type:'r2-lock'}); const isM=(this.subRound%2===0); let res = Object.keys(this.r2Submissions).map(id=>{ const s=this.r2Submissions[id]; const p=this.players[id]; let sc=0; let v=true; if(isM){const n=Number(s.val); if(isNaN(n)){sc=9999; v=false;} else sc=Math.abs(n-this.r2Target);} else {sc=String(s.val).trim().length;} return {id, name:p.name, avatar:p.avatar, color:p.color, val:s.val, score:sc, time:s.time, valid:v}; }); if(isM) res.sort((a,b)=>{if(a.score!==b.score)return a.score-b.score; return b.time-a.time;}); else res.sort((a,b)=>{if(a.score!==b.score)return b.score-a.score; return b.time-a.time;}); const tbody=document.getElementById('r2-results-body'); if(res.length===0) tbody.innerHTML=`<tr><td colspan="5">Nadie envió</td></tr>`; else tbody.innerHTML=res.map(r=>`<tr><td style="color:${r.color};">${r.avatar} ${r.name}</td><td>${r.val||'-'}</td><td>${isM?(r.valid?`Dif: ${r.score}`:'Inválido'):`${r.score} let.`}</td><td>${r.time}s</td><td><button class="btn green small" onclick="app.awardR2('${r.id}')">+2</button></td></tr>`).join(''); }
    awardR2(id) { if(this.players[id]){ this.players[id].score+=2; AudioEngine.correct(); confetti({origin:{y:0.8}}); } this.updateScoreboard(); this.sync(); this.nextSubRound(); }
    nextSubRound() { this.subRound++; this.sync(); if(this.subRound>=4) this.showRanking(); else this.setupSubRound(); }

    // R3
    startRound3Intro() { this.phase=3; this.sync(); this.show('screen-r3-intro'); }
    startRound3() { const s = Object.values(this.players).sort((a,b) => b.score - a.score); s.forEach((p, i) => { p.lives = Math.max(1, Math.min(5, s.length - i)); p.eliminated = false; }); this.r3Order = s.map(p => p.id); this.r3TurnIdx = 0; this.broadcast({ type: 'phase', phase: 3 }); this.sync(); this.nextR3Question(); }
    
    nextR3Question() { 
        const vivos = Object.values(this.players).filter(p => !p.eliminated); 
        if (vivos.length <= 2) { 
            // CORRECCIÓN V15.1: Solo preparamos finalistas pero NO saltamos a phase 4 aún
            this.r4Finalists = vivos.map(p => p.id); 
            this.sync(); 
            this.showRanking(); 
            return; 
        } 
        while(this.players[this.r3Order[this.r3TurnIdx]].eliminated) { this.r3TurnIdx = (this.r3TurnIdx + 1) % this.r3Order.length; } 
        const activeId = this.r3Order[this.r3TurnIdx]; this.currentAnswererId = activeId; const p = this.players[activeId]; const q = this.getSafeQuestion(3, 2); 
        this.show('screen-r3-game'); document.getElementById('r3-q-text').innerHTML = `<span style="color:#94a3b8;">Turno de ${p.avatar} ${p.name}</span><br>${q.q}`; document.getElementById('r3-q-answer').innerText = q.a; document.getElementById('r3-q-answer').classList.add('blur-mode'); document.getElementById('r3-controls-reading').style.display = 'block'; document.getElementById('r3-controls-judging').style.display = 'none'; this.updateR3LivesUI(); this.broadcastTurnR3(activeId); 
    }
    
    broadcastTurnR3(activeId) { Object.values(this.connections).forEach(c => { const p = this.players[c.peer]; c.send({ type: 'r3-update', myTurn: c.peer === activeId, lives: p.lives, eliminated: p.eliminated, msg: c.peer===activeId?"¡TU TURNO!":`Turno de ${this.players[activeId].name}` }); }); }
    toggleAnswerR3() { document.getElementById('r3-q-answer').classList.toggle('blur-mode'); }
    
    confirmRevealR3() { 
        this.buzzerLocked = false; 
        document.getElementById('r3-controls-reading').style.display='none'; 
        
        // RESPUESTA OCULTA, APARECE DESVELAR
        document.getElementById('r3-controls-judging').style.display='block'; 
        document.getElementById('btn-reveal-judge-r3').style.display='block';
        document.getElementById('r3-judge-buttons').style.display='none';
        
        this.connections[this.currentAnswererId].send({ type: 'status', msg: '¡RESPONDE!', color: 'red', locked: false }); 
    }

    showJudgeButtonsR3() {
        document.getElementById('r3-q-answer').classList.remove('blur-mode'); 
        document.getElementById('btn-reveal-judge-r3').style.display='none'; 
        document.getElementById('r3-judge-buttons').style.display='flex'; 
    }
    
    judgeR3(ok) { const p = this.players[this.currentAnswererId]; if(!ok){ p.lives--; AudioEngine.wrong(); if(p.lives<=0) p.eliminated=true; } else { AudioEngine.correct(); confetti({ origin: { y: 0.8 }, colors: ['#22c55e'] }); } this.r3TurnIdx = (this.r3TurnIdx + 1) % this.r3Order.length; this.updateR3LivesUI(); this.sync(); setTimeout(() => this.nextR3Question(), 1500); }
    updateR3LivesUI() { document.getElementById('r3-lives-display').innerHTML = this.r3Order.map(id => { const p=this.players[id]; return `<div class="player-life-card ${id===this.currentAnswererId?'active-turn':''} ${p.eliminated?'eliminated':''}" style="border-top:4px solid ${p.color};"><div style="font-weight:900; margin-bottom:5px;">${p.avatar} ${p.name}</div><div class="heart">${'❤️'.repeat(p.lives)}</div></div>`; }).join(''); }

    // R4
    startRound4Intro() { 
        this.phase = 4; // CORRECCIÓN V15.1: Declaramos la Fase 4 al entrar
        this.r4Finalists.forEach(id => { if(this.players[id]) this.players[id].wildcards = 1; }); 
        this.r4TurnIdx = 0; this.broadcast({ type: 'phase', phase: 4 }); this.sync(); this.show('screen-r4-intro'); 
    }
    startRound4() { this.show('screen-r4-game'); this.updateR4HostUI(); this.broadcastR4State(); }
    updateR4HostUI() { document.getElementById('r4-category-selection').style.display = 'block'; document.getElementById('r4-question-panel').style.display = 'none'; const p1 = this.players[this.r4Finalists[0]]; const p2 = this.players[this.r4Finalists[1]]; const activeId = this.r4Finalists[this.r4TurnIdx]; document.getElementById('r4-finalists-container').innerHTML = `<div class="finalist-card ${activeId===p1.id?'active-turn':''}" style="border-color:${p1.color};"><div style="font-size:1.8rem; font-weight:900; margin-bottom:15px;">${p1.avatar} ${p1.name} ${p1.wildcards>0?'🆘':''}</div><div class="quesito-container">${this.renderQuesitos(p1.quesitos)}</div></div><div class="finalist-card ${activeId===p2.id?'active-turn':''}" style="border-color:${p2.color};"><div style="font-size:1.8rem; font-weight:900; margin-bottom:15px;">${p2.avatar} ${p2.name} ${p2.wildcards>0?'🆘':''}</div><div class="quesito-container">${this.renderQuesitos(p2.quesitos)}</div></div>`; document.querySelectorAll('.btn-cat').forEach(btn => { btn.disabled = this.players[activeId].quesitos.includes(btn.innerText); }); }
    renderQuesitos(arr) { return Object.keys(CAT_COLORS).map(cat => { const c = arr.includes(cat) ? CAT_COLORS[cat] : '#1e293b'; return `<div class="quesito" style="background:${c};"></div>`; }).join(''); }
    
    generateR4Question(category) {
        this.r4CurrentCat = category; const q = this.getSafeQuestion(3, 2, category); this.r4WildcardActive = false; document.getElementById('r4-wildcard-answers').style.display = 'none'; document.getElementById('r4-wildcard-answers').innerHTML = ''; document.getElementById('r4-category-selection').style.display = 'none'; document.getElementById('r4-question-panel').style.display = 'block'; document.getElementById('r4-q-cat').className = `cat-badge ${CAT_CLASSES[category]}`; document.getElementById('r4-q-cat').innerText = category; document.getElementById('r4-q-text').innerText = q.q; document.getElementById('r4-q-answer').innerText = q.a; document.getElementById('r4-q-answer').classList.add('blur-mode'); document.getElementById('r4-timer-controls').style.display = 'flex'; document.getElementById('btn-r4-timer').style.display = 'block'; document.getElementById('r4-timer-display').style.display = 'none'; document.getElementById('r4-controls-judge').style.display = 'none'; document.getElementById('r4-controls-rebound').style.display = 'none'; 
    }

    startR4Timer() { 
        document.getElementById('btn-r4-timer').style.display = 'none'; 
        document.getElementById('r4-timer-display').style.display = 'block'; 
        
        // RESPUESTA OCULTA, APARECE DESVELAR EN R4
        document.getElementById('r4-controls-judge').style.display = 'block'; 
        document.getElementById('btn-r4-reveal').style.display = 'block';
        document.getElementById('r4-judge-buttons').style.display = 'none';
        
        const activePlayer = this.players[this.r4Finalists[this.r4TurnIdx]]; 
        if(activePlayer.wildcards > 0) document.getElementById('btn-r4-wildcard').style.display = 'block'; 
        
        document.getElementById('r4-timer-display').style.color = "var(--danger)"; 
        let t = 15; document.getElementById('r4-timer-display').innerText = t; 
        if(this.r4Interval) clearInterval(this.r4Interval); 
        this.r4Interval = setInterval(() => { t--; document.getElementById('r4-timer-display').innerText = t; if(t <= 5 && t > 0) AudioEngine.tick(); if(t <= 0) { clearInterval(this.r4Interval); document.getElementById('r4-timer-display').innerText = "TIEMPO"; AudioEngine.wrong(); } }, 1000); 
    }

    toggleAnswerR4() { 
        if(this.r4Interval) clearInterval(this.r4Interval); 
        this.r4WildcardActive = false; 
        this.broadcast({type:'r4-wildcard-end'}); 
        document.getElementById('r4-q-answer').classList.remove('blur-mode'); 
        document.getElementById('btn-r4-reveal').style.display = 'none'; 
        document.getElementById('r4-judge-buttons').style.display = 'flex'; 
        document.getElementById('btn-r4-wildcard').style.display = 'none'; 
    }

    useR4Wildcard() { const activePlayer = this.players[this.r4Finalists[this.r4TurnIdx]]; if(activePlayer.wildcards <= 0) return; activePlayer.wildcards = 0; this.r4WildcardActive = true; this.sync(); this.updateR4HostUI(); document.getElementById('btn-r4-wildcard').style.display = 'none'; document.getElementById('r4-wildcard-answers').style.display = 'flex'; if(this.r4Interval) clearInterval(this.r4Interval); AudioEngine.playTone(800, 'sine', 0.5, 0.2); let t = 25; document.getElementById('r4-timer-display').innerText = `🆘 ${t}`; document.getElementById('r4-timer-display').style.color = "var(--info)"; this.broadcastR4WildcardState(); this.r4Interval = setInterval(() => { t--; document.getElementById('r4-timer-display').innerText = `🆘 ${t}`; if(t === 10) this.broadcast({type:'r4-wildcard-end'}); if(t <= 5 && t > 0) AudioEngine.tick(); if(t <= 0) { clearInterval(this.r4Interval); this.r4WildcardActive = false; document.getElementById('r4-timer-display').innerText = "TIEMPO"; document.getElementById('r4-timer-display').style.color = "var(--danger)"; AudioEngine.wrong(); } }, 1000); }

    judgeR4(ok) {
        const activeId = this.r4Finalists[this.r4TurnIdx]; const p = this.players[activeId]; 
        if (ok) { p.quesitos.push(this.r4CurrentCat); AudioEngine.correct(); confetti({ origin: { y: 0.8 } }); if(p.quesitos.length >= 6) return this.triggerVictory(p.name, p.avatar); this.sync(); this.updateR4HostUI(); this.broadcastR4State(); } 
        else { AudioEngine.wrong(); document.getElementById('r4-controls-judge').style.display = 'none'; document.getElementById('r4-controls-rebound').style.display = 'block'; this.broadcastR4ReboundState(); } 
    }
    
    judgeR4Rebound(ok) { const inactiveIdx = (this.r4TurnIdx === 0) ? 1 : 0; const rivalId = this.r4Finalists[inactiveIdx]; const rival = this.players[rivalId]; if (ok) { AudioEngine.correct(); if(!rival.quesitos.includes(this.r4CurrentCat)) { rival.quesitos.push(this.r4CurrentCat); confetti({ origin: { y: 0.8 }, colors:['#ef4444', '#facc15'] }); if(rival.quesitos.length >= 6) return this.triggerVictory(rival.name, rival.avatar); } } else { AudioEngine.wrong(); } this.r4TurnIdx = inactiveIdx; this.sync(); this.updateR4HostUI(); this.broadcastR4State(); }
    triggerVictory(n, a) { AudioEngine.win(); document.getElementById('r4-question-panel').innerHTML = `<h1 style="color:var(--success); font-size:6rem; margin-top:50px;">¡CAMPEÓN ABSOLUTO!</h1><h2 style="font-size:6rem; color:white; text-shadow: 0 0 30px white;">${a} ${n}</h2>`; confetti({ particleCount: 300, spread: 160 }); this.broadcast({ type: 'r4-victory', winner: n, avatar: a }); }
    
    broadcastR4State() { const activeName = this.players[this.r4Finalists[this.r4TurnIdx]].name; Object.values(this.connections).forEach(c => { const p = this.players[c.peer]; const isFinalist = this.r4Finalists.includes(c.peer); const isMyTurn = c.peer === this.r4Finalists[this.r4TurnIdx]; let msg = ""; if(!isFinalist) msg = `SABOTEADOR. Turno de ${activeName}`; else if(isMyTurn) msg = `<span style="color:var(--success);">¡TU TURNO! (Elige categoría)</span>`; else msg = `Turno de ${activeName}.`; c.send({ type: 'r4-update', isFinalist: isFinalist, msg: msg, myQuesitos: p.quesitos || [] }); }); }
    broadcastR4ReboundState() { const inactiveIdx = (this.r4TurnIdx === 0) ? 1 : 0; const rivalId = this.r4Finalists[inactiveIdx]; Object.values(this.connections).forEach(c => { const p = this.players[c.peer]; const isFinalist = this.r4Finalists.includes(c.peer); let msg = ""; if(!isFinalist) { msg = `¡REBOTE! Turno de ${this.players[rivalId].name}`; } else if(c.peer === rivalId) { msg = `<span style="color:var(--danger); animation: pulseCD 1s infinite;">¡REBOTE! RESPONDE TÚ</span>`; if(navigator.vibrate) navigator.vibrate([200,100,200]); } else { msg = `Has fallado. Rebote para tu rival.`; } c.send({ type: 'r4-update', isFinalist: isFinalist, msg: msg, myQuesitos: p.quesitos || [] }); }); }
    broadcastR4WildcardState() { const activeName = this.players[this.r4Finalists[this.r4TurnIdx]].name; Object.values(this.connections).forEach(c => { const p = this.players[c.peer]; const isFinalist = this.r4Finalists.includes(c.peer); const isMyTurn = c.peer === this.r4Finalists[this.r4TurnIdx]; c.send({ type: 'r4-wildcard-trigger', isFinalist: isFinalist, isMyTurn: isMyTurn, name: activeName, myQuesitos: p.quesitos || [] }); }); }

    // --- CLIENTE ---
    joinGame() { AudioEngine.init(); const c = document.getElementById('join-code').value.toUpperCase().trim(); const n = document.getElementById('join-name').value.toUpperCase().trim(); if(!c || !n || !this.selectedAvatar) return alert("Falta código, nombre o avatar."); document.getElementById('btn-join').innerText = "CONECTANDO..."; document.getElementById('btn-join').disabled = true; this.peer = new Peer(); this.peer.on('open', () => { const conn = this.peer.connect(`hacha-room-${c}`, { reliable: true }); const timeoutId = setTimeout(() => { if(!this.conn) { alert("❌ La sala no existe."); document.getElementById('btn-join').innerText = "¡ENTRAR!"; document.getElementById('btn-join').disabled = false; } }, 5000); conn.on('open', () => { clearTimeout(timeoutId); this.conn = conn; conn.send({type:'join', name:n, avatar:this.selectedAvatar}); this.show('screen-controller'); }); conn.on('data', d => this.handleClientData(d)); conn.on('error', () => { alert("Error de red."); }); }); }
    handleClientData(d) {
        if(d.type==='joined_ok') { document.getElementById('my-avatar').innerText = d.avatar; document.getElementById('buzzer').style.background = `radial-gradient(circle at 30% 30%, ${d.color}, #000)`; }
        if(d.type==='phase'){ document.getElementById('ctrl-standard').style.display=d.phase!==2&&d.phase!==4?'block':'none'; document.getElementById('ctrl-r2').style.display=d.phase===2?'block':'none'; document.getElementById('ctrl-r4').style.display=d.phase===4?'block':'none'; if(d.phase===3) document.getElementById('r3-lives-mobile').style.display='block'; }
        if(d.type==='status') { document.getElementById('msg-box').innerHTML = d.msg; document.getElementById('buzzer').className = d.locked ? 'buzzer-btn disabled' : 'buzzer-btn'; }
        if(d.type==='r2-data') { document.getElementById('r2-mobile-data').innerText = d.text; document.getElementById('r2-tool-math').style.display=d.isMath?'block':'none'; document.getElementById('r2-tool-lex').style.display=!d.isMath?'block':'none'; this.calcStr=""; document.getElementById('calc-display').value=""; document.getElementById('r2-lex-input').value=""; document.getElementById('btn-r2-submit-lex').disabled=false; document.getElementById('btn-r2-submit-math').disabled=false; document.getElementById('btn-r2-submit-lex').innerText="ENVIAR"; document.getElementById('btn-r2-submit-math').innerText="ENVIAR"; }
        if(d.type==='r2-unlock') { document.getElementById('btn-r2-submit-lex').disabled=false; document.getElementById('btn-r2-submit-math').disabled=false; }
        if(d.type==='r2-lock') { document.getElementById('btn-r2-submit-lex').disabled=true; document.getElementById('btn-r2-submit-math').disabled=true; }
        if(d.type==='r2-timer') { document.getElementById('r2-mobile-timer').innerText = d.val; }
        if(d.type==='r3-update') { document.getElementById('r3-lives-mobile').innerText = '❤️'.repeat(d.lives); document.getElementById('msg-box').innerText = d.msg; if(d.eliminated) { document.getElementById('ctrl-standard').style.display='none'; document.getElementById('ctrl-spectator').style.display='flex'; } if(!d.myTurn) document.getElementById('buzzer').classList.add('disabled'); }
        
        if(d.type==='r4-update') { document.getElementById('r4-mobile-msg').innerHTML = d.msg; document.getElementById('spectator-wildcard').style.display = 'none'; document.getElementById('spectator-sabotage').style.display = 'block'; if(d.isFinalist) { document.getElementById('r4-my-quesitos').innerHTML = Object.keys(CAT_COLORS).map(cat => { const c = d.myQuesitos.includes(cat) ? CAT_COLORS[cat] : '#1e293b'; return `<div class="quesito" style="background:${c};"></div>`; }).join(''); } else { document.getElementById('ctrl-r4').style.display='none'; document.getElementById('ctrl-spectator').style.display='flex'; } }
        if(d.type==='r4-wildcard-trigger') { if(!d.isFinalist) { document.getElementById('spectator-sabotage').style.display = 'none'; document.getElementById('spectator-wildcard').style.display = 'block'; document.getElementById('r4-wildcard-input').value = ""; document.getElementById('btn-r4-submit-wildcard').disabled = false; document.getElementById('btn-r4-submit-wildcard').innerText = "ENVIAR RESPUESTA"; if(navigator.vibrate) navigator.vibrate([200,100,200]); } else if (d.isMyTurn) { document.getElementById('r4-mobile-msg').innerHTML = `<span style="color:var(--info);">🆘 ¡ESCUCHA AL PÚBLICO!</span>`; } else { document.getElementById('r4-mobile-msg').innerHTML = `Turno de ${d.name}. (Comodín)`; } }
        if(d.type==='r4-wildcard-end') { document.getElementById('spectator-wildcard').style.display = 'none'; document.getElementById('spectator-sabotage').style.display = 'block'; }

        if(d.type==='r4-victory') { document.getElementById('r4-mobile-msg').innerHTML = `<div style="font-size:3.5rem; color:var(--success); font-weight:900;">🏆 CAMPEÓN:<br>${d.avatar} ${d.winner}</div>`; if(navigator.vibrate) navigator.vibrate([500,200,500]); }
        if(d.type==='countdown') { document.getElementById('countdown-layer').style.display='flex'; document.getElementById('cd-num').innerText=d.val; if(d.val==="YA!") setTimeout(()=>document.getElementById('countdown-layer').style.display='none',800); }
        if(d.type==='scoreUpdate') { document.getElementById('my-score').innerText = d.score + " PTS"; }
    }
    c(v) { const d=document.getElementById('calc-display'); if(v==='C') this.calcStr=''; else if(v==='=') try{this.calcStr=eval(this.calcStr).toString()}catch(e){this.calcStr='Err'} else this.calcStr+=v; d.value=this.calcStr; }
    buzz() { if(this.conn) { this.conn.send({type:'buzz'}); if(navigator.vibrate) navigator.vibrate(50); } }
    sendReaction(e) { if(this.conn) { this.conn.send({type:'reaction', emoji: e}); if(navigator.vibrate) navigator.vibrate(20); } }
    submitR2Lex() { const v=document.getElementById('r2-lex-input').value.toUpperCase(); if(!v) return; this.conn.send({type:'r2_submit', val:v}); document.getElementById('btn-r2-submit-lex').disabled=true; }
    submitR2Math() { const v=document.getElementById('calc-display').value; if(!v) return; this.conn.send({type:'r2_submit', val:v}); document.getElementById('btn-r2-submit-math').disabled=true; }
    submitWildcard() { const v = document.getElementById('r4-wildcard-input').value.toUpperCase(); if(!v) return; this.conn.send({type:'r4_wildcard_submit', val: v}); document.getElementById('btn-r4-submit-wildcard').disabled = true; document.getElementById('btn-r4-submit-wildcard').innerText = "¡ENVIADO!"; }
    showOverlay(v) { document.getElementById('countdown-layer').style.display='flex'; document.getElementById('cd-num').innerText=v; } hideOverlay() { document.getElementById('countdown-layer').style.display='none'; }
    broadcast(m) { Object.values(this.connections).forEach(c => c.send(m)); }
}

const app = new HachaEngine();
const urlParams = new URLSearchParams(window.location.search);
if(urlParams.get("code")){ app.show('screen-join'); document.getElementById('join-code').value=urlParams.get("code"); }
