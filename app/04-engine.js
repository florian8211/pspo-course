<script>
/* Engine part 1. All files share one global scope on purpose, so part 2 can
   call into these. Boot happens at the end of part 2. */
var D = window.__COURSE__ || {modules:[],exams:[],glossary:[],ref:[]};
var MODS = (D.modules||[]).slice().sort(function(a,b){return a.num-b.num;});
var EXAMS = D.exams||[];

/* ============================================================
   STATE + PERSISTENCE
   ============================================================ */
var LS = "orderedlist.v1";
var P = {
  done:{},      // moduleId -> true
  quiz:{},      // qid -> {ok:bool, picked:any}
  sim:{},       // beatKey -> choiceIndex
  write:{},     // beatKey -> {text, grade}
  cards:{},     // cardId -> {box:1..5, due:epochDay, lapses:n}
  exams:{attempts:[], missed:{}},  // attempts:[{id,score,total,at,tags}] ; missed: qid -> {examId, picked}
  coach:[],
  settings:{theme:null, lang:null}   // lang: "de" | "en", null = default
};
var DB=null, SAMPLE=null, DL=null, saveT=null, DBOK=false;

/* German ("Denglisch") module texts. Only title/subtitle/why/objectives/beats
   are swapped; quiz and cards always come from the English module, and beat
   keys stay m.id+"_b"+i so sim/write progress is shared between languages. */
function hasDE(){ return !!(D.modules_de && Object.keys(D.modules_de).length); }
function lang(){
  if(!hasDE()) return "en";
  var l=P.settings.lang;
  return (l==="de"||l==="en") ? l : "de";
}
function LM(m){
  var de = lang()==="de" && m && D.modules_de[m.id];
  if(!de) return m;
  var o={};
  Object.keys(m).forEach(function(k){ o[k]=m[k]; });
  ["title","subtitle","why","objectives","beats"].forEach(function(k){ if(k in de) o[k]=de[k]; });
  return o;
}
function L(en, de){ return lang()==="de" ? de : en; }   // module-view chrome labels only
function langLabel(){ return lang()==="de" ? "English" : "Deutsch"; }
function langToggleHtml(){
  return hasDE() ? '<button class="btn btn-sm btn-ghost langtoggle" title="Switch module language">'+langLabel()+'</button>' : '';
}

function today(){ return Math.floor(Date.now()/86400000); }
/* No claude runtime at all means this is the public demo build, not the hosted
   artifact. Checked synchronously: capabilities resolve later, but the runtime
   object is either there on load or it never was. */
function isDemo(){ return !(window.claude && typeof window.claude.use === "function"); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function merge(base, inc){
  if(!inc || typeof inc!=="object") return base;
  Object.keys(inc).forEach(function(k){
    if(inc[k] && typeof inc[k]==="object" && !Array.isArray(inc[k]) && base[k] && typeof base[k]==="object" && !Array.isArray(base[k])) merge(base[k], inc[k]);
    else base[k]=inc[k];
  });
  return base;
}
function loadLocal(){
  try{ var r=localStorage.getItem(LS); if(r) merge(P, JSON.parse(r)); }catch(e){}
}
function save(){
  clearTimeout(saveT);
  saveT=setTimeout(function(){
    try{ localStorage.setItem(LS, JSON.stringify(P)); }catch(e){}
    if(DB){
      DB.doc("progress/state").set(clone(P)).then(function(){
        DBOK=true; setSync();
      }).catch(function(){ DBOK=false; setSync(); });
    }
  }, 700);
}
function setSync(){
  var c=document.getElementById("syncchip"); if(!c) return;
  if(DB && DBOK){ c.textContent="synced"; c.className="chip chip-ok"; c.title="Progress is saved to this artifact, so it follows you across devices."; }
  else { c.textContent="this browser"; c.className="chip"; c.title="Progress is saved in this browser only."; }
}

/* ============================================================
   TINY DOM HELPERS
   ============================================================ */
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m];}); }
function h(html){ var t=document.createElement("template"); t.innerHTML=html.trim(); return t.content.firstElementChild; }
function $(s,r){ return (r||document).querySelector(s); }
function $$(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }

/* markdown-lite: **bold**, `code`, - bullets, 1. lists, [[PRACTICE]] badge, paragraphs */
var PB = '<span class="pbadge" title="This is a useful practice, but it is not part of the Scrum Guide 2020. PSPO I will not test it as Scrum.">Practice, not Scrum</span>';
function inl(s){
  s = esc(s);
  s = s.replace(/\[\[PRACTICE\]\]\s*/g, PB);
  s = s.replace(/`([^`]+)`/g, function(_,a){return "<code>"+a+"</code>";});
  s = s.replace(/\*\*([^*]+)\*\*/g, function(_,a){return "<strong>"+a+"</strong>";});
  s = s.replace(/\*([^*]+)\*/g, function(_,a){return "<em>"+a+"</em>";});
  return s;
}
function md(s){
  if(!s) return "";
  var blocks = String(s).split(/\n\s*\n/);
  return blocks.map(function(b){
    var lines = b.split("\n").map(function(x){return x.replace(/\s+$/,"");}).filter(function(x){return x.trim()!=="";});
    if(!lines.length) return "";
    if(lines.every(function(l){return /^\s*[-*]\s+/.test(l);}))
      return "<ul>"+lines.map(function(l){return "<li>"+inl(l.replace(/^\s*[-*]\s+/,""))+"</li>";}).join("")+"</ul>";
    if(lines.every(function(l){return /^\s*\d+[.)]\s+/.test(l);}))
      return "<ol>"+lines.map(function(l){return "<li>"+inl(l.replace(/^\s*\d+[.)]\s+/,""))+"</li>";}).join("")+"</ol>";
    return "<p>"+inl(lines.join(" "))+"</p>";
  }).join("");
}
var TICK='<svg class="tick" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--ok)"/><path d="M4.6 8.2l2.2 2.2 4.6-4.8" stroke="var(--surface)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var DOT='<svg class="tick" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="var(--rule-strong)" stroke-width="1.2" fill="none"/></svg>';

/* ============================================================
   NAV + ROUTING
   ============================================================ */
var VIEW={name:"home", arg:null};
var TOOLS=[
  {id:"cards",  label:"Flashcards",     note:"spaced review"},
  {id:"exams",  label:"Mock exams",     note:"untimed"},
  {id:"drill",  label:"Question drill", note:"all module questions"},
  {id:"misses", label:"Mistake log",    note:"what to fix"},
  {id:"ref",    label:"Quick reference",note:"the numbers"},
  {id:"coach",  label:"Ask the coach",  note:"ask Claude"}
];

function moduleDone(m){ return !!P.done[m.id]; }
function progress(){
  var n=MODS.filter(moduleDone).length;
  return {n:n, total:MODS.length, pct: MODS.length? Math.round(n/MODS.length*100):0};
}
function renderRail(){
  var pr=progress();
  $("#pct").textContent=pr.pct+"%";
  $("#fill").style.width=pr.pct+"%";
  $("#progline").textContent=pr.n+" of "+pr.total+" modules";
  var wks={}, order=[];
  MODS.forEach(function(m){ var w=m.week||1; if(!wks[w]){wks[w]=[];order.push(w);} wks[w].push(m); });
  var html="";
  html+='<div class="rail-group">Start</div>';
  html+='<button class="navitem" data-go="home" aria-current="'+(VIEW.name==="home")+'"><span class="no">00</span><span>Dashboard</span><span></span></button>';
  order.forEach(function(w){
    html+='<div class="rail-group">Week '+w+'</div>';
    wks[w].forEach(function(m){
      var d=moduleDone(m);
      html+='<button class="navitem" data-go="module" data-arg="'+esc(m.id)+'" aria-current="'+(VIEW.name==="module"&&VIEW.arg===m.id)+'">'
          + '<span class="no">M'+String(m.num).padStart(2,"0")+'</span>'
          + '<span>'+esc(LM(m).title)+'</span>'
          + (d?TICK:DOT)+'</button>';
    });
  });
  html+='<div class="rail-group">Practice</div>';
  TOOLS.forEach(function(t){
    html+='<button class="navitem" data-go="'+t.id+'" aria-current="'+(VIEW.name===t.id)+'">'
        + '<span class="no">&#183;</span><span>'+esc(t.label)+'</span><span></span></button>';
  });
  $("#railnav").innerHTML=html;
}
function go(name, arg){
  VIEW={name:name, arg:arg||null};
  var r=$("#rail"); if(r) r.setAttribute("data-open","0");
  var sc=$(".scrim"); if(sc) sc.remove();
  renderRail(); render();
  window.scrollTo(0,0);
  var v=$("#view"); if(v) v.focus();
}
document.addEventListener("click", function(e){
  var b=e.target.closest("[data-go]");
  if(b){ go(b.getAttribute("data-go"), b.getAttribute("data-arg")); }
});

/* ============================================================
   RENDER SWITCH
   ============================================================ */
function render(){
  var v=$("#view"), c=$("#crumb");
  var m;
  switch(VIEW.name){
    case "module":
      m=MODS.filter(function(x){return x.id===VIEW.arg;})[0];
      if(!m){ v.innerHTML=empty("That module is not here yet."); c.textContent="Dashboard"; return; }
      c.textContent="Module "+String(m.num).padStart(2,"0")+" / "+LM(m).title;
      v.innerHTML=viewModule(m); wireModule(m); break;
    case "cards":  c.textContent="Flashcards";      v.innerHTML=viewCards();  wireCards();  break;
    case "exams":  c.textContent="Mock exams";      v.innerHTML=viewExams();  break;
    case "exam":   c.textContent="Mock exam";       v.innerHTML=viewExamRun(VIEW.arg); wireExam(); break;
    case "drill":  c.textContent="Question drill";  v.innerHTML=viewDrill();  wireDrill(); break;
    case "misses": c.textContent="Mistake log";     v.innerHTML=viewMisses(); wireMisses(); break;
    case "ref":    c.textContent="Quick reference"; v.innerHTML=viewRef();    break;
    case "coach":  c.textContent="Ask the coach";   v.innerHTML=viewCoach();  wireCoach(); break;
    default:       c.textContent="Dashboard";       v.innerHTML=viewHome();   break;
  }
}
function empty(msg, sub){
  return '<div class="wrap"><div class="empty"><div class="ei">'+esc(msg)+'</div>'+(sub?'<p>'+esc(sub)+'</p>':'')+'</div></div>';
}

/* ============================================================
   HOME
   ============================================================ */
function nextModule(){
  for(var i=0;i<MODS.length;i++){ if(!moduleDone(MODS[i])) return MODS[i]; }
  return null;
}
function dueCount(){
  var t=today(), n=0;
  allCards().forEach(function(c){
    if(!P.done[c.mod]) return;              // cards unlock with their module
    var s=P.cards[c.id]; if(!s || s.due<=t) n++;
  });
  return n;
}
function quizStats(){
  var ids=Object.keys(P.quiz), ok=0;
  ids.forEach(function(k){ if(P.quiz[k].ok) ok++; });
  return {seen:ids.length, ok:ok, pct: ids.length? Math.round(ok/ids.length*100):0};
}
function viewHome(){
  var pr=progress(), nx=nextModule(), qs=quizStats(), due=dueCount();
  var best=null;
  (P.exams.attempts||[]).forEach(function(a){ if(!best || a.score>best.score) best=a; });
  var s='<div class="wrap-wide">';
  s+='<div class="hero"><div class="kicker">Product Owner &middot; PSPO I &middot; then CSPO</div>';
  s+='<h1>Owner\'s Manual</h1>';
  s+='<p class="lede">Fourteen modules that teach what a Product Owner actually does, why they do it, and how the Scrum Guide will be worded when it asks you on the exam. Every idea lands on a real product decision in Northfield, a small town running a budget transparency platform.</p></div>';

  if(isDemo()){
    s+='<div class="demobar"><div class="dh">Public demo</div>'
     + '<p>The whole course runs right here: 14 modules, 317 questions, flashcards with spaced repetition, and both full mock exams. Progress saves in this browser.</p>'
     + '<p>Two things are switched off because they need a model behind them: the <strong>coach</strong>, and <strong>grading of written answers</strong>. Each says so where it appears rather than failing silently.</p></div>';
  }
  s+='<div class="tiles">';
  s+='<div class="tile-stat lead"><div class="k">Modules done</div><div class="v">'+pr.n+'<span style="font-size:.5em;opacity:.7"> / '+pr.total+'</span></div><div class="sub">'+pr.pct+'% of the course</div></div>';
  s+='<div class="tile-stat"><div class="k">Questions right</div><div class="v">'+qs.pct+'%</div><div class="sub">'+qs.ok+' of '+qs.seen+' answered</div></div>';
  s+='<div class="tile-stat"><div class="k">Cards due</div><div class="v">'+due+'</div><div class="sub">'+(due?'ready to review':(Object.keys(P.done).length?'nothing waiting today':'unlock by finishing a module'))+'</div></div>';
  s+='<div class="tile-stat"><div class="k">Best mock</div><div class="v">'+(best?Math.round(best.score/best.total*100)+'%':'<span style="opacity:.4">n/a</span>')+'</div><div class="sub">'+(best?(best.score+' of '+best.total+', pass is 85%'):'not attempted yet')+'</div></div>';
  s+='</div>';

  if(!Object.keys(P.done).length){
    s+='<div class="planbox"><div class="planhead">How to run this over four to six weeks</div><ol class="planlist">'
     + '<li><b>Weeks 1 to 4</b> Three modules a week, in order. Do the quiz at the end of each one while it is fresh, and mark the module complete so its flashcards unlock.</li>'
     + '<li><b>Every few days</b> Clear whatever flashcards are due. This is the part that makes the wording stick, and it takes a few minutes.</li>'
     + '<li><b>Week 5</b> Module 13 is the trap catalogue and Module 14 is a full Sprint simulation. Then take a mock exam.</li>'
     + '<li><b>Before you book</b> Work the mistake log until it is short, then pass both mocks above 85 percent. Scrum.org also publishes a free Product Owner Open assessment, and passing that repeatedly is the usual green light.</li>'
     + '</ol><p class="planfoot">Nothing here is timed. The real exam is, but you cannot practise calm by rehearsing panic.</p></div>';
  }
  if(nx){
    s+='<div class="sec-h"><h2>Pick up here</h2><span class="rule"></span></div>';
    s+='<button class="mcard" data-go="module" data-arg="'+esc(nx.id)+'" style="max-width:520px">'
      + '<div class="top"><span class="no">M'+String(nx.num).padStart(2,"0")+'</span><span class="chip chip-spark">next</span></div>'
      + '<div class="ttl">'+esc(LM(nx).title)+'</div><div class="sub">'+esc(LM(nx).subtitle||"")+'</div>'
      + '<div class="foot"><span class="chip">'+(nx.minutes||25)+' min</span><span class="chip">'+((nx.quiz||[]).length)+' questions</span></div></button>';
  } else {
    s+='<div class="sec-h"><h2>All modules done</h2><span class="rule"></span></div>';
    s+='<p class="muted">Now live in the mock exams and the flashcards until the wording stops surprising you.</p>';
  }

  s+='<div class="sec-h"><h2>The course</h2><span class="rule"></span></div><div class="wkgrid">';
  var wks={}, order=[];
  MODS.forEach(function(m){ var w=m.week||1; if(!wks[w]){wks[w]=[];order.push(w);} wks[w].push(m); });
  order.forEach(function(w){
    s+='<div class="wk"><div class="wk-lbl">Week '+w+'</div><div class="mcards">';
    wks[w].forEach(function(m){
      var d=moduleDone(m);
      s+='<button class="mcard" data-done="'+(d?1:0)+'" data-go="module" data-arg="'+esc(m.id)+'">'
        + '<div class="top"><span class="no">M'+String(m.num).padStart(2,"0")+'</span>'+(d?'<span class="chip chip-ok">done</span>':'')+'</div>'
        + '<div class="ttl">'+esc(LM(m).title)+'</div><div class="sub">'+esc(LM(m).subtitle||"")+'</div>'
        + '<div class="foot"><span class="chip">'+(m.minutes||25)+' min</span></div></button>';
    });
    s+='</div></div>';
  });
  s+='</div>';

  s+='<div class="sec-h"><h2>Practice</h2><span class="rule"></span></div><div class="mcards">';
  TOOLS.forEach(function(t){
    s+='<button class="mcard" data-go="'+t.id+'"><div class="ttl">'+esc(t.label)+'</div><div class="sub">'+esc(t.note)+'</div></button>';
  });
  s+='</div></div>';
  return s;
}

/* ============================================================
   MODULE
   ============================================================ */
function viewModule(m){
  var t=LM(m), nn=String(m.num).padStart(2,"0"), wk=(m.week||1), mins=(m.minutes||25);
  var s='<div class="wrap">';
  s+='<div class="mhead">'+langToggleHtml()+'<div class="no">'+L('Module '+nn+' &middot; Week '+wk+' &middot; about '+mins+' minutes', 'Modul '+nn+' &middot; Woche '+wk+' &middot; ca. '+mins+' Minuten')+'</div>';
  s+='<h1>'+esc(t.title)+'</h1>';
  s+='<p class="sub">'+esc(t.subtitle||"")+'</p>';
  if(t.why) s+='<div class="why"><b>'+L("Why this matters","Warum das zählt")+'</b>'+md(t.why)+'</div>';
  if(t.objectives && t.objectives.length){
    s+='<div class="objs"><div class="ol">'+L("By the end you can","Am Ende kannst du")+'</div><ul>'+t.objectives.map(function(o){return "<li>"+inl(o)+"</li>";}).join("")+'</ul></div>';
  }
  s+='</div>';
  s+='<div class="beats">';
  (t.beats||[]).forEach(function(b,i){ s+=renderBeat(b, m.id+"_b"+i); });
  s+='</div>';

  if((m.quiz||[]).length){
    s+='<div class="quizwrap"><div class="qh"><h2>Check yourself</h2></div>';
    s+='<p class="qintro">Answer these the way the exam would want, not the way your team actually works. You will see the reasoning either way, and anything you miss goes to your mistake log.</p>';
    s+='<div class="qlist">';
    m.quiz.forEach(function(q,i){ s+=renderQ(q, {n:i+1, immediate:true}); });
    s+='</div></div>';
  }
  s+='<div class="modfoot">';
  s+='<button class="btn btn-primary" id="donebtn">'+(moduleDone(m)?"Mark as not done":"Mark module complete")+'</button>';
  var idx=MODS.indexOf(m);
  if(idx<MODS.length-1) s+='<button class="btn" data-go="module" data-arg="'+esc(MODS[idx+1].id)+'">Next: '+esc(LM(MODS[idx+1]).title)+'</button>';
  s+='<button class="btn btn-ghost" data-go="home">Back to dashboard</button>';
  s+='</div></div>';
  return s;
}
function wireModule(m){
  var db=$("#donebtn");
  if(db) db.addEventListener("click", function(){
    if(P.done[m.id]) delete P.done[m.id]; else P.done[m.id]=true;
    save(); renderRail(); render();
  });
  wireBeats();
  (m.quiz||[]).forEach(function(q,i){ wireQ(q, {immediate:true}); });
}

/* ============================================================
   BEATS
   ============================================================ */
function renderBeat(b, key){
  switch(b.type){
    case "hook":
      return '<div class="beat b-hook"><div class="eyebrow">Start here</div>'+md(b.body)+'</div>';
    case "analogy":
      return '<div class="beat b-analogy"><div class="tagline">Analogy</div>'
           + (b.title?'<h3>'+esc(b.title)+'</h3>':'')+md(b.body)
           + (b.visual?viz(b.visual):'')+'</div>';
    case "teach":
      var c=b.callout;
      return '<div class="beat b-teach">'+(b.title?'<h3>'+esc(b.title)+'</h3>':'')+md(b.body)
           + (b.visual?viz(b.visual):'')
           + (c?'<div class="callout callout-'+esc(c.kind||"note")+'">'+calIcon(c.kind)+'<div>'+md(c.text)+'</div></div>':'')+'</div>';
    case "guide":
      return '<div class="beat b-guide"><div class="src">'+bookIcon()+'Scrum Guide 2020 &middot; '+esc(b.cite||"")+'</div>'
           + '<blockquote>'+esc(b.quote)+'</blockquote>'
           + (b.gloss?'<div class="gloss"><strong>'+L("In plain English:","Kurz gesagt:")+'</strong> '+inl(b.gloss)+'</div>':'')+'</div>';
    case "trap":
      return '<div class="beat b-trap"><div class="th">'
           + '<div class="cell myth"><div class="lbl">'+xIcon()+'What people assume</div>'+md(b.myth)+'</div>'
           + '<div class="cell truth"><div class="lbl">'+checkIcon()+'What the Guide says</div>'+md(b.truth)+'</div>'
           + '</div>'+(b.why?'<div class="why"><b>Why the exam asks it:</b> '+inl(b.why)+'</div>':'')+'</div>';
    case "civic":
      return '<div class="beat b-civic"><div class="lbl">'+pinIcon()+'In Northfield</div>'
           + (b.title?'<h3>'+esc(b.title)+'</h3>':'')+md(b.body)+'</div>';
    case "keypoints":
      return '<div class="beat b-keys"><div class="lbl">Worth keeping</div><ol>'
           + (b.points||[]).map(function(p){return "<li>"+inl(p)+"</li>";}).join("")+'</ol></div>';
    case "check":
      return '<div class="beat">'+renderQ(b.q, {n:null, immediate:true, inline:true})+'</div>';
    case "sim":
      return renderSim(b, key);
    case "write":
      return renderWrite(b, key);
    default:
      return '<div class="beat b-teach">'+md(b.body||"")+'</div>';
  }
}
function wireBeats(){
  $$("[data-sim]").forEach(function(el){ wireSim(el); });
  $$("[data-write]").forEach(function(el){ wireWrite(el); });
  $$("[data-q]").forEach(function(el){ /* wired by wireQ via id */ });
}
function calIcon(k){
  var col = k==="warn"?"var(--bad)":(k==="why"?"var(--spark)":"var(--accent)");
  return '<svg class="ci" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="'+col+'" stroke-width="1.4" fill="none"/><path d="M8 4.6v4.2M8 11.2v.6" stroke="'+col+'" stroke-width="1.6" stroke-linecap="round"/></svg>';
}
function bookIcon(){ return '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 3.2h4.2c.9 0 1.3.5 1.3 1.2v8.4c0-.6-.5-1-1.3-1H2.5V3.2z" fill="currentColor" opacity=".85"/><path d="M13.5 3.2H9.3c-.9 0-1.3.5-1.3 1.2v8.4c0-.6.5-1 1.3-1h4.2V3.2z" fill="currentColor" opacity=".45"/></svg>'; }
function xIcon(){ return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'; }
function checkIcon(){ return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
function pinIcon(){ return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.8c2.4 0 4.3 1.9 4.3 4.2 0 3-4.3 8.2-4.3 8.2S3.7 9 3.7 6c0-2.3 1.9-4.2 4.3-4.2z" fill="currentColor" opacity=".9"/><circle cx="8" cy="6" r="1.6" fill="var(--surface)"/></svg>'; }

/* ---------- sim ---------- */
function renderSim(b, key){
  var picked = P.sim[key];
  var s='<div class="beat b-sim" data-sim="'+esc(key)+'">';
  s+='<div class="simhead"><div class="lbl">Your call</div><h3>'+esc(b.title||"A decision")+'</h3></div>';
  s+='<div class="setup">'+md(b.setup)+'</div>';
  s+='<div class="simchoices">';
  (b.choices||[]).forEach(function(c,i){
    var isP = picked===i;
    s+='<button class="simchoice" data-i="'+i+'" data-v="'+esc(c.verdict||"mixed")+'" data-picked="'+(isP?1:0)+'"'+(picked!=null?" disabled":"")+'>'
      +'<span class="key">'+String.fromCharCode(65+i)+'</span><span>'+inl(c.label)+'</span></button>';
  });
  s+='</div>';
  s+='<div class="simout">'+(picked!=null?simOutcome(b.choices[picked]):"")+'</div>';
  s+='</div>';
  return s;
}
function simOutcome(c){
  if(!c) return "";
  var vl = c.verdict==="good"?"That worked":(c.verdict==="bad"?"That cost you":"Mixed result");
  return '<div class="outcome reveal" data-v="'+esc(c.verdict||"mixed")+'"><div class="oh">'+esc(vl)+'</div>'
       + md(c.outcome)
       + (c.lesson?'<div class="lesson"><strong>The principle:</strong> '+inl(c.lesson)+'</div>':'')+'</div>';
}
function wireSim(el){
  var key=el.getAttribute("data-sim");
  el.addEventListener("click", function(e){
    var b=e.target.closest(".simchoice"); if(!b || b.disabled) return;
    var i=+b.getAttribute("data-i");
    P.sim[key]=i; save();
    var mod=MODS.filter(function(x){return VIEW.arg===x.id;})[0];
    var beat=null;
    if(mod){ var n=+key.split("_b")[1]; beat=LM(mod).beats[n]; }
    $$(".simchoice",el).forEach(function(x){ x.disabled=true; x.setAttribute("data-picked", (+x.getAttribute("data-i")===i)?1:0); });
    if(beat) $(".simout",el).innerHTML=simOutcome(beat.choices[i]);
  });
}

/* ---------- write (graded by Claude) ---------- */
function renderWrite(b, key){
  var st=P.write[key]||{};
  var s='<div class="beat b-write" data-write="'+esc(key)+'">';
  s+='<div class="lbl">'+penIcon()+L("Write it yourself","Schreib es selbst")+'</div>';
  s+=md(b.prompt);
  s+='<div style="margin-top:14px"><textarea class="ta" placeholder="Take a real swing at it. Rough is fine.">'+esc(st.text||b.starter||"")+'</textarea></div>';
  if(b.rubric && b.rubric.length){
    s+='<div class="rubric"><div class="rl">'+L("What a strong answer does","Was eine starke Antwort ausmacht")+'</div><ul>'+b.rubric.map(function(r){return "<li>"+inl(r)+"</li>";}).join("")+'</ul></div>';
  }
  s+='<div class="q-actions"><button class="btn btn-primary" data-act="grade">'+L("Get feedback","Feedback holen")+'</button>'
    +'<button class="btn" data-act="model">'+L("Show a strong answer","Starke Antwort zeigen")+'</button></div>';
  s+='<div class="gradeout">'+(st.grade?gradeBox(st.grade):"")+'</div>';
  s+='<div class="modelout"></div>';
  s+='</div>';
  return s;
}
function penIcon(){ return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.2 2.4l2.4 2.4-7.6 7.6-3.2.8.8-3.2 7.6-7.6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/></svg>'; }
function gradeBox(t){ return '<div class="grade reveal"><div class="gh">'+checkIcon()+'Feedback on your answer</div>'+md(t)+'</div>'; }
function wireWrite(el){
  var key=el.getAttribute("data-write");
  var mod=MODS.filter(function(x){return VIEW.arg===x.id;})[0];
  var beat=null; if(mod){ var n=+key.split("_b")[1]; beat=LM(mod).beats[n]; }
  var ta=$("textarea",el);
  ta.addEventListener("input", function(){ P.write[key]=P.write[key]||{}; P.write[key].text=ta.value; save(); });
  el.addEventListener("click", function(e){
    var b=e.target.closest("[data-act]"); if(!b) return;
    var act=b.getAttribute("data-act");
    if(act==="model"){
      $(".modelout",el).innerHTML = beat && beat.model
        ? '<div class="model-ans reveal"><div class="mh">'+L("One strong answer","Eine starke Antwort")+'</div>'+md(beat.model)+'</div>'
        : '<div class="model-ans reveal"><div class="mh">No sample provided</div><p>Compare your answer against the criteria above.</p></div>';
      return;
    }
    if(act==="grade"){
      var txt=ta.value.trim();
      if(!txt){ $(".gradeout",el).innerHTML='<div class="grade"><div class="gh">Nothing to read yet</div><p>Write something first, even a rough attempt.</p></div>'; return; }
      if(!SAMPLE){
        $(".gradeout",el).innerHTML='<div class="grade"><div class="gh">Demo mode</div><p>In the full version this answer is graded by Claude against the criteria above. This public demo has no model behind it, so use <strong>Show a strong answer</strong> and compare yourself. Everything else in the course works normally.</p></div>';
        return;
      }
      b.disabled=true;
      $(".gradeout",el).innerHTML='<div class="grade"><div class="gh"><span class="spinner"></span> Reading your answer</div><div class="gtxt"></div></div>';
      var target=$(".gradeout .gtxt",el);
      var prompt = "You are a Scrum coach grading a Product Owner student's written answer. The student is studying for PSPO I and is newer to Scrum. The course's running example is Ledgerline, a municipal budget transparency platform sold to Northfield, a small town.\n\n"
        + "THE EXERCISE:\n" + (beat?beat.prompt:"") + "\n\n"
        + "WHAT A STRONG ANSWER DOES:\n" + ((beat&&beat.rubric)?beat.rubric.map(function(r){return "- "+r;}).join("\n"):"") + "\n\n"
        + "HIS ANSWER:\n" + txt + "\n\n"
        + "Give feedback in under 200 words. Structure it as: one sentence on what genuinely works, then the single most valuable improvement stated concretely, then a rewritten version of his answer that shows the improvement. Be direct and specific, never generic praise. Judge against the Scrum Guide 2020, and if he has stated a common practice as if it were Scrum, say so. Do not use em dashes anywhere in your reply."
        + (lang()==="de" ? " Reply in German, but keep Scrum terms and fixed Scrum Guide phrases in English. Use Swiss spelling (ss, never ß)." : "");
      SAMPLE(prompt, {onText:function(u){ target.innerHTML=md(u.text); }, modelTier:"default"})
        .then(function(r){
          P.write[key]=P.write[key]||{}; P.write[key].text=txt; P.write[key].grade=r.text; save();
          $(".gradeout",el).innerHTML=gradeBox(r.text); b.disabled=false;
        })
        .catch(function(err){
          var msg = (err&&err.code==="not_granted") ? "Feedback needs permission to ask Claude. Reload and allow it, then try again."
                  : (err&&err.code==="rate_limited") ? "Too many requests just now. Give it a moment and try again."
                  : "That request did not go through. Try again.";
          $(".gradeout",el).innerHTML='<div class="grade"><div class="gh">Could not get feedback</div><p>'+esc(msg)+'</p></div>';
          b.disabled=false;
        });
    }
  });
}
</script>
