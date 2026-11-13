import { WorkerEntrypoint } from 'cloudflare:workers';
import { classify } from './classifier.mjs';
export class TaskRecovery extends WorkerEntrypoint {
  async classify(input) { return classify(input); }
}
export default { fetch() { return new Response('Not found', {status:404, headers:{'cache-control':'no-store'}}); } };
