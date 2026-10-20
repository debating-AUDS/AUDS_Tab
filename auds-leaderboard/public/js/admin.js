import { state } from './lib.js';
import { signInView } from './admin-common.js';
import { dashboard, overview, settings, feedbackIndex } from './admin-dash.js';
import { rollPage } from './admin-roll.js';
import { adjudicatorsPage } from './admin-adj.js';
import { roundPage } from './admin-round.js';

const guard = (fn) => (ctx) => (state.admin ? fn(ctx) : signInView());

export const routes = [
  { pattern: '/admin', render: guard(dashboard) },
  { pattern: '/admin/t/:slug', render: guard(overview) },
  { pattern: '/admin/t/:slug/roll', render: guard(rollPage) },
  { pattern: '/admin/t/:slug/adjudicators', render: guard(adjudicatorsPage) },
  { pattern: '/admin/t/:slug/round/:n', render: guard(roundPage) },
  { pattern: '/admin/t/:slug/feedback', render: guard(feedbackIndex) },
  { pattern: '/admin/t/:slug/settings', render: guard(settings) },
];
