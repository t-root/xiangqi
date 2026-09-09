const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const context = vm.createContext({});
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration' && ['takeFullCacheJob', 'cacheJobNextAttempt', 'compositeBrains', 'cacheAttemptFinished', 'cacheAttemptTerminalFailure', 'prefetchBranchComposite', 'runIndependentFullCache'].includes(node.id.name))
            vm.runInContext(match[1].slice(node.start, node.end), context);
    }
}
for (const brain of ['pikafish', 'pikafishweb', 'bruteforce', 'bruteforceweb', 'nativecombo', 'webcombo']) {
    const make = (id, attempt = 1) => ({ id, engineJobs: Object.fromEntries(context.compositeBrains(brain).map(type => [type, { attempt }])) });
    const queue = [make('A'), make('B'), make('C')], retry = [], order = [];
    const take = () => {
        const job = context.takeFullCacheJob(queue, retry, brain, job => job.id === 'A');
        if (job) order.push(job.id + ':L' + job.engineJobs[context.compositeBrains(brain)[0]].attempt);
        return job;
    };
    // A priority branch must wait for all first attempts before its second attempt.
    for (let i = 0; i < 3; i++) {
        const job = take(); Object.values(job.engineJobs).forEach(item => item.attempt++); retry.push(job);
    }
    assert.deepEqual(order, ['A:L1', 'B:L1', 'C:L1']);
    const a = take(); assert.equal(a.id, 'A');
    // A succeeds on L2 and reveals new children; they precede remaining L2 work.
    queue.push(make('D'), make('E'));
    for (let i = 0; i < 2; i++) {
        const job = take(); Object.values(job.engineJobs).forEach(item => item.attempt++); retry.push(job);
    }
    assert.deepEqual(order.slice(3), ['A:L2', 'D:L1', 'E:L1']);
    // A high-priority L3 cannot leap ahead of the remaining L2 branches.
    Object.values(a.engineJobs).forEach(item => item.attempt = 3); queue.push(a);
    for (const id of ['B', 'C', 'D', 'E']) assert.equal(take().id, id);
    assert.equal(take().id, 'A'); assert.equal(take(), null);
    // A failed dispatch retains its attempt and must not be overtaken by L2.
    queue.push(make('later', 2)); retry.push(make('failed', 1));
    assert.equal(take().id, 'failed');
    queue.length = 0; retry.length = 0;
    queue.push(make('old9', 9), make('new', 1), make('old7', 7));
    const fresh = take(); assert.equal(fresh.id, 'new');
    Object.values(fresh.engineJobs).forEach(item => item.attempt = 2); retry.push(fresh);
    assert.equal(take().id, 'new', 'Restored L7/L9 must wait for the low attempt in deferred queue');
    queue.length = 0; retry.length = 0;
    queue.push(make('unvisited', 1)); retry.push(make('A', 1));
    assert.equal(take().id, 'unvisited', 'Priority retry must not steal an unvisited same-round branch');
    console.log('PASS ' + brain + ': first sweep, dynamic children, retry rounds, priority, failed dispatch');
}

(async () => {
    for (const composite of ['nativecombo', 'webcombo']) {
        const [pika, bf] = context.compositeBrains(composite), calls = [];
        const job = { state: { board: [], side: 'red' }, budgets: {}, engineJobs: {
            [pika]: { attempt: 3 }, [bf]: { attempt: 1 }
        }};
        Object.assign(context, {
            cacheBudgetsRemaining: () => 4,
            prefetchBranchForBrain: async (_, brain) => { calls.push(brain); return false; },
            withCompositeEngineDeadline: (_, promise) => promise,
            cacheInitialTimeMsForEngine: () => 10,
            generateLegalMoves: () => [{}], hasVerifiedGuideHorizonCache: () => false,
            deferThrownCacheAttempts: () => { throw Error('Unexpected failure'); }
        });
        assert.equal(context.cacheJobNextAttempt(job, composite), 1);
        assert.equal(await context.prefetchBranchComposite(job, composite, 1, 1), false);
        assert.deepEqual(calls, [pika, bf], 'Each engine runs its own attempt without waiting for the peer round');
        job.engineJobs[bf] = { attempt: 1, status: 'READY', result: { verifiedHorizon: true } };
        assert.equal(context.cacheJobNextAttempt(job, composite), 3);
        calls.length = 0;
        await context.prefetchBranchComposite(job, composite, 1, 3);
        assert.deepEqual(calls, [pika], 'Completed peer must not restart');
        console.log('PASS ' + composite + ': mixed engine attempts are independent, completed peer stays done');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

(async()=>{
 context.setTimeout=setTimeout;
 const jobs=[{id:1,engineJobs:{}}],calls=[];
 let release;const blocked=new Promise(r=>release=r);
 const run=context.runIndependentFullCache(jobs,['pikafish','bruteforce'],()=>true,async(job,type)=>{
  calls.push(type+':'+job.id);
  if(type==='bruteforce'&&job.id===1)await blocked;
  if(type==='pikafish'&&job.id===1&&calls.filter(x=>x==='pikafish:1').length===1){job.engineJobs.pikafish={attempt:2};return false;}
  if(type==='pikafish'&&job.id===1)jobs.push({id:2,engineJobs:{}});
  return true;
 },()=>{});
 await new Promise(r=>setTimeout(r,50));
 assert(calls.includes('pikafish:2'),'Fast engine must discover and process child while peer is blocked');
 assert.equal(calls.filter(x=>x==='pikafish:1').length,2,'Fast engine must retry independently');
 release();await run;
 assert(calls.includes('bruteforce:2'),'Slow peer must receive dynamically discovered child');
 console.log('PASS Full dynamic queues: independent retry, child discovery, slow peer catches up');
})().catch(e=>{console.error(e);process.exitCode=1;});
