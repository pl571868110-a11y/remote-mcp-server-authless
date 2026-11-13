// Pure, side-effect-free evidence classifier. NEVER replays or mutates tasks.
const TOKEN = /^[A-Za-z0-9_:-]{1,128}$/;
const STATES = new Set(['unknown','failed','completed','running','queued']);
const STAGE_STATES = new Set(['unknown','failed','completed','running','started']);

export function classify(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('INVALID_INPUT');
  const { taskId, idempotencyKey, state, errorCode = null, stages = [], receipts = [] } = input;
  if (typeof taskId !== 'string' || !TOKEN.test(taskId)) throw new TypeError('INVALID_TASK_ID');
  if (typeof idempotencyKey !== 'string' || !TOKEN.test(idempotencyKey)) throw new TypeError('INVALID_IDEMPOTENCY_KEY');
  if (!STATES.has(state)) throw new TypeError('INVALID_STATE');
  if (errorCode !== null && (typeof errorCode !== 'string' || !TOKEN.test(errorCode))) throw new TypeError('INVALID_ERROR_CODE');
  if (!Array.isArray(stages) || stages.length > 50 || !stages.every(x => x && typeof x === 'object' && typeof x.stage === 'string' && TOKEN.test(x.stage) && STAGE_STATES.has(x.state))) throw new TypeError('INVALID_STAGES');
  if (!Array.isArray(receipts) || receipts.length > 30 || !receipts.every(x => x && typeof x === 'object' && typeof x.kind === 'string' && TOKEN.test(x.kind) && typeof x.source === 'string' && TOKEN.test(x.source) && typeof x.ref === 'string' && TOKEN.test(x.ref))) throw new TypeError('INVALID_RECEIPTS');
  const hermesStarted = stages.some(x => x.stage === 'hermes_execution' && ['started','running','unknown','completed'].includes(x.state));
  // Receipt contents and provenance are NOT independently verified by this Worker.
  const unclear = state === 'unknown' || !!errorCode || stages.some(x => x.state === 'unknown');
  let classification, nextAction;
  if (state === 'completed' && !unclear) {
    classification = 'COMPLETED_REVIEW_ONLY'; nextAction = 'COMPARE_FINAL_ARTIFACT_AND_QUALITY';
  } else if (hermesStarted) {
    classification = receipts.length ? 'POTENTIAL_EXECUTION_RECEIPTS_UNVERIFIED' : 'EXECUTION_UNCONFIRMED';
    nextAction = 'VERIFY_EXTERNAL_RECEIPTS_AND_IDEMPOTENCY';
  } else if (receipts.length) {
    classification = 'RECEIPTS_PRESENT_UNVERIFIED'; nextAction = 'VERIFY_RECEIPT_PROVENANCE';
  } else {
    classification = 'NO_EXECUTION_EVIDENCE'; nextAction = 'CHECK_UPSTREAM_AND_TRANSPORT_LOGS';
  }
  return {
    schema: 'linkio.task-recovery.v1', taskId, state, errorCode,
    classification, nextAction, stageCount: stages.length, receiptCount: receipts.length,
    replayPermitted: false, mayChangeState: false, definitiveExecutionProof: false,
    reviewRequired: true, readOnly: true
  };
}
