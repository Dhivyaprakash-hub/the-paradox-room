interface Env { ROOMS: DurableObjectNamespace; ASSETS: Fetcher }
type Role = "witness" | "distorter";
type Phase = "lobby" | "investigation" | "discussion" | "timeline" | "voting" | "reveal";
interface Clue { id:string; title:string; text:string; time:string; kind:"physical"|"sensor"|"memory"; room:string; }
interface Player { id:string; name:string; token:string; role:Role|null; ready:boolean; clueIds:string[]; anomaly:string|null; connected:boolean; roomView:{look:string;title:string;text:string}|null; }
interface Event { id:string; type:string; at:number; data:Record<string,unknown>; }
interface ScenarioDefinition { id:string;title:string;location:string;truth:string[];milestones:string[];clues:Clue[];anomaly:{title:string;text:string};distort:{label:string;text:string}; }
interface Room { code:string; phase:Phase; players:Player[]; created:number; deadline:number|null; version:number; scenario:string; seed:string; votes:Record<string,string>; timelines:Record<string,string[]>; shared:Record<string,unknown>[]; chat:{id:string;playerId:string;name:string;text:string;at:number}[]; distortUsed:boolean; events:Event[]; }

const DURATIONS:Record<string,number>={investigation:240,discussion:120,timeline:90,voting:60};
const ROOM_TTL=24*60*60*1000;
const SCENARIO:ScenarioDefinition={
 id:"midnight", title:"The Last Light", location:"The Orpheum Observatory", truth:["00:11|Mara entered the archive with the brass key.","00:14|The west telescope shutter was opened.","00:18|The archive lamp lost power.","00:21|The brass key was returned to the foyer desk."], milestones:["m1","m2","m3","m4"],
 clues:[
  {id:"c1",title:"Condensation on the key",text:"A clean crescent in the dust shows the brass key was lifted from its hook, then returned with its teeth facing east.",time:"00:11",kind:"physical",room:"Foyer"},
  {id:"c2",title:"Shutter motor log",text:"The west shutter motor drew current for eleven seconds. Its manual override was untouched.",time:"00:14",kind:"sensor",room:"Dome"},
  {id:"c3",title:"Warm filament",text:"The archive lamp filament is warm, but its glass is intact. The trace cannot distinguish a switch from a circuit interruption.",time:"00:18",kind:"physical",room:"Archive"},
  {id:"c4",title:"A page torn cleanly",text:"A page was removed from the logbook. The torn fibers show the book was closed before the lamp went dark.",time:"00:17",kind:"physical",room:"Archive"},
  {id:"c5",title:"North stair echo",text:"The acoustic recorder caught two descending footsteps at 00:22. The second step was heavier.",time:"00:22",kind:"sensor",room:"North stair"},
  {id:"c6",title:"Mara's sleeve",text:"Fine brass dust clings to Mara's right cuff. She says she never entered the foyer.",time:"00:12",kind:"physical",room:"Foyer"},
  {id:"c7",title:"Cloud cover memory",text:"You remember the dome slit showing a clear sky just before the lamp failed.",time:"00:16",kind:"memory",room:"Dome"},
  {id:"c8",title:"The empty hook",text:"The brass key hook swung gently when you entered. The rest of the key board was still.",time:"00:10",kind:"memory",room:"Foyer"},
  {id:"c9",title:"Switch plate",text:"A smear of lampblack sits below the archive switch. It could be soot from the lamp—or a gloved thumb.",time:"00:19",kind:"physical",room:"Archive"},
  {id:"c10",title:"A second-hand stopped",text:"The dome clock stopped at 00:14. Its battery is fresh; the hands were pushed back into place.",time:"00:15",kind:"physical",room:"Dome"},
  {id:"c11",title:"Foyer draft",text:"A cold draft crossed the foyer from the north stair after the lamp went dark.",time:"00:20",kind:"memory",room:"Foyer"},
  {id:"c12",title:"Power panel",text:"The archive circuit was opened manually. The panel records no overload and no other room lost power.",time:"00:18",kind:"sensor",room:"Service hall"}
 ], anomaly:{title:"THE ROOM BLINKED",text:"For one impossible second, you saw the archive lamp glowing blue. It may be an environmental echo: the room sometimes fabricates memories, independent of any player."},
 distort:{label:"Temporal smear",text:"Your one use can shift a shared clue's displayed timestamp by one minute. The original record remains recoverable at the reveal. Choose your moment."}
};
// Scenario definitions are data, while the room engine owns assignment, phases and scoring.
// Adding a scenario requires an internally ordered truth, matching milestone IDs and evidence.
const SCENARIOS:Record<string,ScenarioDefinition>={ [SCENARIO.id]:SCENARIO };
const scenarioFor=(room:Pick<Room,"scenario">)=>SCENARIOS[room.scenario];
const ROOM_VIEWS=[
 {look:"prism",title:"Split prism",text:"The dome's slit fractures the same star into three faint lights. One of them moves when you do."},
 {look:"fogglass",title:"Cold glass",text:"A milky film clouds the east window. Behind it, the stars look submerged beneath black water."},
 {look:"redlamp",title:"Red filament",text:"The archive lamp burns red in your version of the room. Its shadow points toward a wall with no switch."},
 {look:"doubleshadow",title:"Double shadow",text:"Your shadow falls twice: once toward the dome, and once toward a door that is not there."},
 {look:"keymirror",title:"Mirrored hook",text:"The brass key hook appears in the foyer mirror, but the reflection is empty even when the real hook is not."},
 {look:"clockface",title:"Clock without hands",text:"The dome clock's hands have vanished. A thin circle of fresh scratches marks where they used to point."},
 {look:"starwell",title:"The star well",text:"A cold shaft of starlight reaches the floor beneath the dome. The opening is sealed from the outside."},
 {look:"copperseam",title:"Copper seam",text:"A copper line runs through the floor and stops at the archive wall. The metal is warm under your palm."}
];
const rand=(n:number)=>crypto.getRandomValues(new Uint32Array(1))[0]%n;
const id=()=>crypto.randomUUID();
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
function safeName(s:unknown){return String(s||"").trim().replace(/[<>\u0000-\u001f]/g,"").slice(0,20)}
function validateScenario(sc:ScenarioDefinition){const ids=sc.clues.map(c=>c.id);const times=sc.truth.map(x=>x.split("|")[0]);if(!sc.id||sc.truth.length<2||sc.truth.length!==sc.milestones.length||new Set(sc.milestones).size!==sc.milestones.length||new Set(ids).size!==ids.length||new Set(times).size!==times.length||times.some((t,i)=>i>0&&t<times[i-1]))throw new Error(`Scenario ${sc.id} has an inconsistent truth or evidence set.`);}

export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")){
   if(request.method!=="POST") return json({error:"POST required"},405);
   const body=await request.json().catch(()=>({})) as Record<string,unknown>;
   if(url.pathname==="/api/create"||url.pathname==="/api/join"){
    const name=safeName(body.name); if(name.length<2)return json({error:"Choose a name with at least 2 characters."},400);
    let code=String(body.code||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(url.pathname==="/api/create"){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; code=Array.from({length:6},()=>chars[rand(chars.length)]).join("");}
    if(code.length!==6)return json({error:"Enter a six-character room code."},400);
    const stub=env.ROOMS.get(env.ROOMS.idFromName(code));
    const r=await stub.fetch("https://room/internal/"+(url.pathname.endsWith("create")?"create":"join"),{method:"POST",body:JSON.stringify({name,code})});
    return new Response(r.body,r);
   }
  }
  if(url.pathname.startsWith("/socket/")){
   const code=url.pathname.split("/")[2]||"";if(!/^[A-Z0-9]{6}$/.test(code))return json({error:"Invalid room code."},400);return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  }
  return env.ASSETS.fetch(request);
 }
};

export class GameRoom {
 state:DurableObjectState; env:Env; room:Room|null=null;
 constructor(state:DurableObjectState,env:Env){this.state=state;this.env=env;}
 async load(){if(!this.room)this.room=await this.state.storage.get<Room>("room")||null;return this.room;}
 async save(){if(this.room)await this.state.storage.put("room",this.room);}
 publicView(r:Room,p:Player){const sc=scenarioFor(r);return {code:r.code,phase:r.phase,players:r.players.map(x=>({id:x.id,name:x.name,ready:x.ready,connected:x.connected,isYou:x.id===p.id})),deadline:r.deadline,version:r.version,voteCount:Object.keys(r.votes).length,scenario:{title:sc.title,location:sc.location},shared:r.shared,chat:r.chat,events:r.events.slice(-30),you:{id:p.id,name:p.name,voted:!!r.votes[p.id],role:r.phase==="reveal"?p.role:undefined,room:p.roomView,clues:p.clueIds.map(cid=>({...sc.clues.find(c=>c.id===cid)!})),anomaly:p.anomaly?sc.anomaly:null,ability:p.role==="distorter"?{...sc.distort,used:r.distortUsed}:null},timeline:r.phase==="timeline"?{milestones:sc.truth.map(x=>x.split("|")[1]),items:sc.milestones,submitted:!!r.timelines[p.id],order:r.timelines[p.id]||null}:undefined,result:r.phase==="reveal"?{votes:r.votes,timelines:r.timelines,distorter:r.players.find(x=>x.role==="distorter")?.name,correctTimeline:sc.truth}:undefined};}
 send(ws:WebSocket,type:string,data:unknown){ws.send(JSON.stringify({type,data}));}
 broadcast(){if(!this.room)return;for(const ws of this.state.getWebSockets()){const p=this.room.players.find(x=>x.token===ws.deserializeAttachment() as string);if(p)this.send(ws,"state",this.publicView(this.room,p));}}
  async fetch(req:Request):Promise<Response>{
  const u=new URL(req.url);
  if(u.pathname.startsWith("/internal/")){const b=await req.json() as {name:string;code:string};return u.pathname.endsWith("create")?this.create(b.name,b.code):this.join(b.name);}
  const r=await this.load(); if(!r)return json({error:"Room not found."},404);
  if(u.pathname.endsWith("/status"))return json({phase:r.phase,players:r.players.length});
  if(u.pathname.endsWith("/action")&&req.method==="POST"){const b=await req.json() as any;return this.action(String(b.token||""),b.action||{});}
  if(u.pathname.endsWith("/connect")&&req.headers.get("Upgrade")==="websocket"){
   const token=u.searchParams.get("token")||"",p=r.players.find(x=>x.token===token);if(!p)return json({error:"Invalid guest session."},401);
   const pair=new WebSocketPair();const client=pair[0],server=pair[1];server.serializeAttachment(token);this.state.acceptWebSocket(server);p.connected=true;await this.save();this.broadcast();this.send(server,"state",this.publicView(r,p));return new Response(null,{status:101,webSocket:client});
  }
  return json({error:"Not found"},404);
 }
 async create(name:string,code:string):Promise<Response>{if(await this.load())return json({error:"Room code collision. Try again."},409);const token=crypto.randomUUID()+crypto.randomUUID();const p:Player={id:id(),name,token,role:null,ready:false,clueIds:[],anomaly:null,connected:false,roomView:null};this.room={code,phase:"lobby",players:[p],created:Date.now(),deadline:null,version:1,scenario:SCENARIO.id,seed:id(),votes:{},timelines:{},shared:[],chat:[],distortUsed:false,events:[]};await this.state.storage.setAlarm(Date.now()+ROOM_TTL);await this.save();return json({code:this.room.code,token,playerId:p.id});}
 async join(name:string):Promise<Response>{const r=await this.load();if(!r)return json({error:"Room not found. Check the code."},404);if(r.phase!=="lobby")return json({error:"This game has already started."},409);if(r.players.length>=8)return json({error:"This room is full."},409);if(r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return json({error:"That name is already in this room."},409);const p:Player={id:id(),name,token:crypto.randomUUID()+crypto.randomUUID(),role:null,ready:false,clueIds:[],anomaly:null,connected:false,roomView:null};r.players.push(p);r.version++;await this.save();this.broadcast();return json({code:r.code,token:p.token,playerId:p.id});}
 async action(token:string,a:any):Promise<Response>{const r=await this.load();const p=r?.players.find(x=>x.token===token);if(!r||!p)return json({error:"Session expired. Rejoin the room."},401);
  const fail=(message:string)=>json({error:message},400);
  if(a.type==="ready"){if(r.phase!=="lobby")return fail("The lobby is closed.");p.ready=!!a.ready;}
  else if(a.type==="start"){if(p.id!==r.players[0].id)return fail("Only the room host can start the game.");if(r.phase!=="lobby")return fail("Game already started.");if(r.players.length<4)return fail("At least four players are needed.");if(!r.players.every(x=>x.ready))return fail("Everyone must be ready first.");await this.start(r);}
  else if(a.type==="share"){if(!["investigation","discussion"].includes(r.phase))return fail("Evidence cannot be shared now.");const c=scenarioFor(r).clues.find(x=>x.id===a.clueId&&p.clueIds.includes(x.id));if(!c)return fail("You do not hold that evidence.");if(r.shared.some(x=>x.owner===p.id&&x.clueId===c.id))return fail("You already shared this evidence.");r.shared.push({id:id(),owner:p.id,ownerName:p.name,clueId:c.id,title:c.title,text:c.text,time:c.time,kind:c.kind,room:c.room,displayTime:c.time});this.event(r,"evidence_shared",{by:p.name,title:c.title});}
  else if(a.type==="message"){if(!["investigation","discussion"].includes(r.phase))return fail("Discussion is closed for this phase.");const text=String(a.text||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,280);if(text.length<1)return fail("Write a message first.");const previous=[...r.chat].reverse().find(x=>x.playerId===p.id);if(previous&&Date.now()-previous.at<900)return fail("Give the room a moment before sending another message.");r.chat.push({id:id(),playerId:p.id,name:p.name,text,at:Date.now()});r.chat=r.chat.slice(-100);}
  else if(a.type==="distort"){if(p.role!=="distorter"||r.distortUsed)return fail("Your ability is unavailable.");if(!["investigation","discussion"].includes(r.phase))return fail("Your ability is no longer available.");const item=r.shared.find(x=>x.id===a.sharedId);if(!item)return fail("Choose a shared clue.");const [hh,mm]=String(item.displayTime).split(":").map(Number);const total=(hh*60+mm+(a.direction==="earlier"?-1:1)+1440)%1440;item.displayTime=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;item.distorted=true;r.distortUsed=true;this.event(r,"signal",{text:"A shared record has shifted. The archive seal is broken."});}
  else if(a.type==="advance"){if(p.id!==r.players[0].id)return fail("Only the room host can move the phase.");if(r.phase==="investigation")await this.setPhase(r,"discussion");else if(r.phase==="discussion")await this.setPhase(r,"timeline");else if(r.phase==="timeline")await this.setPhase(r,"voting");else if(r.phase==="voting"){if(Object.keys(r.votes).length!==r.players.length)return fail("Wait until everyone has voted, or let the timer close the ballots.");await this.reveal(r);}else return fail("No phase to advance.");}
  else if(a.type==="timeline"){if(r.phase!=="timeline")return fail("Timeline is not open.");const order=Array.isArray(a.order)?a.order.map(String):[];const valid=[...scenarioFor(r).milestones].sort();if(order.length!==valid.length||[...order].sort().join()!=valid.join())return fail("Place each event exactly once.");r.timelines[p.id]=order;}
  else if(a.type==="vote"){if(r.phase!=="voting")return fail("Voting is closed.");if(r.votes[p.id])return fail("Your vote is already sealed.");if(!r.players.some(x=>x.id===a.targetId)||a.targetId===p.id)return fail("Choose another player.");r.votes[p.id]=a.targetId;if(Object.keys(r.votes).length===r.players.length)await this.reveal(r);}
  else return fail("Unknown action.");
  r.version++;await this.save();this.broadcast();return json({ok:true});
 }
 async start(r:Room){const sc=scenarioFor(r);validateScenario(sc);const list=[...r.players];for(let i=list.length-1;i>0;i--){const j=rand(i+1);[list[i],list[j]]=[list[j],list[i]];}list.forEach((p,i)=>p.role=i===0?"distorter":"witness");const clues=[...sc.clues];for(let i=clues.length-1;i>0;i--){const j=rand(i+1);[clues[i],clues[j]]=[clues[j],clues[i]];}list.forEach(p=>p.clueIds=[]);clues.forEach((c,i)=>list[i%list.length].clueIds.push(c.id));const views=[...ROOM_VIEWS];for(let i=views.length-1;i>0;i--){const j=rand(i+1);[views[i],views[j]]=[views[j],views[i]];}list.forEach((p,i)=>p.roomView=views[i]);const anomalyCount=Math.min(list.length,Math.max(2,Math.round(list.length/3)));const anomalyPlayers=new Set<number>();while(anomalyPlayers.size<anomalyCount)anomalyPlayers.add(rand(list.length));list.forEach((p,i)=>p.anomaly=anomalyPlayers.has(i)?"room-blink":null);await this.setPhase(r,"investigation");this.event(r,"start",{scenario:sc.title});}
 async setPhase(r:Room,phase:Phase){r.phase=phase;r.deadline=Date.now()+(DURATIONS[phase]||0)*1000;if(r.deadline)await this.state.storage.setAlarm(r.deadline);this.event(r,"phase",{phase});}
 async reveal(r:Room){r.phase="reveal";r.deadline=null;await this.state.storage.setAlarm(Date.now()+ROOM_TTL);this.event(r,"reveal",{text:"The room remembers."});}
 event(r:Room,type:string,data:Record<string,unknown>){r.events.push({id:id(),type,at:Date.now(),data});r.events=r.events.slice(-100);}
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){const token=ws.deserializeAttachment() as string;let a:any;try{a=JSON.parse(String(message));}catch{return;}if(a.type==="ping"){this.send(ws,"pong",{at:Date.now()});return;}if(a.type==="action"){await this.action(token,a.action||{});}}
 async webSocketClose(ws:WebSocket){const r=await this.load();const p=r?.players.find(x=>x.token===ws.deserializeAttachment() as string);if(p){p.connected=false;await this.save();this.broadcast();}}
 async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
 async alarm(){const r=await this.load();if(!r)return;if(r.phase==="reveal"||r.phase==="lobby"){await this.state.storage.delete("room");this.room=null;for(const ws of this.state.getWebSockets())ws.close(1000,"Room expired");return;}if(!r.deadline||Date.now()<r.deadline)return;if(r.phase==="investigation")await this.setPhase(r,"discussion");else if(r.phase==="discussion")await this.setPhase(r,"timeline");else if(r.phase==="timeline")await this.setPhase(r,"voting");else if(r.phase==="voting")await this.reveal(r);r.version++;await this.save();this.broadcast();}
}
