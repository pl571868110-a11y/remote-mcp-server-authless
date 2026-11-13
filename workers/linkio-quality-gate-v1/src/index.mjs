import { WorkerEntrypoint } from 'cloudflare:workers';
import { evaluate } from './evaluator.mjs';
export class QualityGate extends WorkerEntrypoint {
  async evaluate(input) { return evaluate(input); }
}
export default {
  fetch() { return new Response('Not found', {status:404, headers:{'cache-control':'no-store'}}); }
};
