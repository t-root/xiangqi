const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '../xiangqi-analyzer.html'), 'utf8');

function declaration(name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated ${name}`);
}

const context = {
    console: { debug() {} },
    MAX_ENGINE_MOVETIME_MS: 2147483647,
    BRAIN_LABELS: { bruteforceweb: 'Brute-force Web' },
    cacheInitialTimeMsForEngine: () => 1000,
    guideCurrentBrain: () => 'pikafishweb',
    cloneEnginePositionState: state => state,
    buildEnginePositionState: () => ({
        stateSignature: 'state', repetitionSignature: 'rep',
        ruleSignature: 'rule', budgetSignature: 'budget'
    }),
    guidePlanByEngine: { pikafishweb: {}, bruteforceweb: {} },
    guidePlanKeyForBrain: brain => brain,
    guidePlanKey: () => 'shared',
    guidePlan: {}, guideProofPlan: {}, guideProvenFailurePlan: {}, guideProofRemember() {},
    exhaustiveCacheRunning: false, exhaustiveCacheCompleted: false,
    exhaustiveGuidePlan: {}, GUIDE_PREFETCH_CACHE_LIMIT: 100
};
vm.createContext(context);
for (const name of [
    'pikafishHorizonVerdict', 'cacheAttemptTerminalFailure', 'cacheAttemptTime', 'cacheBudgetsRemaining', 'cacheAttemptIsCurrent', 'cacheAttemptFinished',
    'cacheEngineRetryText', 'deferCacheAttempt',
    'bruteForceHorizonVerdict', 'guideCacheProofStrength', 'rememberPrefetchedGuideMove'
]) vm.runInContext(`${declaration(name)}; this.${name}=${name};`, context);

function assert(ok, message) { if (!ok) throw new Error(message); }

assert(context.bruteForceHorizonVerdict('red', 'red', 4,
    { outcomeHint: 'partial' }).status === 'PARTIAL', 'genuine partial must retry');
assert(context.bruteForceHorizonVerdict('red', 'red', 4,
    { outcomeHint: 'nomate', scoreType: 'cp', scoreVal: 0 }).status === 'PROVEN_FAIL',
    'exhausted attacking failure must terminate');
assert(context.bruteForceHorizonVerdict('black', 'red', 4,
    { outcomeHint: 'mate', scoreType: 'mate', scoreVal: -2 }).status === 'PROVEN_FAIL',
    'defense that fails before horizon must terminate');
assert(context.guideCacheProofStrength('PROVEN_HOLD', 'bruteforceweb', { horizonSafe: true }) >
    context.guideCacheProofStrength('READY_DEFENSE', 'pikafishweb', { horizonSafe: true }),
    'BF proven must outrank Pika ready');
const state = { board: [], cs: { red: 0, black: 0 } };
const move = { from: { row: 0, col: 0 }, to: { row: 1, col: 0 } };
context.rememberPrefetchedGuideMove(state, 'red', move, { red: 4, black: 4 },
    'hold', 4, true, true, 'pikafishweb', 'READY_DEFENSE');
context.rememberPrefetchedGuideMove(state, 'red', move, { red: 4, black: 4 },
    'hold', 4, false, true, 'bruteforceweb', 'PROVEN_HOLD');
assert(context.guidePlan.shared.sourceBrain === 'bruteforceweb',
    'Pika exact mate overwrote stronger BF proof');
delete context.guidePlan.shared;
context.guideProvenFailurePlan.shared = true;
context.rememberPrefetchedGuideMove(state, 'red', move, { red: 4, black: 4 },
    'hold', 4, true, true, 'pikafishweb', 'READY_DEFENSE');
assert(!context.guidePlan.shared, 'late Pika result survived BF PROVEN_FAIL tombstone');
assert(context.cacheBudgetsRemaining({ red: 0, black: 0 }) === 0, 'zero budget must remain zero');

const early = {
    engineType: 'bruteforceweb', id: 'early', stateSignature: 's', attempt: 1,
    attemptStartedNo: 1, attemptDispatchedAt: 0,
    currentTimeLimitMs: 1000, initialTimeMs: 1000, attemptDeferredNo: 0
};
assert(context.deferCacheAttempt(early, 'PARTIAL') === false, 'undispatched failure must not advance');
assert(early.attempt === 1 && early.currentTimeLimitMs === 1000, 'undispatched failure changed T');

const earlyPartial = {
    engineType: 'bruteforceweb', id: 'early-partial', stateSignature: 's', attempt: 1,
    attemptStartedNo: 1, attemptDispatchedAt: Date.now() - 100,
    currentTimeLimitMs: 1000, initialTimeMs: 1000, attemptDeferredNo: 0
};
assert(context.deferCacheAttempt(earlyPartial, 'PARTIAL') === false,
    'early engine PARTIAL must not inflate retry time');
assert(earlyPartial.attempt === 1 && earlyPartial.currentTimeLimitMs === 1000,
    'early engine PARTIAL incorrectly advanced to 2 × T');

const complete = {
    engineType: 'bruteforceweb', id: 'complete', stateSignature: 's', attempt: 1,
    attemptStartedNo: 1, attemptDispatchedAt: Date.now() - 950,
    currentTimeLimitMs: 1000, initialTimeMs: 1000, attemptDeferredNo: 0
};
assert(context.deferCacheAttempt(complete, 'PARTIAL') === true, 'full attempt must advance');
assert(complete.attempt === 2 && complete.currentTimeLimitMs === 2000, 'T did not double once');
context.deferCacheAttempt(complete, 'PARTIAL');
assert(complete.attempt === 2 && complete.currentTimeLimitMs === 2000, 'duplicate defer doubled twice');

const third = {
    engineType: 'bruteforceweb', id: 'third', stateSignature: 's', attempt: 2,
    attemptStartedNo: 2, attemptDispatchedAt: Date.now() - 1900,
    currentTimeLimitMs: 2000, initialTimeMs: 1000, attemptDeferredNo: 1
};
assert(context.deferCacheAttempt(third, 'PARTIAL') === true, 'second full attempt must advance');
assert(third.attempt === 3 && third.currentTimeLimitMs === 4000,
    'third attempt must double 2T to 4T');
for (const engineType of ['pikafish', 'pikafishweb', 'bruteforce', 'bruteforceweb']) {
    for (const [index, expected] of [5000, 10000, 20000, 40000].entries()) {
        assert(context.cacheAttemptTime({engineType, initialTimeMs:5000, attempt:index+1}) === expected,
            engineType + ': retry time must double each round');
    }
    assert(context.cacheAttemptTime({engineType, initialTimeMs:5000, attempt:10000}) === 2147483647,
        'large retry must saturate at the transport time limit');
}

const newer = {
    engineType: 'bruteforceweb', id: 'newer', stateSignature: 's', attempt: 2,
    attemptStartedNo: 2, attemptDispatchedAt: Date.now() - 1900,
    currentTimeLimitMs: 2000, initialTimeMs: 1000, attemptDeferredNo: 1,
    attemptInFlight: true, activeRunId: 2, status: 'RUNNING'
};
assert(context.deferCacheAttempt(newer, 'PARTIAL', 1) === false, 'stale run was accepted');
assert(newer.attempt === 2 && newer.status === 'RUNNING', 'stale run mutated active attempt');

const retryText = context.cacheEngineRetryText('bruteforceweb', {
    attempt: 2, status: 'RUNNING', currentTimeLimitMs: 2000,
    attemptDispatchedAt: Date.now() - 500, branchLabel: '#30/34 (a0a1)'
});
assert(retryText.includes('#30/34 (a0a1)') && retryText.includes('L2'), 'compact retry branch is not shown');
assert(!retryText.includes('lần thử 2'), 'retry text still repeats the attempt number');

console.log('cache logic smoke tests: ok');

for (const engineType of ['pikafish', 'pikafishweb']) {
    const job = { engineType, attempt: 1, attemptStartedNo: 1,
        attemptInFlight: true, activeRunId: 1, attemptDispatchedAt: Date.now(),
        currentTimeLimitMs: 600, initialTimeMs: 600 };
    assert(context.deferCacheAttempt(job, 'INCOMPLETE', 0, true) === false, 'old bestmove cannot advance');
    assert(context.deferCacheAttempt(job, 'INCOMPLETE', 1, true) === true, 'completed short Pika search must advance');
    assert(job.attempt === 2, 'completed Pika search stuck at L1');
    assert(context.deferCacheAttempt(job, 'INCOMPLETE', 1, true) === false, 'duplicate completion cannot advance');
}
console.log('Pika early completion and stale run checks: ok');

for (const score of [{scoreType:'cp',scoreVal:100},{scoreType:'mate',scoreVal:4},{scoreType:'mate',scoreVal:-2}]) {
 const verdict=context.pikafishHorizonVerdict('red','red',3,{...score,depth:6},6);
 assert(verdict.status==='HORIZON_MISS' && verdict.terminal, 'No mate within remaining horizon must stop');
 assert(context.pikafishHorizonVerdict('red','red',3,{...score,depth:5},6).status==='INCOMPLETE', 'Below horizon must retry');
}
assert(context.pikafishHorizonVerdict('red','red',3,{scoreType:'mate',scoreVal:3,depth:6},6).ready, 'Mate exactly within horizon must succeed');
const limited={status:'HORIZON_MISS',result:{horizonReached:true,verifiedHorizon:false}};
assert(context.cacheAttemptTerminalFailure(limited),'Horizon miss must leave retry queue');
assert(!context.cacheAttemptFinished(limited),'Horizon miss must not become verified proof');
