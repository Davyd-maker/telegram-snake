// Сквозная проверка API на живом сервере с тестовой БД (НЕ на боевой!): игроки 3001–3003 создаются в базе.
// Запуск: сервер с BOT_TOKEN=<тестовый> и пустой БД, затем  API_URL=http://127.0.0.1:3000 BOT_TOKEN=<тот же> npm run test:api
const crypto=require("crypto"); const E=require("../public/engine.js");
const BASE=process.env.API_URL||"http://127.0.0.1:3000", TOKEN=process.env.BOT_TOKEN; let fails=0;
const ok=(c,m,x)=>{ if(!c){fails++;console.log("  ✗",m,x!==undefined?JSON.stringify(x).slice(0,300):"")} else console.log("  ✓",m) };
function initData(user,age=0){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify(user)});const dcs=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");const sk=crypto.createHmac("sha256","WebAppData").update(TOKEN).digest();p.set("hash",crypto.createHmac("sha256",sk).update(dcs).digest("hex"));return p.toString();}
const U=(id,name,age)=>({id,init:initData({id,first_name:name},age)});
async function call(u,m,path,body){const r=await fetch(BASE+path,{method:m,headers:{"Content-Type":"application/json",...(u?{"X-Telegram-Init-Data":u.init}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json().catch(()=>null)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// жадный бот: идёт к еде, избегая смерти на 1 ход вперёд
function bot(g){ const h=g.snake[0], f=g.food; const opts=E.DIRS.map(([x,y])=>({x,y})).filter(d=>!(d.x===-g.dir.x&&d.y===-g.dir.y));
  const safe=d=>{const nx=h.x+d.x, ny=h.y+d.y; if(g.cfg.mode!=="nowalls"&&(nx<0||ny<0||nx>=E.N||ny>=E.N))return false; const X=(nx+E.N)%E.N,Y=(ny+E.N)%E.N; if(g.rockSet[Y*E.N+X])return false; const t=g.snake[g.snake.length-1]; if(g.occ[Y*E.N+X]&&!(t.x===X&&t.y===Y&&g.pendingGrowth<=0))return false; return true;};
  const s=opts.filter(safe); if(!s.length) return null; s.sort((a,b)=>(Math.abs(h.x+a.x-f.x)+Math.abs(h.y+a.y-f.y))-(Math.abs(h.x+b.x-f.x)+Math.abs(h.y+b.y-f.y))); return s[0]; }
async function playRun(u, body, maxTicks=400, cheat){
  const r=await call(u,"POST","/api/run",body); if(!r.data?.token) return {r};
  const g=new E.Game(r.data.cfg);
  while(!g.over&&g.ticks<maxTicks){ const d=bot(g); if(d&&(d.x!==g.dir.x||d.y!==g.dir.y)) g.setdir(d.x,d.y); g.tick(); }
  const res=g.result();
  if(!cheat) await sleep(Math.max(0,res.gameTime-130*g.log.length-2000)+200);
  const log=E.encodeLog(g.log);
  const s=await call(u,"POST","/api/score",{token:r.data.token,log:cheat==="log"?log.replace(/^\d+/,"1"):log,ticks:res.ticks});
  return {r,g,res,s};
}
(async()=>{
  const A=U(3001,"Ann"), B=U(3002,"Ben"), old=U(3003,"Old",90000);
  console.log("• initData"); let x=await call(old,"GET","/api/me"); ok(x.status===401&&x.data.expired,"просроченная подпись отклонена",x);
  x=await call(A,"GET","/api/me"); ok(x.status===200,"me");
  console.log("• забег классика: сервер переигрывает и считает сам");
  let t=await playRun(A,{mode:"classic",diff:"normal",artifact:"magnet"},300);
  ok(t.s.status===200&&t.s.data.result.score===t.res.score&&t.res.score>0,`очки совпали: клиент ${t.res.score}, сервер ${t.s.data?.result?.score}`,t.s.data);
  ok(t.s.data?.player?.best_score===t.res.score,"рекорд сохранён");
  const gid=t.s.data?.result?.game_id; ok(!!gid,"game_id для дуэли");
  console.log("• защита");
  t=await playRun(A,{mode:"classic"},200,"fast"); ok(t.s.status===400&&t.s.data.reason==="too_fast","слишком быстрый забег отклонён",t.s.data);
  const r1=await call(A,"POST","/api/run",{}); const s1=await call(A,"POST","/api/score",{token:r1.data.token,log:"",ticks:10}); const s2=await call(A,"POST","/api/score",{token:r1.data.token,log:"",ticks:10});
  ok(s2.status===409,"повторная отправка токена отклонена",s2);
  const s3=await call(A,"POST","/api/score",{token:r1.data.token.replace(/.$/,c=>c==="0"?"1":"0"),log:"",ticks:1}); ok(s3.status===400,"подделанный токен отклонён");
  const s4=await call(A,"POST","/api/score",{score:999,token:r1.data.token}); ok(s4.status===400&&s4.data.reload,"старый клиент без лога → просьба обновиться");
  console.log("• режимы и сложность");
  t=await playRun(A,{mode:"rocks",diff:"hard"},300); ok(t.s.status===200&&t.s.data.result.score===t.res.score&&t.res.score>0,`камни/сложная: ${t.res.score}`,t.s.data);
  ok(t.s.data.result.reward===E.reward(t.res,t.r.data.cfg,false)||t.s.data.result.is_record,"награда с множителем режима и сложности");
  x=await call(A,"GET","/api/leaderboard/mode?mode=rocks"); ok(x.data.leaderboard[0]?.score===t.res.score,"рейтинг режима «Камни»",x.data);
  t=await playRun(A,{mode:"maze",diff:"easy"},300); ok(t.s.status===200&&t.s.data.result.rated===false,"лабиринт/лёгкая — вне рейтинга");
  t=await playRun(A,{mode:"moving"},400); ok(t.s.status===200&&t.s.data.result.score===t.res.score,`живые стены: ${t.res.score}`,t.s.data);
  console.log("• челлендж дня");
  const d1=await playRun(A,{kind:"daily",mode:"rocks",diff:"hard",artifact:"magnet"},250);
  ok(d1.r.data.cfg.mode==="classic"&&d1.r.data.cfg.diff==="normal"&&!d1.r.data.cfg.artifact,"в челлендже настройки фиксированы");
  const d2=await call(B,"POST","/api/run",{kind:"daily"}); ok(d2.data.cfg.seed===d1.r.data.cfg.seed,"одно поле для всех");
  ok(d1.s.data.daily?.first&&d1.s.data.daily.bonus>0,"бонус за первый забег дня",d1.s.data.daily);
  x=await call(B,"GET","/api/daily-challenge"); ok(x.data.leaderboard.length===1,"таблица дня");
  console.log("• дуэль на том же поле");
  const ch=await call(A,"POST","/api/challenge",{game_id:gid}); ok(/^[0-9a-f]{10}$/.test(ch.data.id),"вызов по забегу");
  const cr=await call(B,"POST","/api/run",{kind:"challenge",ref:ch.data.id});
  const ar=await call(A,"POST","/api/run",{}); 
  ok(cr.data.kind==="challenge"&&cr.data.cfg.seed!==ar.data.cfg.seed,"вызов идёт по своему seed");
  const cb=await playRun(B,{kind:"challenge",ref:ch.data.id},150); ok(cb.r.data.cfg.seed===cr.data.cfg.seed&&cb.s.data.challenge_result,"результат вызова",cb.s.data.challenge_result);
  console.log("• реплей лидера сезона");
  x=await call(B,"GET","/api/replay/season"); ok(x.status===200&&x.data.name==="Ann","реплей есть",x.data&&{n:x.data.name,s:x.data.score});
  if(x.data?.log!==undefined){ const sim=E.simulate(x.data.cfg,E.parseLog(x.data.log),x.data.ticks); ok(sim.score===x.data.score,`реплей воспроизводит ${x.data.score} очков`); }
  console.log("• прокачка артефакта");
  x=await call(A,"GET","/api/me"); const coins=x.data.player.coins;
  const up=await call(A,"POST","/api/artifact/upgrade",{id:"magnet"});
  ok(coins>=3000?up.data.level===2:up.status===400,`прокачка магнита (монет ${coins})`,up.data);
  console.log("• лимиты");
  let got429=false; for(let i=0;i<45;i++){ const q=await call(B,"POST","/api/run",{}); if(q.status===429){got429=true;break;} } ok(got429,"лимит на /api/run");
  console.log(fails?`\nПРОВАЛЕНО: ${fails}`:"\nВСЕ ПРОВЕРКИ ПРОШЛИ"); process.exit(fails?1:0);
})().catch(e=>{console.error("CRASH",e);process.exit(2)});
