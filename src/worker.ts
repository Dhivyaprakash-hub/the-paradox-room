import { assignScenario, DEFAULT_SCENARIO_ID, getScenario, SCENARIOS, validateScenario } from "./scenarios.ts";
import type { Role } from "./scenarios.ts";
import { projectSharedEvidence } from "./projections.ts";
import type { SharedEvidence } from "./projections.ts";

interface Env { ROOMS: DurableObjectNamespace; ASSETS: Fetcher }
type Phase = "lobby" | "investigation" | "discussion" | "timeline" | "voting" | "reveal";
type ParticipantKind = "human" | "ai";
interface Player { id:string; name:string; kind:ParticipantKind; token:string|null; role:Role|null; ready:boolean; clueIds:string[]; anomaly:string|null; connected:boolean; roomView:{id:string;look:string;title:string;text:string}|null; }
interface Event { id:string; type:string; at:number; data:Record<string,unknown>; }
interface Room { code:string; phase:Phase; players:Player[]; created:number; deadline:number|null; version:number; scenario:string; scenarioVersion:number; seed:string; votes:Record<string,string>; timelines:Record<string,string[]>; shared:SharedEvidence[]; chat:{id:string;playerId:string;name:string;text:string;at:number}[]; distortUsed:boolean; events:Event[]; }

const DURATIONS:Record<string,number>={investigation:240,discussion:120,timeline:90,voting:60};
const ROOM_TTL=24*60*60*1000;
const id=()=>crypto.randomUUID();
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
function safeName(s:unknown){return String(s||"").trim().replace(/[<>\u0000-\u001f]/g,"").slice(0,20)}
const scenarioFor=(room:Pick<Room,"scenario"|"scenarioVersion">)=>getScenario(room.scenario,room.scenarioVersion);
const roomCode=()=>Array.from(crypto.getRandomValues(new Uint32Array(6)),n=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n%32]).join("");

export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname.startsWith("/api/")){
   if(request.method!=="POST") return json({error:"POST required"},405);
   const body=await request.json().catch(()=>({})) as Record<string,unknown>;
   if(url.pathname==="/api/create"||url.pathname==="/api/join"){
    const name=safeName(body.name); if(name.length<2)return json({error:"Choose a name with at least 2 characters."},400);
    let code=String(body.code||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(url.pathname==="/api/create")code=roomCode();
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
 async load(){if(!this.room){this.room=await this.state.storage.get<Room>("room")||null;if(this.room){let migrated=false;if(!Number.isInteger(this.room.scenarioVersion)){const prior=SCENARIOS[this.room.scenario];if(!prior)throw new Error(`Cannot migrate unknown scenario ${this.room.scenario}.`);this.room.scenarioVersion=prior.version;migrated=true;}for(const player of this.room.players){if(!player.kind){player.kind="human";migrated=true;}if(player.token===undefined){player.token=null;migrated=true;}}if(migrated)await this.save();}}return this.room;}
 async save(){if(this.room)await this.state.storage.put("room",this.room);}
 publicView(r:Room,p:Player){const sc=scenarioFor(r);return {code:r.code,phase:r.phase,players:r.players.map(x=>({id:x.id,name:x.name,kind:x.kind,ready:x.ready,connected:x.connected,isYou:x.id===p.id})),deadline:r.deadline,version:r.version,voteCount:Object.keys(r.votes).length,scenario:{title:sc.title,location:sc.location},shared:projectSharedEvidence(r.shared,r.phase==="reveal"),chat:r.chat,events:r.events.slice(-30),you:{id:p.id,name:p.name,voted:!!r.votes[p.id],role:r.phase==="reveal"?p.role:undefined,room:p.roomView,clues:p.clueIds.map(cid=>{const {supports,...clue}=sc.clues.find(c=>c.id===cid)!;return clue;}),anomaly:p.anomaly?sc.anomalies.find(anomaly=>anomaly.id===p.anomaly)||null:null,ability:p.role==="distorter"?{...sc.distorterAbility,used:r.distortUsed}:null},timeline:r.phase==="timeline"?{milestones:sc.timeline.map(event=>event.text),items:sc.timeline.map(event=>event.id),submitted:!!r.timelines[p.id],order:r.timelines[p.id]||null}:undefined,result:r.phase==="reveal"?{votes:r.votes,timelines:r.timelines,distorter:r.players.find(x=>x.role==="distorter")?.name,correctTimeline:sc.timeline.map(event=>`${event.time}|${event.text}`),correctTimelineIds:sc.timeline.map(event=>event.id)}:undefined};}
 send(ws:WebSocket,type:string,data:unknown){ws.send(JSON.stringify({type,data}));}
 broadcast(){if(!this.room)return;for(const ws of this.state.getWebSockets()){const p=this.room.players.find(x=>x.token===ws.deserializeAttachment() as string);if(p)this.send(ws,"state",this.publicView(this.room,p));}}
  async fetch(req:Request):Promise<Response>{
  const u=new URL(req.url);
  if(u.pathname.startsWith("/internal/")){const b=await req.json() as {name:string;code:string};return u.pathname.endsWith("create")?this.create(b.name,b.code):this.join(b.name);}
  const r=await this.load(); if(!r)return json({error:"Room not found."},404);
  if(u.pathname.endsWith("/status"))return json({phase:r.phase,players:r.players.length});
  if(u.pathname.endsWith("/action")&&req.method==="POST"){const b=await req.json() as any;return this.action(String(b.token||""),b.action||{});}
  if(u.pathname.endsWith("/connect")&&req.headers.get("Upgrade")==="websocket"){
   const token=u.searchParams.get("token")||"",p=r.players.find(x=>x.kind==="human"&&x.token===token);if(!p)return json({error:"Invalid guest session."},401);
   const pair=new WebSocketPair();const client=pair[0],server=pair[1];server.serializeAttachment(token);this.state.acceptWebSocket(server);p.connected=true;await this.save();this.broadcast();this.send(server,"state",this.publicView(r,p));return new Response(null,{status:101,webSocket:client});
  }
  return json({error:"Not found"},404);
 }
 async create(name:string,code:string):Promise<Response>{if(await this.load())return json({error:"Room code collision. Try again."},409);const token=crypto.randomUUID()+crypto.randomUUID();const p:Player={id:id(),name,kind:"human",token,role:null,ready:false,clueIds:[],anomaly:null,connected:false,roomView:null};this.room={code,phase:"lobby",players:[p],created:Date.now(),deadline:null,version:1,scenario:DEFAULT_SCENARIO_ID,scenarioVersion:SCENARIOS[DEFAULT_SCENARIO_ID].version,seed:id(),votes:{},timelines:{},shared:[],chat:[],distortUsed:false,events:[]};await this.state.storage.setAlarm(Date.now()+ROOM_TTL);await this.save();return json({code:this.room.code,token,playerId:p.id});}
 async join(name:string):Promise<Response>{const r=await this.load();if(!r)return json({error:"Room not found. Check the code."},404);if(r.phase!=="lobby")return json({error:"This game has already started."},409);if(r.players.length>=8)return json({error:"This room is full."},409);if(r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return json({error:"That name is already in this room."},409);const p:Player={id:id(),name,kind:"human",token:crypto.randomUUID()+crypto.randomUUID(),role:null,ready:false,clueIds:[],anomaly:null,connected:false,roomView:null};r.players.push(p);r.version++;await this.save();this.broadcast();return json({code:r.code,token:p.token,playerId:p.id});}
 async action(token:string,a:any):Promise<Response>{const r=await this.load();const p=r?.players.find(x=>x.kind==="human"&&x.token===token);if(!r||!p)return json({error:"Session expired. Rejoin the room."},401);
  const fail=(message:string)=>json({error:message},400);
  if(a.type==="ready"){if(r.phase!=="lobby")return fail("The lobby is closed.");p.ready=!!a.ready;}
  else if(a.type==="start"){if(p.id!==r.players[0].id)return fail("Only the room host can start the game.");if(r.phase!=="lobby")return fail("Game already started.");if(r.players.length<4)return fail("At least four players are needed.");if(!r.players.every(x=>x.ready))return fail("Everyone must be ready first.");await this.start(r);}
  else if(a.type==="share"){if(!["investigation","discussion"].includes(r.phase))return fail("Evidence cannot be shared now.");const c=scenarioFor(r).clues.find(x=>x.id===a.clueId&&p.clueIds.includes(x.id));if(!c)return fail("You do not hold that evidence.");if(r.shared.some(x=>x.owner===p.id&&x.clueId===c.id))return fail("You already shared this evidence.");r.shared.push({id:id(),owner:p.id,ownerName:p.name,clueId:c.id,title:c.title,text:c.text,time:c.time,kind:c.kind,room:c.room,displayTime:c.time});this.event(r,"evidence_shared",{by:p.name,title:c.title});}
  else if(a.type==="message"){if(!["investigation","discussion"].includes(r.phase))return fail("Discussion is closed for this phase.");const text=String(a.text||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,280);if(text.length<1)return fail("Write a message first.");const previous=[...r.chat].reverse().find(x=>x.playerId===p.id);if(previous&&Date.now()-previous.at<900)return fail("Give the room a moment before sending another message.");r.chat.push({id:id(),playerId:p.id,name:p.name,text,at:Date.now()});r.chat=r.chat.slice(-100);}
  else if(a.type==="distort"){if(p.role!=="distorter"||r.distortUsed)return fail("Your ability is unavailable.");if(!["investigation","discussion"].includes(r.phase))return fail("Your ability is no longer available.");if(a.direction!=="earlier"&&a.direction!=="later")return fail("Choose whether to shift the timestamp earlier or later.");const item=r.shared.find(x=>x.id===a.sharedId);if(!item)return fail("Choose a shared clue.");const ability=scenarioFor(r).distorterAbility;const [hh,mm]=String(item.displayTime).split(":").map(Number);const delta=(a.direction==="earlier"?-1:1)*ability.shiftMinutes;const total=(hh*60+mm+delta+1440)%1440;item.displayTime=`${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;item.distorted=true;r.distortUsed=true;this.event(r,"signal",{text:"A shared record has shifted. The archive seal is broken."});}
  else if(a.type==="advance"){if(p.id!==r.players[0].id)return fail("Only the room host can move the phase.");if(r.phase==="investigation")await this.setPhase(r,"discussion");else if(r.phase==="discussion")await this.setPhase(r,"timeline");else if(r.phase==="timeline")await this.setPhase(r,"voting");else if(r.phase==="voting"){if(Object.keys(r.votes).length!==r.players.length)return fail("Wait until everyone has voted, or let the timer close the ballots.");await this.reveal(r);}else return fail("No phase to advance.");}
  else if(a.type==="timeline"){if(r.phase!=="timeline")return fail("Timeline is not open.");const order=Array.isArray(a.order)?a.order.map(String):[];const valid=scenarioFor(r).timeline.map(event=>event.id).sort();if(order.length!==valid.length||[...order].sort().join()!=valid.join())return fail("Place each event exactly once.");r.timelines[p.id]=order;}
  else if(a.type==="vote"){if(r.phase!=="voting")return fail("Voting is closed.");if(r.votes[p.id])return fail("Your vote is already sealed.");if(!r.players.some(x=>x.id===a.targetId)||a.targetId===p.id)return fail("Choose another player.");r.votes[p.id]=a.targetId;if(Object.keys(r.votes).length===r.players.length)await this.reveal(r);}
  else return fail("Unknown action.");
  r.version++;await this.save();this.broadcast();return json({ok:true});
 }
 async start(r:Room){const sc=scenarioFor(r);validateScenario(sc);const assignments=assignScenario(sc,r.players.map(player=>player.id),r.seed);for(const player of r.players){player.role=assignments.roles[player.id];player.clueIds=assignments.clueIdsByPlayer[player.id];player.roomView=assignments.roomViewByPlayer[player.id];player.anomaly=assignments.anomalyIdByPlayer[player.id];}await this.setPhase(r,"investigation");this.event(r,"start",{scenario:sc.title});}
 async setPhase(r:Room,phase:Phase){r.phase=phase;r.deadline=Date.now()+(DURATIONS[phase]||0)*1000;if(r.deadline)await this.state.storage.setAlarm(r.deadline);this.event(r,"phase",{phase});}
 async reveal(r:Room){r.phase="reveal";r.deadline=null;await this.state.storage.setAlarm(Date.now()+ROOM_TTL);this.event(r,"reveal",{text:"The room remembers."});}
 event(r:Room,type:string,data:Record<string,unknown>){r.events.push({id:id(),type,at:Date.now(),data});r.events=r.events.slice(-100);}
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){const token=ws.deserializeAttachment() as string;let a:any;try{a=JSON.parse(String(message));}catch{return;}if(a.type==="ping"){this.send(ws,"pong",{at:Date.now()});return;}if(a.type==="action"){await this.action(token,a.action||{});}}
 async webSocketClose(ws:WebSocket){const r=await this.load();const p=r?.players.find(x=>x.token===ws.deserializeAttachment() as string);if(p){p.connected=false;await this.save();this.broadcast();}}
 async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
 async alarm(){const r=await this.load();if(!r)return;if(r.phase==="reveal"||r.phase==="lobby"){await this.state.storage.delete("room");this.room=null;for(const ws of this.state.getWebSockets())ws.close(1000,"Room expired");return;}if(!r.deadline||Date.now()<r.deadline)return;if(r.phase==="investigation")await this.setPhase(r,"discussion");else if(r.phase==="discussion")await this.setPhase(r,"timeline");else if(r.phase==="timeline")await this.setPhase(r,"voting");else if(r.phase==="voting")await this.reveal(r);r.version++;await this.save();this.broadcast();}
}
