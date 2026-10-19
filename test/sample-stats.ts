import { computeStats, buildLeaderboard } from "../src/engine/stats.ts";
import type { ResultRow } from "../src/engine/types.ts";
// Round 1 and 2 data lifted from the workbook's Round 1/Round 2 sheets.
const R = (round:number, room:string, pos:string, team:number, sp:string, score:number, placement:number): ResultRow =>
  ({round, room, position:pos, team, speaker:sp, score, originalTeam:team, merged:false, placement, teamTotal:null});
const rows: ResultRow[] = [
 R(1,'LG29','Aff',1,'Alice',50,2),R(1,'LG29','Aff',1,'Bob',50,2),R(1,'LG29','Aff',1,'Bob',50,2),
 R(1,'LG29','Neg',2,'Cody',50,1),R(1,'LG29','Neg',2,'Devi',50,1),R(1,'LG29','Neg',2,'Edward',51,1),
 R(1,'LG28','Aff',4,'Heidi',60,2),R(1,'LG28','Aff',4,'Isabella',60,2),R(1,'LG28','Aff',4,'James',60,2),
 R(1,'LG28','Neg',3,'Francis',70,1),R(1,'LG28','Neg',3,'Georgia',70,1),R(1,'LG28','Neg',3,'Georgia',90,1),
 R(2,'LG29','Aff',2,'Cody',50,2),R(2,'LG29','Aff',2,'Devi',50,2),R(2,'LG29','Aff',2,'Edward',50,2),
 R(2,'LG29','Neg',1,'Alice',50,1),R(2,'LG29','Neg',1,'Bob',50,1),R(2,'LG29','Neg',1,'Bob',51,1),
 R(2,'LG28','Aff',3,'Francis',60,2),R(2,'LG28','Aff',3,'Georgia',60,2),R(2,'LG28','Aff',3,'Georgia',60,2),
 R(2,'LG28','Neg',4,'Heidi',70,1),R(2,'LG28','Neg',4,'Isabella',70,1),R(2,'LG28','Neg',4,'James',90,1),
];
const s = computeStats({format:'3v3', totalRounds:5, weightK:0.1, rows});
const lb = buildLeaderboard(s,[1,2],new Map());
console.log(JSON.stringify(lb.teams.map(t=>[t.rank,t.members,t.results.slice(0,2).join('/'),t.debates,t.avgTeamPoints,+t.avgSpeakerScore.toFixed(4),t.totalTeamPoints,t.drawStrength,+(t.drawDifficulty??0).toFixed(5)])));
console.log(JSON.stringify(lb.speakers.map(t=>[t.rank,t.name,t.rounds.slice(0,2).map(x=>x?x.join(' / '):null).join('|'),t.average,t.teamPoints,t.ironCount,+t.weighted.toFixed(5),t.drawStrength,+(t.drawDifficulty??0).toFixed(5),t.eligible])));
