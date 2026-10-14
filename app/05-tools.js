<script>
/* Engine part 2: questions, visuals, flashcards, exams, reference, coach, boot.
   Shares global scope with part 1. */

/* ============================================================
   QUESTIONS
   ============================================================ */
var QS = {};                      // qid -> {picked, done}
var QIDX = {};                    // qid -> question object (every question anywhere)
function indexQuestions(){
  MODS.forEach(function(m){
    (m.quiz||[]).forEach(function(q){ QIDX[q.id]=q; });
    (m.beats||[]).forEach(function(b){ if(b.type==="check" && b.q) QIDX[b.q.id]=b.q; });
  });
  EXAMS.forEach(function(x){ (x.questions||[]).forEach(function(q){ QIDX[q.id]=q; }); });
}
function shuffled(a){ var r=a.slice(); for(var i=r.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=r[i]; r[i]=r[j]; r[j]=t; } return r; }
function isMulti(q){ return q.kind==="multi"; }
function correctSet(q){ return isMulti(q) ? (q.answer||[]).slice().sort() : q.answer; }
function sameSet(a,b){ if(a.length!==b.length) return false; for(var i=0;i<a.length;i++){ if(a[i]!==b[i]) return false; } return true; }

function renderQ(q, o){
  o=o||{};
  var st = QS[q.id] || (QS[q.id] = {picked: isMulti(q)?[]:null, done:false, order:null});
  var prior = P.quiz[q.id];
  if(prior && !st.done && !o.exam){ st.picked = prior.picked; st.done = true; }
  var s='<div class="q" data-q="'+esc(q.id)+'" data-kind="'+esc(q.kind||"mcq")+'"'+(o.exam?' data-exam="1"':'')+'>';
  s+='<div class="q-head">';
  if(o.n) s+='<span class="q-no">Question '+o.n+'</span>';
  if(q.tag) s+='<span class="chip">'+esc(q.tag)+'</span>';
  if(o.inline) s+='<span class="chip chip-accent">quick check</span>';
  s+='</div>';
  s+='<div class="q-stem">'+inl(q.stem)+'</div>';
  if(isMulti(q)) s+='<div class="q-hint">Choose '+((q.answer||[]).length)+'</div>';
  s+='<div class="qbody">'+qBody(q, st, o)+'</div>';
  s+='<div class="q-actions">'+(st.done?'':'<button class="btn btn-primary" data-act="sub">'+(o.exam?"Save answer":"Check answer")+'</button>')+'</div>';
  s+='<div class="q-verdict">'+((st.done && !o.exam)?verdictHTML(q, st):'')+'</div>';
  s+='</div>';
  return s;
}
function qBody(q, st, o){
  var k=q.kind||"mcq";
  if(k==="tf"){
    return '<div class="opts">'+["True","False"].map(function(t,i){
      var val=(i===0);
      var sel = st.picked===val;
      return '<button class="opt" data-v="'+val+'" data-sel="'+(sel?1:0)+'"'+(st.done?" disabled":"")+(st.done?optState(q,st,val):"")+'><span class="key">'+(i===0?"T":"F")+'</span><span>'+t+'</span></button>';
    }).join("")+'</div>';
  }
  if(k==="order"){
    if(!st.order) st.order = shuffled((q.items||[]).map(function(_,i){return i;}));
    var oh = st.done ? '' : '<div class="howto">'+esc(q.instruction||"Use the arrows to put these in the right order, top to bottom.")+'</div>';
    return oh+'<div class="ord">'+st.order.map(function(oi,pos){
      var stt = st.done ? (q.items[oi]===q.items[pos] ? ' data-state="right"' : ' data-state="wrong"') : '';
      return '<div class="ord-item" data-oi="'+oi+'"'+stt+'>'
        +'<span class="rank">'+String(pos+1).padStart(2,"0")+'</span><span>'+inl(q.items[oi])+'</span>'
        +(st.done?'':'<span class="ord-nudge"><button type="button" data-mv="up" aria-label="Move up">&#9650;</button><button type="button" data-mv="down" aria-label="Move down">&#9660;</button></span>')
        +'</div>';
    }).join("")+'</div>';
  }
  if(k==="sort"){
    if(!st.place) st.place={};
    var pool=(q.items||[]).map(function(it,i){return i;}).filter(function(i){ return st.place[i]==null; });
    var sh = st.done ? '' : '<div class="howto">'+(st.sel!=null?"Now tap the column it belongs in.":"Tap an item, then tap the column it belongs in.")+'</div>';
    var s=sh+'<div class="pool'+(st.sel!=null?" armed":"")+'" data-bucket="__pool">'+ (pool.length?pool.map(function(i){return tileHTML(q,i,st);}).join(""):'<span class="muted" style="font-size:12.5px">All placed. Tap one to move it back.</span>') +'</div>';
    s+='<div class="sort-grid'+(st.sel!=null?" armed":"")+'">'+(q.buckets||[]).map(function(b){
      var mine=(q.items||[]).map(function(it,i){return i;}).filter(function(i){ return st.place[i]===b; });
      return '<div class="bucket" data-bucket="'+esc(b)+'"><h4>'+esc(b)+'</h4><div class="bucket-items">'+mine.map(function(i){return tileHTML(q,i,st);}).join("")+'</div></div>';
    }).join("")+'</div>';
    return s;
  }
  return '<div class="opts">'+(q.options||[]).map(function(op,i){
    var sel = isMulti(q) ? (st.picked||[]).indexOf(i)>=0 : st.picked===i;
    return '<button class="opt" data-v="'+i+'" data-sel="'+(sel?1:0)+'"'+(st.done?" disabled":"")+(st.done?optState(q,st,i):"")+'>'
      +'<span class="key">'+String.fromCharCode(65+i)+'</span><span>'+inl(op)+'</span></button>';
  }).join("")+'</div>';
}
function tileHTML(q,i,st){
  var stt = st.done ? (st.place[i]===q.items[i].bucket ? ' data-state="right"' : ' data-state="wrong"') : '';
  var sel = (st.sel===i) ? ' data-sel="1"' : '';
  return '<button type="button" class="tile" data-ti="'+i+'"'+stt+sel+(st.done?' disabled':'')
    +' aria-pressed="'+(st.sel===i)+'">'+inl(q.items[i].text)+'</button>';
}
function optState(q,st,v){
  if(q.kind==="tf") return (v===q.answer)?' data-state="right"':(st.picked===v?' data-state="wrong"':'');
  if(isMulti(q)){
    var inAns=(q.answer||[]).indexOf(v)>=0, inPick=(st.picked||[]).indexOf(v)>=0;
    if(inAns&&inPick) return ' data-state="right"';
    if(!inAns&&inPick) return ' data-state="wrong"';
    if(inAns&&!inPick) return ' data-state="missed"';
    return '';
  }
  if(v===q.answer) return ' data-state="right"';
  if(st.picked===v) return ' data-state="wrong"';
  return '';
}
function gradeQ(q, st){
  var k=q.kind||"mcq";
  if(k==="order") return st.order.every(function(oi,pos){ return q.items[oi]===q.items[pos]; });
  if(k==="sort") return (q.items||[]).every(function(it,i){ return st.place[i]===it.bucket; });
  if(isMulti(q)) return sameSet((st.picked||[]).slice().sort(), correctSet(q));
  return st.picked===q.answer;
}
function verdictHTML(q, st){
  var ok=gradeQ(q,st);
  return '<div class="verdict '+(ok?"verdict-ok":"verdict-bad")+' reveal"><div class="vhead">'
    + (ok?checkIcon()+"Correct":xIcon()+"Not quite")+'</div>'
    + md(q.explain||"")
    + (q.cite?'<div class="cite">'+esc(q.cite)+'</div>':'')+'</div>';
}
function answered(q, st){
  var k=q.kind||"mcq";
  if(k==="order"||k==="sort") return true;
  if(isMulti(q)) return (st.picked||[]).length>0;
  return st.picked!=null;
}
/* one delegated handler for every question on the page */
document.addEventListener("click", function(e){
  var qe=e.target.closest(".q"); if(!qe) return;
  var qid=qe.getAttribute("data-q"); var q=QIDX[qid]; if(!q) return;
  var st=QS[qid]; if(!st) return;
  var isExam=qe.getAttribute("data-exam")==="1";

  var opt=e.target.closest(".opt");
  if(opt && !st.done){
    var raw=opt.getAttribute("data-v");
    var v = q.kind==="tf" ? (raw==="true") : +raw;
    if(isMulti(q)){
      var arr=st.picked||[]; var ix=arr.indexOf(v);
      if(ix>=0) arr.splice(ix,1); else arr.push(v);
      st.picked=arr;
    } else st.picked=v;
    $$(".opt",qe).forEach(function(b){
      var bv = q.kind==="tf" ? (b.getAttribute("data-v")==="true") : +b.getAttribute("data-v");
      var on = isMulti(q) ? (st.picked.indexOf(bv)>=0) : st.picked===bv;
      b.setAttribute("data-sel", on?1:0);
    });
    if(isExam) markExamAnswered(qid);
    return;
  }
  var mv=e.target.closest("[data-mv]");
  if(mv && !st.done){
    var row=mv.closest(".ord-item"); var pos=Array.prototype.indexOf.call(row.parentNode.children,row);
    var to = mv.getAttribute("data-mv")==="up" ? pos-1 : pos+1;
    if(to>=0 && to<st.order.length){
      var t=st.order[pos]; st.order[pos]=st.order[to]; st.order[to]=t;
      $(".qbody",qe).innerHTML=qBody(q,st,{});
    }
    return;
  }
  var tile=e.target.closest(".tile");
  if(tile && !st.done){
    var ti=+tile.getAttribute("data-ti");
    if(st.sel==null){ st.sel=ti; }                       // pick it up
    else if(st.sel===ti){ st.sel=null; }                 // tap again to put it down
    else {
      // something is already picked up and you tapped a tile sitting in a
      // container: treat that as dropping into that container.
      var host=tile.closest("[data-bucket]");
      var hb=host?host.getAttribute("data-bucket"):null;
      if(hb){ st.place[st.sel]=(hb==="__pool")?null:hb; st.sel=null; }
      else { st.sel=ti; }
    }
    $(".qbody",qe).innerHTML=qBody(q,st,{});
    return;
  }
  var bucket=e.target.closest("[data-bucket]");
  if(bucket && !st.done && st.sel!=null){
    var b=bucket.getAttribute("data-bucket");
    st.place[st.sel] = (b==="__pool")?null:b;
    st.sel=null;
    $(".qbody",qe).innerHTML=qBody(q,st,{});
    return;
  }
  var sub=e.target.closest('[data-act="sub"]');
  if(sub){
    if(!answered(q,st)){ return; }
    st.done=true;
    var ok=gradeQ(q,st);
    if(isExam){
      qe.querySelector(".q-actions").innerHTML='<span class="chip chip-accent">answer saved</span>';
      $$(".opt",qe).forEach(function(b){ b.disabled=true; });
      markExamAnswered(qid); return;
    }
    P.quiz[qid]={ok:ok, picked:(isMulti(q)?(st.picked||[]).slice():st.picked)};
    save();
    $(".qbody",qe).innerHTML=qBody(q,st,{});
    $(".q-actions",qe).innerHTML="";
    $(".q-verdict",qe).innerHTML=verdictHTML(q,st);
  }
});
function wireQ(){}

/* ============================================================
   VISUALS
   ============================================================ */
function viz(key){
  var f=VIZ[key]; if(!f) return "";
  var o=f();
  return '<div class="viz">'+o.svg+(o.cap?'<div class="cap">'+esc(o.cap)+'</div>':'')+'</div>';
}
var T={ink:"var(--ink)",i2:"var(--ink-2)",i3:"var(--ink-3)",ac:"var(--accent)",sp:"var(--spark)",spi:"var(--spark-ink)",sf:"var(--surface)",r:"var(--rule)",rs:"var(--rule-strong)",as:"var(--accent-soft)",ss:"var(--spark-soft)",ok:"var(--ok)"};
function tx(x,y,s,o){ o=o||{}; return '<text x="'+x+'" y="'+y+'" fill="'+(o.fill||T.i2)+'" font-family="'+(o.mono?"IBM Plex Mono, monospace":"IBM Plex Sans, sans-serif")+'" font-size="'+(o.size||12)+'" font-weight="'+(o.w||400)+'" text-anchor="'+(o.a||"middle")+'"'+(o.ls?' letter-spacing="'+o.ls+'"':'')+'>'+esc(s)+'</text>'; }
var VIZ={
  "empirical-loop": function(){
    var s='<svg viewBox="0 0 460 200" role="img" aria-label="The empirical loop: do a small piece of work, look at the real result, adjust, repeat.">';
    var pts=[[80,100,"Do a little"],[230,60,"Look hard"],[380,100,"Adjust"]];
    s+='<path d="M120 100 L192 68" stroke="'+T.rs+'" stroke-width="1.6" fill="none" marker-end="url(#ah)"/>';
    s+='<path d="M268 68 L340 100" stroke="'+T.rs+'" stroke-width="1.6" fill="none" marker-end="url(#ah)"/>';
    s+='<path d="M380 140 Q230 190 80 140" stroke="'+T.sp+'" stroke-width="1.6" fill="none" stroke-dasharray="5 4" marker-end="url(#ah2)"/>';
    s+='<defs><marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="'+T.rs+'"/></marker>'
     + '<marker id="ah2" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="'+T.sp+'"/></marker></defs>';
    pts.forEach(function(p){
      s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="34" fill="'+T.as+'" stroke="'+T.ac+'" stroke-width="1.4"/>';
      s+=tx(p[0],p[1]+4,p[2],{fill:T.ac,size:12,w:600});
    });
    s+=tx(230,178,"repeat, on a fixed cadence",{fill:T.spi,size:11,mono:true,ls:".08em"});
    s+='</svg>';
    return {svg:s, cap:"Knowledge comes from doing and looking, not from deciding harder up front."};
  },
  "scrum-machine": function(){
    var s='<svg viewBox="0 0 560 300" role="img" aria-label="The Scrum framework: three accountabilities, five events, three artifacts each with one commitment.">';
    function box(x,y,w,hh,t,sub,col,fill){
      var o='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+hh+'" rx="7" fill="'+fill+'" stroke="'+col+'" stroke-width="1.3"/>';
      o+=tx(x+w/2,y+(sub?20:hh/2+4),t,{fill:T.ink,size:12.5,w:600});
      if(sub) o+=tx(x+w/2,y+36,sub,{fill:T.i3,size:10.5,mono:true});
      return o;
    }
    s+=tx(90,20,"ACCOUNTABILITIES",{fill:T.i3,size:10,mono:true,ls:".1em"});
    s+=box(20,32,140,42,"Product Owner","value + backlog",T.ac,T.as);
    s+=box(20,84,140,42,"Scrum Master","effectiveness",T.ac,T.as);
    s+=box(20,136,140,42,"Developers","the Increment",T.ac,T.as);
    s+=tx(300,20,"EVENTS",{fill:T.i3,size:10,mono:true,ls:".1em"});
    s+='<rect x="196" y="32" width="208" height="146" rx="9" fill="none" stroke="'+T.sp+'" stroke-width="1.6" stroke-dasharray="6 4"/>';
    s+=tx(300,50,"THE SPRINT  (container)",{fill:T.spi,size:10.5,mono:true,ls:".06em"});
    s+=box(208,60,184,26,"Sprint Planning","",T.rs,T.sf);
    s+=box(208,92,184,26,"Daily Scrum","",T.rs,T.sf);
    s+=box(208,124,184,26,"Sprint Review","",T.rs,T.sf);
    s+=box(208,152,184,20,"Sprint Retrospective","",T.rs,T.sf);
    s+=tx(490,20,"ARTIFACTS",{fill:T.i3,size:10,mono:true,ls:".1em"});
    s+=box(420,32,124,42,"Product Backlog","",T.ok,T.sf);
    s+=box(420,84,124,42,"Sprint Backlog","",T.ok,T.sf);
    s+=box(420,136,124,42,"Increment","",T.ok,T.sf);
    s+=tx(482,206,"each holds ONE commitment",{fill:T.i3,size:10.5,mono:true});
    s+=box(420,216,124,26,"Product Goal","",T.sp,T.ss);
    s+=box(420,248,124,26,"Sprint Goal","",T.sp,T.ss);
    s+=box(420,280,124,18,"Definition of Done","",T.sp,T.ss);
    s+='<path d="M482 74 L482 216" stroke="'+T.sp+'" stroke-width="1" stroke-dasharray="3 3" fill="none" opacity=".5"/>';
    s+='</svg>';
    return {svg:s, cap:"Three accountabilities, five events, three artifacts. Every artifact carries exactly one commitment."};
  },
  "sprint-timeline": function(){
    var s='<svg viewBox="0 0 560 170" role="img" aria-label="A Sprint timeline from Sprint Planning through Daily Scrums to Sprint Review and Retrospective.">';
    s+='<rect x="30" y="62" width="500" height="34" rx="6" fill="'+T.as+'" stroke="'+T.ac+'" stroke-width="1.2"/>';
    s+=tx(280,84,"THE SPRINT   one month or less, fixed length",{fill:T.ac,size:11,mono:true,ls:".04em"});
    function pin(x,label,sub,col){
      var o='<line x1="'+x+'" y1="46" x2="'+x+'" y2="62" stroke="'+col+'" stroke-width="1.6"/>';
      o+='<circle cx="'+x+'" cy="44" r="4.5" fill="'+col+'"/>';
      o+=tx(x,32,label,{fill:T.ink,size:11,w:600});
      if(sub) o+=tx(x,18,sub,{fill:T.i3,size:9.5,mono:true});
      return o;
    }
    s+=pin(62,"Sprint Planning","max 8h",T.ac);
    s+=pin(498,"Retrospective","max 3h",T.ac);
    s+=pin(430,"Sprint Review","max 4h",T.ac);
    for(var i=0;i<7;i++){ var x=110+i*46;
      s+='<line x1="'+x+'" y1="96" x2="'+x+'" y2="116" stroke="'+T.sp+'" stroke-width="1.4"/><circle cx="'+x+'" cy="118" r="3.4" fill="'+T.sp+'"/>';
    }
    s+=tx(248,140,"Daily Scrum, 15 minutes, for the Developers",{fill:T.spi,size:10.5,mono:true});
    s+='<path d="M530 79 Q548 79 548 100 Q548 120 300 120" stroke="'+T.i3+'" stroke-width="1.2" fill="none" stroke-dasharray="4 3" opacity="0"/>';
    s+=tx(280,160,"a new Sprint starts immediately after the last one ends",{fill:T.i3,size:10.5});
    s+='</svg>';
    return {svg:s, cap:"The Sprint Review is the second to last event. The Retrospective closes the Sprint."};
  },
  "backlog-funnel": function(){
    var s='<svg viewBox="0 0 480 250" role="img" aria-label="Product Backlog: items near the top are small and clear, items further down stay coarse.">';
    var rows=[[40,30,400,"Ready for selection: small, clear, understood",T.ok],
              [70,74,340,"Being refined: getting smaller and more precise",T.sp],
              [104,118,272,"Coarse: a direction, not yet a plan",T.rs],
              [140,162,200,"Ideas and hunches",T.rs]];
    rows.forEach(function(r,i){
      s+='<rect x="'+r[0]+'" y="'+r[1]+'" width="'+r[2]+'" height="34" rx="5" fill="'+(i===0?T.as:T.sf)+'" stroke="'+r[4]+'" stroke-width="1.3"/>';
      s+=tx(r[0]+r[2]/2, r[1]+21, r[3], {fill:i===0?T.ac:T.i2, size:11.5, w:i===0?600:400});
    });
    s+='<line x1="20" y1="24" x2="20" y2="200" stroke="'+T.rs+'" stroke-width="1.2"/>';
    s+=tx(14,30,"TOP",{fill:T.i3,size:9.5,mono:true,a:"end"});
    s+=tx(14,200,"BOTTOM",{fill:T.i3,size:9.5,mono:true,a:"end"});
    s+=tx(240,228,"One order, not five priority labels",{fill:T.spi,size:11,mono:true,ls:".05em"});
    s+='</svg>';
    return {svg:s, cap:"Refinement is an ongoing activity. It is not an event, and it never finishes."};
  },
  "value-quadrants": function(){
    var s='<svg viewBox="0 0 460 280" role="img" aria-label="Evidence-Based Management four Key Value Areas.">';
    var q=[[30,26,"Current Value","What the product delivers today",T.ok],
           [240,26,"Unrealized Value","What it could deliver if you got there",T.sp],
           [30,150,"Time-to-Market","How fast you can learn and ship",T.ac],
           [240,150,"Ability to Innovate","Whether you still can",T.ac]];
    q.forEach(function(c){
      s+='<rect x="'+c[0]+'" y="'+c[1]+'" width="190" height="106" rx="8" fill="'+T.sf+'" stroke="'+c[4]+'" stroke-width="1.5"/>';
      s+=tx(c[0]+95,c[1]+42,c[2],{fill:T.ink,size:13,w:600});
      s+=tx(c[0]+95,c[1]+66,c[3],{fill:T.i2,size:10.5});
    });
    s+=tx(230,272,"the bottom row is what lets you convert the top right into the top left",{fill:T.i3,size:10.5,mono:true});
    s+='</svg>';
    return {svg:s, cap:"Evidence-Based Management. Not in the Scrum Guide, but it is how Scrum.org defines value."};
  },
  "stakeholder-map": function(){
    var s='<svg viewBox="0 0 480 260" role="img" aria-label="Buyers, users and beneficiaries are often different people.">';
    var cols=[[80,"BUYS","signs the contract",["Town Manager","Select Board"],T.ac],
              [240,"USES","day changes",["Finance Director","AP clerk","Treasurer"],T.spi],
              [400,"BENEFITS","never logs in",["Resident","Auditor"],T.ok]];
    cols.forEach(function(c){
      s+=tx(c[0],26,c[1],{fill:c[4],size:11,mono:true,ls:".1em",w:600});
      s+=tx(c[0],42,c[2],{fill:T.i3,size:10});
      c[3].forEach(function(n,i){
        s+='<rect x="'+(c[0]-68)+'" y="'+(58+i*40)+'" width="136" height="30" rx="6" fill="'+T.sf+'" stroke="'+c[4]+'" stroke-width="1.2"/>';
        s+=tx(c[0],78+i*40,n,{fill:T.ink,size:11.5});
      });
    });
    s+=tx(240,224,"The person who signs is rarely the person whose day you change.",{fill:T.i2,size:11.5});
    s+=tx(240,246,"Serve only the signer and you build a product nobody opens.",{fill:T.spi,size:11,mono:true});
    s+='</svg>';
    return {svg:s, cap:"Buyer, user, beneficiary. Know which one each stakeholder is before you weigh their request."};
  },
  "ordering-matrix": function(){
    var s='<svg viewBox="0 0 420 300" role="img" aria-label="Value against effort, with the sequencing trap called out.">';
    s+='<line x1="56" y1="240" x2="392" y2="240" stroke="'+T.rs+'" stroke-width="1.4"/>';
    s+='<line x1="56" y1="240" x2="56" y2="30" stroke="'+T.rs+'" stroke-width="1.4"/>';
    s+=tx(224,268,"EFFORT",{fill:T.i3,size:10.5,mono:true,ls:".1em"});
    s+='<text x="20" y="135" fill="'+T.i3+'" font-family="IBM Plex Mono, monospace" font-size="10.5" letter-spacing=".1em" transform="rotate(-90 20 135)" text-anchor="middle">VALUE</text>';
    s+='<rect x="56" y="30" width="168" height="105" fill="'+T.ss+'" opacity=".6"/>';
    s+=tx(140,84,"do these first",{fill:T.spi,size:11.5,w:600});
    s+=tx(308,84,"big bets: split them",{fill:T.i2,size:11.5});
    s+=tx(140,192,"cheap, low value: fillers",{fill:T.i2,size:11});
    s+=tx(308,192,"say no",{fill:T.i2,size:11.5,w:600});
    [[110,70,T.ok],[160,52,T.ok],[300,64,T.sp],[130,196,T.rs],[330,206,T.rs]].forEach(function(p){
      s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="7" fill="'+p[2]+'"/>';
    });
    s+=tx(224,292,"a model is a conversation aid, never the decision",{fill:T.i3,size:10.5,mono:true});
    s+='</svg>';
    return {svg:s, cap:"Any ordering model is a way to argue productively, not a machine that answers for you."};
  },
  "dod-gate": function(){
    var s='<svg viewBox="0 0 480 190" role="img" aria-label="The Definition of Done is the gate between work and an Increment.">';
    s+='<rect x="20" y="62" width="120" height="52" rx="7" fill="'+T.sf+'" stroke="'+T.rs+'" stroke-width="1.3"/>';
    s+=tx(80,93,"Work that looks done",{fill:T.i2,size:11});
    s+='<rect x="204" y="34" width="72" height="108" rx="7" fill="'+T.ss+'" stroke="'+T.sp+'" stroke-width="1.8"/>';
    s+=tx(240,80,"DEFINITION",{fill:T.spi,size:10,mono:true,w:600});
    s+=tx(240,94,"OF DONE",{fill:T.spi,size:10,mono:true,w:600});
    s+='<rect x="340" y="62" width="120" height="52" rx="7" fill="'+T.as+'" stroke="'+T.ac+'" stroke-width="1.5"/>';
    s+=tx(400,93,"An Increment",{fill:T.ac,size:11.5,w:600});
    s+='<path d="M144 88 L198 88" stroke="'+T.rs+'" stroke-width="1.6" marker-end="url(#ah3)"/>';
    s+='<path d="M282 88 L334 88" stroke="'+T.ok+'" stroke-width="1.6" marker-end="url(#ah4)"/>';
    s+='<defs><marker id="ah3" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="'+T.rs+'"/></marker>'
     + '<marker id="ah4" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7z" fill="'+T.ok+'"/></marker></defs>';
    s+='<path d="M240 142 Q240 172 120 172" stroke="'+T.i3+'" stroke-width="1.3" fill="none" stroke-dasharray="4 3" marker-end="url(#ah3)"/>';
    s+=tx(300,168,"does not meet it: back to the Product Backlog",{fill:T.i3,size:10.5,a:"start"});
    s+='</svg>';
    return {svg:s, cap:"Work that misses the Definition of Done cannot be released, or even presented at the Sprint Review."};
  },
  "goal-nesting": function(){
    var s='<svg viewBox="0 0 420 220" role="img" aria-label="Product Goal contains Sprint Goals which contain the work.">';
    s+='<rect x="20" y="20" width="380" height="180" rx="11" fill="'+T.ss+'" stroke="'+T.sp+'" stroke-width="1.6"/>';
    s+=tx(210,44,"PRODUCT GOAL",{fill:T.spi,size:11.5,mono:true,ls:".1em",w:600});
    s+=tx(210,62,"the long-term objective, and it lives in the Product Backlog",{fill:T.i2,size:10.5});
    for(var i=0;i<3;i++){
      var x=42+i*120;
      s+='<rect x="'+x+'" y="80" width="104" height="98" rx="8" fill="'+T.as+'" stroke="'+T.ac+'" stroke-width="1.3"/>';
      s+=tx(x+52,102,"Sprint Goal",{fill:T.ac,size:11,w:600});
      for(var j=0;j<3;j++){
        s+='<rect x="'+(x+14)+'" y="'+(114+j*20)+'" width="76" height="14" rx="3" fill="'+T.sf+'" stroke="'+T.rs+'" stroke-width="1"/>';
      }
    }
    s+='</svg>';
    return {svg:s, cap:"One objective at a time. Fulfill it or abandon it before taking on the next."};
  }
};

/* ============================================================
   FLASHCARDS  (Leitner boxes, no timing pressure)
   ============================================================ */
var IVL=[0,1,3,7,21];
function allCards(){
  var out=[];
  MODS.forEach(function(m){ (m.cards||[]).forEach(function(c){ out.push({id:c.id,front:c.front,back:c.back,tag:c.tag,mod:m.id,modTitle:m.title}); }); });
  return out;
}
var FC={queue:[], i:0, shown:false};
/* Cards unlock as you finish modules, so the deck grows with you instead of
   dumping every card in the course on you during week one. */
function buildQueue(){
  var t=today();
  var unlocked = allCards().filter(function(c){ return P.done[c.mod]; });
  FC.queue = shuffled(unlocked.filter(function(c){ var s=P.cards[c.id]; return !s || s.due<=t; }));
  FC.i=0; FC.shown=false;
}
function anyDone(){ return Object.keys(P.done).length>0; }
function viewCards(){
  if(!FC.queue.length) buildQueue();
  var s='<div class="wrap">';
  s+='<div class="mhead"><div class="no">Practice</div><h1>Flashcards</h1><p class="sub">Cards you miss come back sooner. Cards you know go quiet for a while. There is no clock and no streak to protect.</p></div>';
  if(!FC.queue.length){
    var msg = anyDone()
      ? '<div class="ei">Nothing due</div><p>Every card you have unlocked is resting. Finish another module to unlock more, or come back tomorrow.</p>'
      : '<div class="ei">No cards yet</div><p>Cards unlock as you complete modules, so the deck grows with you instead of handing you all '+allCards().length+' at once. Finish Module 01 and its cards appear here.</p>';
    s+='<div class="empty">'+msg
     + '<div style="margin-top:18px;display:flex;gap:9px;justify-content:center;flex-wrap:wrap">'
     + (anyDone()?'':'<button class="btn btn-primary" data-go="module" data-arg="'+esc(MODS.length?MODS[0].id:"")+'">Start Module 01</button>')
     + '<button class="btn" id="fcall">Review the whole deck anyway</button></div></div></div>';
    return s;
  }
  var c=FC.queue[FC.i], st=P.cards[c.id]||{box:1};
  s+='<div class="fcstage">';
  s+='<div class="fc"><div class="side">'+esc(c.modTitle||"")+(c.tag?' &middot; '+esc(c.tag):'')+'</div>';
  s+='<div class="front">'+inl(c.front)+'</div>';
  s+= FC.shown ? '<div class="back reveal">'+inl(c.back)+'</div>' : '';
  s+='</div>';
  s+='<div class="boxrow">'+[1,2,3,4,5].map(function(b){return '<span class="boxpip" data-on="'+((st.box||1)>=b?1:0)+'"></span>';}).join("")+'</div>';
  s+='<div class="fcbar">';
  s+= FC.shown
    ? '<button class="btn" id="fcmiss">Missed it</button><button class="btn btn-primary" id="fcgot">Got it</button>'
    : '<button class="btn btn-primary" id="fcshow">Show the answer</button>';
  s+='<button class="btn btn-ghost" id="fcskip">Skip</button>';
  s+='</div>';
  s+='<div class="fcmeta"><span>'+(FC.i+1)+' of '+FC.queue.length+' due</span><span>box '+(st.box||1)+' of 5</span></div>';
  s+='</div></div>';
  return s;
}
function fcNext(){ FC.i++; FC.shown=false; if(FC.i>=FC.queue.length){ FC.queue=[]; } render(); }
function wireCards(){
  var b;
  if((b=$("#fcshow"))) b.addEventListener("click", function(){ FC.shown=true; render(); });
  if((b=$("#fcskip"))) b.addEventListener("click", fcNext);
  if((b=$("#fcall"))) b.addEventListener("click", function(){ FC.queue=shuffled(allCards()); FC.i=0; FC.shown=false; render(); });
  if((b=$("#fcgot"))) b.addEventListener("click", function(){
    var c=FC.queue[FC.i], st=P.cards[c.id]||{box:1,lapses:0};
    st.box=Math.min(5,(st.box||1)+1); st.due=today()+IVL[st.box-1]; P.cards[c.id]=st; save(); fcNext();
  });
  if((b=$("#fcmiss"))) b.addEventListener("click", function(){
    var c=FC.queue[FC.i], st=P.cards[c.id]||{box:1,lapses:0};
    st.box=1; st.due=today(); st.lapses=(st.lapses||0)+1; P.cards[c.id]=st; save(); fcNext();
  });
}

/* ============================================================
   MOCK EXAMS  (untimed by design)
   ============================================================ */
var EX={id:null, order:[], i:0, submitted:false, res:null};
function viewExams(){
  var s='<div class="wrap-wide"><div class="mhead"><div class="no">Practice</div><h1>Mock exams</h1>';
  s+='<p class="sub">Full-length, and deliberately untimed. The real PSPO I gives you 60 minutes for 80 questions and asks for 85 percent, which is 68 right. Here you get the same questions with none of the clock.</p></div>';
  s+='<div class="exgrid">';
  EXAMS.forEach(function(x){
    var atts=(P.exams.attempts||[]).filter(function(a){return a.id===x.id;});
    var best=null; atts.forEach(function(a){ if(!best||a.score>best.score) best=a; });
    s+='<div class="excard"><h3>'+esc(x.title)+'</h3><p class="desc">'+esc(x.desc||"")+'</p>';
    s+='<div style="display:flex;gap:7px;flex-wrap:wrap"><span class="chip">'+(x.questions||[]).length+' questions</span><span class="chip">no time limit</span><span class="chip">pass at 85%</span></div>';
    s+='<div class="exbest">'+(best?("best "+best.score+" of "+best.total+", "+Math.round(best.score/best.total*100)+"%"):"not attempted")+'</div>';
    s+='<div><button class="btn btn-primary" data-go="exam" data-arg="'+esc(x.id)+'">'+(atts.length?"Take it again":"Start")+'</button></div></div>';
  });
  s+='</div>';
  var atts=P.exams.attempts||[];
  if(atts.length){
    s+='<div class="sec-h"><h2>Your attempts</h2><span class="rule"></span></div><div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable">';
    s+='<thead><tr><th>Exam</th><th>Score</th><th>Percent</th><th>Verdict</th><th>When</th></tr></thead><tbody>';
    atts.slice().reverse().forEach(function(a){
      var pc=Math.round(a.score/a.total*100);
      s+='<tr><td>'+esc(a.title||a.id)+'</td><td class="n">'+a.score+' / '+a.total+'</td><td class="n">'+pc+'%</td>'
       + '<td>'+(pc>=85?'<span class="chip chip-ok">pass</span>':'<span class="chip chip-bad">below 85%</span>')+'</td>'
       + '<td class="n">'+new Date(a.at).toLocaleDateString()+'</td></tr>';
    });
    s+='</tbody></table></div>';
  }
  s+='</div>';
  return s;
}
function viewExamRun(id){
  var x=EXAMS.filter(function(e){return e.id===id;})[0];
  if(!x) return empty("That exam is not here yet.");
  if(EX.id!==id || (EX.submitted && EX.res===null)){
    EX={id:id, order:x.questions.map(function(_,i){return i;}), i:0, submitted:false, res:null};
    x.questions.forEach(function(q){ QS[q.id]={picked:isMulti(q)?[]:null, done:false}; });
  }
  if(EX.submitted) return viewExamResult(x);
  var q=x.questions[EX.order[EX.i]];
  var s='<div class="wrap"><div class="mhead" style="border-bottom-width:1px;padding-bottom:14px;margin-bottom:22px">';
  s+='<div class="no">'+esc(x.title)+' &middot; question '+(EX.i+1)+' of '+x.questions.length+' &middot; no time limit</div></div>';
  s+='<div class="exdots">'+x.questions.map(function(qq,i){
      var st=QS[qq.id]||{};
      return '<button class="exdot" data-jump="'+i+'" data-ans="'+(answered(qq,st)&&st.picked!=null?1:0)+'" aria-current="'+(i===EX.i)+'">'+(i+1)+'</button>';
    }).join("")+'</div>';
  s+=renderQ(q,{n:EX.i+1, exam:true});
  var done=x.questions.filter(function(qq){var st=QS[qq.id]||{};return st.picked!=null && (!isMulti(qq)||st.picked.length);}).length;
  s+='<div class="exnav">';
  s+='<button class="btn" id="exprev"'+(EX.i===0?" disabled":"")+'>Previous</button>';
  s+='<button class="btn" id="exnext"'+(EX.i===x.questions.length-1?" disabled":"")+'>Next</button>';
  s+='<span class="spacer" style="flex:1"></span>';
  s+='<span class="chip">'+done+' of '+x.questions.length+' answered</span>';
  s+='<button class="btn btn-primary" id="exsub">Submit exam</button>';
  s+='</div></div>';
  return s;
}
function markExamAnswered(qid){
  var d=$('.exdot[data-jump]'); if(!d) return;
  var x=EXAMS.filter(function(e){return e.id===EX.id;})[0]; if(!x) return;
  var i=x.questions.map(function(q){return q.id;}).indexOf(qid);
  var el=$('.exdot[data-jump="'+i+'"]'); if(el) el.setAttribute("data-ans","1");
}
function wireExam(){
  var b;
  if((b=$("#exprev"))) b.addEventListener("click", function(){ if(EX.i>0){EX.i--; render();} });
  if((b=$("#exnext"))) b.addEventListener("click", function(){ EX.i++; render(); });
  $$(".exdot").forEach(function(d){ d.addEventListener("click", function(){ EX.i=+d.getAttribute("data-jump"); render(); }); });
  if((b=$("#exsub"))) b.addEventListener("click", function(){
    var x=EXAMS.filter(function(e){return e.id===EX.id;})[0];
    var unanswered=x.questions.filter(function(q){var st=QS[q.id]||{};return !(st.picked!=null && (!isMulti(q)||st.picked.length));}).length;
    if(unanswered && !confirm(unanswered+" question"+(unanswered===1?" is":"s are")+" still blank. Those count as wrong. Submit anyway?")) return;
    submitExam(x);
  });
  $$("#exback,[data-retry]").forEach(function(el){ el.addEventListener("click", function(){ EX={id:null,order:[],i:0,submitted:false,res:null}; go("exams"); }); });
}
function submitExam(x){
  var score=0, tags={}, missed=[];
  x.questions.forEach(function(q){
    var st=QS[q.id]||{picked:null};
    var ok = (st.picked!=null && (!isMulti(q)||st.picked.length)) ? gradeQ(q,st) : false;
    st.done=true;
    if(!tags[q.tag]) tags[q.tag]={ok:0,n:0};
    tags[q.tag].n++; if(ok){score++; tags[q.tag].ok++;} else { missed.push(q.id); P.exams.missed[q.id]={examId:x.id, picked:st.picked}; }
  });
  P.exams.attempts.push({id:x.id, title:x.title, score:score, total:x.questions.length, at:Date.now(), tags:tags});
  save();
  EX.submitted=true; EX.res={score:score, tags:tags, missed:missed};
  render();
}
function viewExamResult(x){
  var r=EX.res, pc=Math.round(r.score/x.questions.length*100), pass=pc>=85;
  var s='<div class="wrap">';
  s+='<div class="scoreband '+(pass?"pass":"fail")+'"><div class="lbl">'+esc(x.title)+' result</div>';
  s+='<div class="big">'+pc+'%</div>';
  s+='<p style="margin-top:10px">'+r.score+' of '+x.questions.length+' correct. PSPO I asks for 85 percent, which is '+(x.pass||68)+' right.</p>';
  s+='<p style="margin-top:8px" class="muted">'+(pass?"That is a passing score on this attempt. Do it again on the other exam before you book.":"Not there yet. The tags below show where the gap is, and every miss is now in your mistake log.")+'</p></div>';
  s+='<div class="sec-h"><h2>By topic</h2><span class="rule"></span></div><div class="tagbars">';
  Object.keys(r.tags).sort().forEach(function(t){
    var d=r.tags[t], p=Math.round(d.ok/d.n*100);
    s+='<div class="tagbar"><span>'+esc(t)+'</span><span class="tb"><span class="tf" style="width:'+p+'%;background:'+(p>=85?"var(--ok)":(p>=60?"var(--spark)":"var(--bad)"))+'"></span></span><span class="tn">'+d.ok+'/'+d.n+'</span></div>';
  });
  s+='</div>';
  s+='<div class="sec-h"><h2>Every question, with the reasoning</h2><span class="rule"></span></div>';
  s+='<div class="qlist">';
  x.questions.forEach(function(q,i){ var st=QS[q.id]; st.done=true; s+=renderQ(q,{n:i+1}); });
  s+='</div>';
  s+='<div class="modfoot"><button class="btn btn-primary" data-retry="1">Back to exams</button><button class="btn" data-go="misses">Open mistake log</button></div>';
  s+='</div>';
  return s;
}

/* ============================================================
   DRILL
   ============================================================ */
var DR={q:null, pool:[], tag:"all"};
function drillPool(){
  var out=[];
  MODS.forEach(function(m){ (m.quiz||[]).forEach(function(q){ out.push(q); }); (m.beats||[]).forEach(function(b){ if(b.type==="check"&&b.q) out.push(b.q); }); });
  if(DR.tag!=="all") out=out.filter(function(q){return q.tag===DR.tag;});
  return out;
}
function viewDrill(){
  var pool=drillPool();
  var tags={}; drillPool.all=null;
  MODS.forEach(function(m){ (m.quiz||[]).forEach(function(q){ if(q.tag) tags[q.tag]=(tags[q.tag]||0)+1; }); });
  var s='<div class="wrap"><div class="mhead"><div class="no">Practice</div><h1>Question drill</h1>';
  s+='<p class="sub">Every question from every module, one at a time, in random order. No clock, no score to defend. Answer, read the reasoning, move on.</p></div>';
  s+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">';
  s+='<button class="btn btn-sm'+(DR.tag==="all"?" btn-primary":"")+'" data-tag="all">Everything ('+drillPool().length+')</button>';
  Object.keys(tags).sort().forEach(function(t){
    s+='<button class="btn btn-sm'+(DR.tag===t?" btn-primary":"")+'" data-tag="'+esc(t)+'">'+esc(t)+' ('+tags[t]+')</button>';
  });
  s+='</div>';
  if(!pool.length){ s+=empty("No questions with that tag yet."); return s+'</div>'; }
  if(!DR.q || pool.indexOf(DR.q)<0) DR.q=pool[Math.floor(Math.random()*pool.length)];
  QS[DR.q.id]={picked:isMulti(DR.q)?[]:null, done:false};
  s+=renderQ(DR.q,{});
  s+='<div class="modfoot"><button class="btn btn-primary" id="drnext">Another question</button></div></div>';
  return s;
}
function wireDrill(){
  $$("[data-tag]").forEach(function(b){ b.addEventListener("click", function(){ DR.tag=b.getAttribute("data-tag"); DR.q=null; render(); }); });
  var n=$("#drnext"); if(n) n.addEventListener("click", function(){ DR.q=null; render(); });
}

/* ============================================================
   MISTAKE LOG
   ============================================================ */
function missedList(){
  var out=[];
  Object.keys(P.quiz).forEach(function(qid){ if(!P.quiz[qid].ok && QIDX[qid]) out.push({q:QIDX[qid], from:"module"}); });
  Object.keys(P.exams.missed||{}).forEach(function(qid){ if(QIDX[qid]) out.push({q:QIDX[qid], from:"exam"}); });
  var seen={};
  return out.filter(function(m){ if(seen[m.q.id]) return false; seen[m.q.id]=true; return true; });
}
function viewMisses(){
  var list=missedList();
  var s='<div class="wrap"><div class="mhead"><div class="no">Practice</div><h1>Mistake log</h1>';
  s+='<p class="sub">Everything you have gotten wrong, with the reasoning and the Scrum Guide section that settles it. This is the highest value page in the course in the week before your exam.</p></div>';
  if(!list.length) return s+empty("Nothing here yet","Answer some questions and anything you miss will collect here.")+'</div>';
  var byTag={}; list.forEach(function(m){ var t=m.q.tag||"other"; (byTag[t]=byTag[t]||[]).push(m); });
  s+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px"><span class="chip chip-bad">'+list.length+' to fix</span>';
  Object.keys(byTag).sort().forEach(function(t){ s+='<span class="chip">'+esc(t)+' '+byTag[t].length+'</span>'; });
  s+='<button class="btn btn-sm" id="dlmiss" style="margin-left:auto">Save as a file</button></div>';
  Object.keys(byTag).sort().forEach(function(t){
    s+='<div class="wk-lbl" style="margin-top:22px">'+esc(t)+'</div>';
    byTag[t].forEach(function(m){
      s+='<div class="mistake"><div class="mmeta"><span class="chip">'+esc(m.q.id)+'</span><span class="chip">'+esc(m.from)+'</span></div>';
      s+='<div class="mq">'+inl(m.q.stem)+'</div>';
      s+='<div class="mx"><strong>'+esc(rightAnswerText(m.q))+'</strong><br>'+inl(m.q.explain||"")+(m.q.cite?'<br><span class="muted">'+esc(m.q.cite)+'</span>':'')+'</div></div>';
    });
  });
  return s+'</div>';
}
function rightAnswerText(q){
  if(q.kind==="tf") return "Correct answer: "+(q.answer?"True":"False");
  if(isMulti(q)) return "Correct answers: "+(q.answer||[]).map(function(i){return String.fromCharCode(65+i);}).join(", ");
  if(q.kind==="order"||q.kind==="sort") return "See the module for the correct arrangement.";
  return "Correct answer: "+String.fromCharCode(65+q.answer);
}
function wireMisses(){
  var b=$("#dlmiss"); if(!b) return;
  b.addEventListener("click", function(){
    var list=missedList();
    var lines=["THE ORDERED LIST", "Mistake log, exported "+new Date().toLocaleDateString(), "", list.length+" questions to fix", ""];
    list.forEach(function(m,i){
      lines.push((i+1)+". ["+(m.q.tag||"")+"] "+m.q.stem);
      if(m.q.options) m.q.options.forEach(function(o,j){ lines.push("     "+String.fromCharCode(65+j)+". "+o); });
      lines.push("   "+rightAnswerText(m.q));
      lines.push("   Why: "+(m.q.explain||""));
      if(m.q.cite) lines.push("   Source: "+m.q.cite);
      lines.push("");
    });
    var txt=lines.join("\n");
    if(!DL){ alert("Saving a file is not available in this view."); return; }
    DL.save({filename:"mistake-log.txt", data:txt}).catch(function(err){
      if(err && err.code==="declined") return;
      alert("Could not save the file.");
    });
  });
}

/* ============================================================
   QUICK REFERENCE
   ============================================================ */
function viewRef(){
  var s='<div class="wrap"><div class="mhead"><div class="no">Reference</div><h1>Quick reference</h1>';
  s+='<p class="sub">The facts the exam tests literally. If you can reproduce this page from memory, the recall half of PSPO I is handled.</p></div>';

  s+='<div class="wk-lbl">Timeboxes, for a one-month Sprint</div><div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable"><thead><tr><th>Event</th><th>Maximum</th><th>Who it is for</th></tr></thead><tbody>'
   + row("The Sprint","One month or less","The whole Scrum Team")
   + row("Sprint Planning","8 hours","The whole Scrum Team")
   + row("Daily Scrum","15 minutes","The Developers")
   + row("Sprint Review","4 hours","Scrum Team plus key stakeholders")
   + row("Sprint Retrospective","3 hours","The whole Scrum Team")
   + '</tbody></table></div><p class="muted" style="font-size:13px;margin-top:9px">For shorter Sprints, the events are usually shorter. The Daily Scrum is 15 minutes regardless of Sprint length.</p>';

  s+='<div class="wk-lbl" style="margin-top:30px">Artifacts and their commitments</div><div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable"><thead><tr><th>Artifact</th><th>Commitment</th><th>In one line</th></tr></thead><tbody>'
   + row("Product Backlog","Product Goal","An emergent, ordered list of what is needed to improve the product.")
   + row("Sprint Backlog","Sprint Goal","The Sprint Goal (why), the selected items (what), and the plan (how).")
   + row("Increment","Definition of Done","A concrete stepping stone toward the Product Goal. It must be usable.")
   + '</tbody></table></div>';

  s+='<div class="wk-lbl" style="margin-top:30px">Who is accountable for what</div><div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable"><thead><tr><th>Accountability</th><th>Accountable for</th></tr></thead><tbody>'
   + row2("Product Owner","Maximizing the value of the product resulting from the work of the Scrum Team, and effective Product Backlog management.")
   + row2("Scrum Master","Establishing Scrum as defined in the Scrum Guide, and the Scrum Team's effectiveness.")
   + row2("Developers","Creating a plan for the Sprint, instilling quality by adhering to the Definition of Done, adapting their plan each day toward the Sprint Goal, and holding each other accountable as professionals.")
   + row2("The whole Scrum Team","Creating a valuable, useful Increment every Sprint.")
   + '</tbody></table></div>';

  s+='<div class="wk-lbl" style="margin-top:30px">Decisions that belong to exactly one party</div><div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable"><thead><tr><th>Decision</th><th>Belongs to</th></tr></thead><tbody>'
   + row2("Ordering the Product Backlog","Product Owner")
   + row2("Cancelling a Sprint","Product Owner, and only the Product Owner")
   + row2("Sizing Product Backlog items","The Developers who will do the work")
   + row2("How many items enter the Sprint","The Developers, in discussion with the Product Owner")
   + row2("How the work gets turned into an Increment","The Developers, at their sole discretion")
   + row2("The Sprint Goal","Crafted by the whole Scrum Team, and it is a commitment by the Developers")
   + row2("The Definition of Done","The organization if it has a standard, otherwise the Scrum Team")
   + '</tbody></table></div>';

  s+='<div class="wk-lbl" style="margin-top:30px">Theory, pillars, values</div>';
  s+='<div class="tblwrap" tabindex="0" role="region" aria-label="Scrollable table"><table class="reftable"><tbody>'
   + row2("Founded on","Empiricism and lean thinking")
   + row2("Three pillars","Transparency, Inspection, Adaptation")
   + row2("Five values","Commitment, Focus, Openness, Respect, Courage")
   + row2("Scrum Team size","Typically 10 or fewer people")
   + row2("The framework is","Lightweight, simple to understand, and purposefully incomplete")
   + '</tbody></table></div>';

  if((D.glossary||[]).length){
    s+='<div class="sec-h" style="margin-top:40px"><h2>Glossary</h2><span class="rule"></span></div><dl class="glossary">';
    D.glossary.forEach(function(g){
      s+='<div class="gitem"><dt>'+esc(g.term)+'</dt><dd>'+inl(g.def)+(g.src?'<div class="src">'+esc(g.src)+'</div>':'')+'</dd></div>';
    });
    s+='</dl>';
  }
  return s+'</div>';
}
function row(a,b,c){ return '<tr><td>'+esc(a)+'</td><td class="n">'+esc(b)+'</td><td>'+esc(c)+'</td></tr>'; }
function row2(a,b){ return '<tr><td style="width:34%"><strong>'+esc(a)+'</strong></td><td>'+esc(b)+'</td></tr>'; }

/* ============================================================
   COACH
   ============================================================ */
var GUIDE_FACTS = [
"Scrum is a lightweight framework that helps people, teams and organizations generate value through adaptive solutions for complex problems. It is founded on empiricism and lean thinking. Pillars: transparency, inspection, adaptation. Values: Commitment, Focus, Openness, Respect, Courage. The framework is purposefully incomplete.",
"Scrum Team: one Scrum Master, one Product Owner, and Developers. No sub-teams or hierarchies. Typically 10 or fewer people. Cross-functional and self-managing. The entire Scrum Team is accountable for creating a valuable, useful Increment every Sprint. Multiple teams on one product share the same Product Goal, Product Backlog and Product Owner.",
"Product Owner: accountable for maximizing the value of the product resulting from the work of the Scrum Team. Also accountable for effective Product Backlog management, which includes developing and explicitly communicating the Product Goal, creating and clearly communicating Product Backlog items, ordering Product Backlog items, and ensuring the Product Backlog is transparent, visible and understood. May delegate the work but remains accountable. Is one person, not a committee. For Product Owners to succeed the entire organization must respect their decisions. Only the Product Owner has the authority to cancel a Sprint.",
"Developers: accountable for creating a plan for the Sprint (the Sprint Backlog), instilling quality by adhering to a Definition of Done, adapting their plan each day toward the Sprint Goal, and holding each other accountable as professionals. The Developers who will be doing the work are responsible for the sizing.",
"Scrum Master: accountable for establishing Scrum as defined in the Scrum Guide, and for the Scrum Team's effectiveness. Serves the Scrum Team, the Product Owner, and the organization.",
"Events: the Sprint is a container for the other four. Sprint Planning (max 8 hours for a one-month Sprint) covers why this Sprint is valuable, what can be Done, and how the work will get done; the Sprint Goal must be finalized before Sprint Planning ends; topic three is at the sole discretion of the Developers. Daily Scrum is 15 minutes, for the Developers; the Product Owner or Scrum Master attend as Developers only if they are actively working on Sprint Backlog items. Sprint Review (max 4 hours) is the second to last event and is a working session, not a presentation. Sprint Retrospective (max 3 hours) concludes the Sprint.",
"The Sprint: fixed length, one month or less. A new Sprint starts immediately after the previous one concludes. During the Sprint no changes are made that would endanger the Sprint Goal, quality does not decrease, the Product Backlog is refined as needed, and scope may be clarified and renegotiated with the Product Owner as more is learned.",
"Product Backlog: an emergent, ordered list of what is needed to improve the product, and the single source of work undertaken by the Scrum Team. Refinement is an ongoing activity, not an event. Items that can be Done within one Sprint are deemed ready for selection.",
"Product Goal: the long-term objective for the Scrum Team. It is in the Product Backlog. The team must fulfill or abandon one objective before taking on the next.",
"Sprint Goal: the single objective for the Sprint, created during Sprint Planning, added to the Sprint Backlog. It is a commitment by the Developers.",
"Increment: a concrete stepping stone toward the Product Goal, additive and thoroughly verified, and it must be usable. Multiple Increments may be created within a Sprint and may be delivered before the Sprint ends. The Sprint Review should never be considered a gate to releasing value. Work is not part of an Increment unless it meets the Definition of Done.",
"Definition of Done: a formal description of the state of the Increment when it meets the quality measures required for the product. If an item does not meet it, it cannot be released or even presented at the Sprint Review, and returns to the Product Backlog. If it is an organizational standard all teams follow it as a minimum.",
"NOT in the Scrum Guide 2020: user stories, story points, velocity, burndown charts as a requirement, Definition of Ready, Sprint 0, hardening Sprints, backlog grooming, the three questions in the Daily Scrum, the Product Owner accepting or signing off stories, and the Scrum Master as a manager."
].join("\n\n");

function viewCoach(){
  var s='<div class="wrap"><div class="mhead"><div class="no">Practice</div><h1>Ask the coach</h1>';
  s+='<p class="sub">Ask anything about Scrum, the Product Owner accountability, or how a rule applies to a real product decision. Answers are grounded in the Scrum Guide 2020 and will tell you when something is common practice rather than actual Scrum.</p></div>';
  s+='<div class="coach-log" id="clog">';
  if(!(P.coach||[]).length){
    s+='<div class="cmsg pc"><div class="who">Coach</div>Ask me things like: what is the difference between accountable and responsible, can I change the Sprint Backlog mid-Sprint, who decides how many items go into a Sprint, or how should I handle a stakeholder who goes around me to a developer.</div>';
  }
  (P.coach||[]).forEach(function(m){
    s+='<div class="cmsg '+(m.r==="you"?"you":"pc")+'"><div class="who">'+(m.r==="you"?"You":"Coach")+'</div>'+(m.r==="you"?esc(m.t):md(m.t))+'</div>';
  });
  s+='</div>';
  s+='<div class="askrow"><textarea class="ta" id="cin" placeholder="Ask a question"></textarea><button class="btn btn-primary" id="cask">Ask</button></div>';
  s+='<div style="margin-top:12px"><button class="btn btn-sm btn-ghost" id="cclr">Clear this conversation</button></div>';
  s+='</div>';
  return s;
}
function wireCoach(){
  var inp=$("#cin"), btn=$("#cask"), clr=$("#cclr");
  if(clr) clr.addEventListener("click", function(){ P.coach=[]; save(); render(); });
  function ask(){
    var q=(inp.value||"").trim(); if(!q) return;
    if(!SAMPLE){
      P.coach=P.coach||[]; P.coach.push({r:"you",t:q});
      P.coach.push({r:"pc",t:"**Demo mode.** In the full version this is answered by Claude, grounded in the Scrum Guide 2020 and told to flag anything that is common practice rather than actual Scrum. This public demo has no model behind it.\n\nThe **Quick reference** page covers most of what you would ask here, and every module, quiz, flashcard and mock exam works normally."});
      save(); render(); return;
    }
    P.coach=P.coach||[]; P.coach.push({r:"you",t:q}); save();
    inp.value=""; btn.disabled=true; render();
    var log=$("#clog");
    var bub=h('<div class="cmsg pc"><div class="who">Coach</div><div class="ct"><span class="spinner"></span></div></div>');
    log.appendChild(bub);
    var target=$(".ct",bub);
    var hist=(P.coach||[]).slice(-8).map(function(m){ return (m.r==="you"?"Nick: ":"Coach: ")+m.t; }).join("\n\n");
    var prompt = "You are a Scrum coach helping someone study for PSPO I. They are newer to Scrum, so define terms as you use them. The course's running example is Ledgerline, a municipal budget transparency platform sold to small towns, and Northfield, the town in the examples.\n\n"
      + "AUTHORITATIVE REFERENCE, the Scrum Guide 2020:\n" + GUIDE_FACTS + "\n\n"
      + "RULES FOR YOUR ANSWER:\n"
      + "1. Answer from the Scrum Guide 2020. If something is common practice but not in the Guide (user stories, story points, velocity, Definition of Ready and so on), say so explicitly, because PSPO I tests the Guide strictly.\n"
      + "2. Be concrete and under 250 words. Use a short example, and prefer a Northfield example (municipal finance, town clerks, auditors, ERP feeds, procurement) when one fits.\n"
      + "3. If the question has an exam trap in it, name the trap.\n"
      + "4. Never use em dashes. Use commas, colons, or parentheses.\n"
      + "5. Do not mention timing, clocks, or exam pacing.\n\n"
      + "CONVERSATION SO FAR:\n" + hist + "\n\nAnswer Nick's latest question.";
    SAMPLE(prompt, {onText:function(u){ target.innerHTML=md(u.text); }, modelTier:"default"})
      .then(function(r){ P.coach.push({r:"pc",t:r.text}); save(); btn.disabled=false; render(); })
      .catch(function(err){
        var msg = (err&&err.code==="not_granted") ? "The coach needs permission to ask Claude. Reload the page and allow it."
                : (err&&err.code==="rate_limited") ? "Too many questions at once. Give it a moment, then ask again."
                : "That did not go through. Try asking again.";
        target.innerHTML=esc(msg); btn.disabled=false;
      });
  }
  if(btn) btn.addEventListener("click", ask);
  if(inp) inp.addEventListener("keydown", function(e){ if((e.metaKey||e.ctrlKey) && e.key==="Enter") ask(); });
}

/* ============================================================
   BOOT
   ============================================================ */
function applyTheme(){
  var t=P.settings.theme;
  if(t) document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
function applyLang(){
  var b=$("#langbtn"); if(!b) return;
  b.hidden=!hasDE();
  b.textContent=langLabel();
  document.documentElement.setAttribute("lang", lang());
}
function boot(){
  indexQuestions();
  loadLocal();
  applyTheme(); applyLang();
  renderRail(); render(); setSync();

  $("#menubtn").addEventListener("click", function(){
    var r=$("#rail"); var open=r.getAttribute("data-open")==="1";
    r.setAttribute("data-open", open?"0":"1");
    if(!open){ var sc=h('<button class="scrim" aria-label="Close contents"></button>'); document.body.appendChild(sc); sc.addEventListener("click", function(){ r.setAttribute("data-open","0"); sc.remove(); }); }
    else { var s=$(".scrim"); if(s) s.remove(); }
  });
  $("#coachbtn").addEventListener("click", function(){ go("coach"); });
  $("#themebtn").addEventListener("click", function(){
    var cur=P.settings.theme;
    P.settings.theme = cur==="dark" ? "light" : (cur==="light" ? null : "dark");
    save(); applyTheme();
  });
  /* #langbtn in the rail and .langtoggle in the module header do the same thing */
  document.addEventListener("click", function(e){
    if(!e.target.closest("#langbtn, .langtoggle")) return;
    P.settings.lang = lang()==="de" ? "en" : "de";
    save(); applyLang(); renderRail(); render();
  });
  $("#resetbtn").addEventListener("click", function(){
    if(!confirm("Clear every module completion, quiz answer, flashcard box and exam attempt? This cannot be undone.")) return;
    P.done={};P.quiz={};P.sim={};P.write={};P.cards={};P.exams={attempts:[],missed:{}};P.coach=[];
    try{ localStorage.removeItem(LS); }catch(e){}
    save(); FC.queue=[]; go("home");
  });

  if(window.claude && window.claude.use){
    window.claude.use("db").then(function(d){
      if(!d) return;
      DB=d;
      return d.doc("progress/state").get().then(function(snap){
        var data = snap && snap.exists ? snap.data() : null;
        if(data){ merge(P, data); applyTheme(); applyLang(); FC.queue=[]; renderRail(); render(); }
        DBOK=true; setSync();
      });
    }).catch(function(){ DBOK=false; setSync(); });
    window.claude.use("sample").then(function(s){ if(s){ SAMPLE=s; } }).catch(function(){});
    window.claude.use("downloads").then(function(d){ if(d){ DL=d; } }).catch(function(){});
  }
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
</script>
