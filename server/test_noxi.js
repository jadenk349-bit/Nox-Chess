'use strict';
// Reuse the existing whole-page Study Board harness, including real chess rules.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let harness = fs.readFileSync(path.join(__dirname, 'test_study_education.js'), 'utf8').split('const OPENING =')[0];
harness = harness.replace("BODY.replace(/await import", "BODY.replace('clashed = isNameClash(err);', 'window.__nameError = err; clashed = isNameClash(err);').replace(/await import");
harness = harness.replace('out.doc = doc;', 'out.doc = doc; out.nameError = () => win.__nameError;');
harness = harness.replace('setAttribute(){}, getAttribute()', 'setAttribute(){}, removeAttribute(){}, getAttribute()');
harness = harness.replace('addEventListener(){}, removeEventListener(){}, focus(){}',
  'addEventListener(k, fn){ (this.events || (this.events = {}))[k] = fn; }, removeEventListener(){}, focus(){}');
harness = harness.replace('function makePage(fetchImpl){', 'function makePage(fetchImpl, savedStore){').replace('const store = {};', 'const store = savedStore || {};').replace('out.doc = doc;', 'out.doc = doc; out.store = store;');
harness = harness.replace('stateFromFEN, EDU_VERSION });',
  'stateFromFEN, EDU_VERSION, SF, STUDY, studyBuild, AUTH, NOXI, setAccount, noxiDialogue, noxiStudyText, noxiMaybeIntroduce, noxiDismiss, decideFirstScreen, showScreen, LSN, VERDICT, engineKey, REVIEW_ASK, testScreen:()=>screenName, testIdentity:(a, client) => { account=a; sb=client; }, testAccount:()=>account });');
const cases = `
(async function(){
 const p = makePage(only404);
 await wait(30);
 const writes = [];
 const client = { auth:{ updateUser:async payload => { writes.push(payload.data); return {}; } } };
 p.testIdentity({id:'returning', gameName:'Veteran'}, client);
 p.noxiMaybeIntroduce();
 eq('old named user is not enrolled', p.NOXI.owner, null);
 p.testIdentity({id:'new',gameName:'NewPlayer',noxiIntro:'pending'}, client);
 p.noxiMaybeIntroduce();
 eq('new user introduced',p.NOXI.owner,'new');
 eq('first message',p.NOXI.dialogue.message.textContent,"Hi, I'm Noxi. Welcome to Nox Chess.");
 const first = p.NOXI.dialogue;
 p.noxiMaybeIntroduce();
 ok('rerender keeps dialogue',p.NOXI.dialogue===first);
 p.NOXI.dialogue.action.click();
 eq('second message',p.NOXI.dialogue.message.textContent,'I will be your chess assistant.');
 p.NOXI.dialogue.action.click();
 eq('third message',p.NOXI.dialogue.message.textContent,"First, let's learn how to play blind chess!");
 eq('final action',p.NOXI.dialogue.action.textContent,'Start Learning');
 p.NOXI.dialogue.action.click();
 eq('completion closes',p.NOXI.owner,null);
 eq('existing lesson hub opens',p.LSN.view,'hub');
 eq('existing lessons screen opens',p.testScreen(),'lessons');
 await p.NOXI.saving;
 eq('completed persisted',writes[writes.length-1].noxi_intro,'completed');
 p.showScreen('home'); p.noxiMaybeIntroduce();
 eq('completed user stays closed',p.NOXI.owner,null);
 p.testIdentity({id:'new',gameName:'NewPlayer',noxiIntro:'pending'},client);
 p.noxiMaybeIntroduce();
 eq('local fallback suppresses stale server state',p.NOXI.owner,null);
 p.testIdentity({id:'other',gameName:'Other',noxiIntro:'pending'},client);
 p.noxiMaybeIntroduce();
 eq('state is per account',p.NOXI.owner,'other');
 p.noxiDismiss(); await p.NOXI.saving;
 p.noxiMaybeIntroduce(); eq('skip stays dismissed',p.NOXI.owner,null);
 p.testIdentity({id:'unnamed',gameName:'',noxiIntro:'pending'},client);
 p.noxiMaybeIntroduce(); eq('no intro before username',p.NOXI.owner,null);
 p.testIdentity({id:'away',gameName:'Away',noxiIntro:'pending'},client);
 p.showScreen('setup'); p.noxiMaybeIntroduce(); eq('only homepage',p.NOXI.owner,null);
 p.showScreen('home'); p.noxiMaybeIntroduce();
 p.testIdentity(null,client); p.noxiMaybeIntroduce(); eq('logout closes intro',p.NOXI.owner,null);
 const reloaded=makePage(only404,p.store); await wait(30);
 reloaded.testIdentity({id:'new',gameName:'NewPlayer',noxiIntro:'pending'},client);
 reloaded.noxiMaybeIntroduce(); eq('reload remembers completion',reloaded.NOXI.owner,null);
 const offline={auth:{updateUser:async()=>{throw new Error('offline');}}};
 p.showScreen('home'); p.testIdentity({id:'offline',gameName:'Offline',noxiIntro:'pending'},offline);
 p.noxiMaybeIntroduce(); p.noxiDismiss(); await p.NOXI.saving;
 p.noxiMaybeIntroduce(); eq('save failure does not reopen',p.NOXI.owner,null);
 // A slow seen save cannot write completion onto the next signed-in account.
 let releaseSave; const deferredWrites=[];
 const slowClient={auth:{updateUser:payload=>{deferredWrites.push(payload.data);return new Promise(resolve=>{releaseSave=resolve;});}}};
 p.testIdentity({id:'slow-user',gameName:'Slow',noxiIntro:'pending'},slowClient);
 p.noxiMaybeIntroduce(); await Promise.resolve(); await Promise.resolve();
 eq('seen save started',deferredWrites.length,1);
 p.noxiDismiss(true);
 p.testIdentity({id:'next-user',gameName:'Next'},client);
 releaseSave({}); await p.NOXI.saving;
 eq('queued completion skipped after identity change',deferredWrites.length,1);
 eq('next account not marked completed',p.testAccount().noxiIntro,undefined);
 p.showScreen('home');
 p.testIdentity({id:'queued-user',gameName:'Queued',noxiIntro:'pending'},client);
 p.noxiMaybeIntroduce();
 const countBeforeSwitch=writes.length;
 p.testIdentity({id:'another-user',gameName:'Another'},client);p.noxiMaybeIntroduce();
 await p.NOXI.saving;
 eq('queued seen save skipped after account switch',writes.length,countBeforeSwitch);
 eq('account switch dismisses old dialogue',p.NOXI.owner,null);
 // Drive the page's real username submit handler; no parallel username system.
 const nameWrites=[];
 const nameClient={rpc:async()=>({data:true}),auth:{updateUser:async p=>{nameWrites.push(p.data);return {}; }},
   from:()=>({update:()=>({eq:()=>({select:()=>({maybeSingle:async()=>({data:{display_name:'NoxiNew'}})})})})})};
 p.testIdentity({id:'signup',gameName:'',name:'Player'},nameClient); p.showScreen('name');
 p.by('gameName').value='NoxiNew';
 await p.by('nameForm').events.submit({preventDefault(){}});
 eq('username persisted with enrollment',nameWrites[0].noxi_intro,'pending');
 ok('username save reaches homepage',p.testScreen()==='home',String(p.nameError()));
 p.noxiMaybeIntroduce(); eq('real username flow opens Noxi',p.NOXI.owner,'signup');
 p.noxiDismiss(); await p.NOXI.saving;
 const rejected={...nameClient,rpc:async()=>({data:false})};
 p.testIdentity({id:'rejected',gameName:'',name:'Player'},rejected);p.showScreen('name');
 p.by('gameName').value='TakenName';await p.by('nameForm').events.submit({preventDefault(){}});
 eq('rejected username stays on name screen',p.testScreen(),'name');
 eq('rejected username does not enroll',p.testAccount().noxiIntro,undefined);
 // Real moves and all classifications: output is controlled prose, never engine text.
 const initial=p.newState();
 const developing=p.legalMoves(initial).find(m=>p.uciOf(m)==='g1f3');
 ok('quiet development explains purpose',/develop|into play/.test(p.noxiStudyText(initial,developing,p.makeMove(initial,developing),null)));
 let st=p.newState();
 for (const u of ['e2e4','e7e5','g1f3','b8c6']) {
   const m=p.legalMoves(st).find(m=>p.uciOf(m)===u), after=p.makeMove(st,m);
   for (const verdict of Object.values(p.VERDICT)) {
     const text=p.noxiStudyText(st,m,after,verdict);
     ok('short nonempty dialogue',text.length>15 && text.length<320,text);
     ok('no suggestions or numerical evaluations',!/(best|better|should|instead|suggest|evaluat|percent|%|[0-9]|[+-]\\d)/i.test(text),text);
   }
   st=after;
 }
 p.G.uci=['e2e4','e7e5']; p.G.sans=['e4','e5']; p.reviewBuild();
 const evals=[{cp:30,mate:null,best:'e2e4',pv:['e2e4']},
   {cp:300,mate:null,best:'c7c5',pv:['c7c5']},
   {cp:300,mate:null,best:'g1f3',pv:['g1f3']}];
 p.STUDY.recs=p.studyBuild({uci:p.G.uci,sans:p.G.sans},evals);
 p.REV.on=true; p.REV.ply=1; p.SF.ready=true; p.reviewRender();
 const message=p.NOXI.study.message.textContent;
 ok('first move speaks about White',/White/.test(message),message);
 p.REV.ply=2; p.reviewRender();
 ok('selected move refreshes dialogue',p.NOXI.study.message.textContent!==message);
 ok('final move explains Black move, not next nonexistent move',/Black/.test(p.NOXI.study.message.textContent));
 ok('classification still rendered',p.by('stVerdict').innerHTML.length>0);
 ok('best move still available outside Noxi',p.by('stBest').textContent==='c5');
 ok('engine suggestions stay out of Noxi',!/(c5|300|best|better|percent|%|evaluation)/i.test(p.NOXI.study.message.textContent));
 p.REV.ply=0; p.reviewRender();
 ok('initial position has no stale move',/first move/.test(p.NOXI.study.message.textContent));
 p.reviewClose(false); eq('leaving review hides study panel',p.by('studyPanel').style.display,'none');
 p.showScreen('home'); p.testIdentity({id:'recovery',gameName:'Reset',noxiIntro:'pending'},client);
 p.AUTH.recovery=true; p.noxiMaybeIntroduce();eq('password recovery is not interrupted',p.NOXI.owner,null);
 p.AUTH.recovery=false;
 console.log('Noxi: '+pass+' passed, '+fail+' failed');
 process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
`;
vm.runInNewContext(harness + cases, {require,__dirname,console,process,setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,TextEncoder,TextDecoder}, {filename:__filename});
