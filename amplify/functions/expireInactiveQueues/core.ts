import { APP_URL, button, escapeHtml, layout, paragraph } from '../shared/emailLayout';

const DAY_MS = 24 * 60 * 60 * 1000;
export const INACTIVE_AFTER_MS = 60 * DAY_MS;
export const NOTICE_MS = 30 * DAY_MS;

export type QueueActivity = {
  createdAt: string;
  lastObservationAt?: string | null;
  lastAccessedAt?: string | null;
  inactivityWarnedAt?: string | null;
  cancelAfter?: string | null;
};

export type Decision = 'none' | 'warn' | 'clear' | 'cancel';

export function lastActivityMs(queue: QueueActivity): number {
  const times = [queue.createdAt, queue.lastObservationAt, queue.lastAccessedAt]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((time) => !Number.isNaN(time));
  return times.length ? Math.max(...times) : NaN;
}

export function decide(queue: QueueActivity, now: number): Decision {
  const last = lastActivityMs(queue);
  if (Number.isNaN(last)) return 'none';
  if (queue.inactivityWarnedAt && queue.cancelAfter) {
    if (last > Date.parse(queue.inactivityWarnedAt)) return 'clear';
    return now >= Date.parse(queue.cancelAfter) ? 'cancel' : 'none';
  }
  return now - last >= INACTIVE_AFTER_MS ? 'warn' : 'none';
}

const DISPLAY_TAGS = new Set(['qc-review', 'info-tags', 'homography']);

export function jobLabel(queue: {
  name: string;
  tag?: string | null;
}): string {
  if (!queue.tag || DISPLAY_TAGS.has(queue.tag) || queue.tag === queue.name) {
    return queue.name;
  }
  return queue.tag.includes(queue.name)
    ? queue.tag
    : `${queue.tag} (${queue.name})`;
}

export function formatDate(time: number): string {
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type WarnedJob = {
  projectName: string;
  jobLabel: string;
  lastActiveAt: number;
};

export function inactiveJobsEmail(
  organizationName: string,
  jobs: WarnedJob[],
  cancelAfter: number
): { subject: string; html: string; text: string } {
  const organization = organizationName.replace(/\s+/g, ' ').trim();
  const deadline = formatDate(cancelAfter);
  const single = jobs.length === 1;
  const subject = single
    ? `A SurveyScope job in ${organization} will be cancelled on ${deadline}`
    : `${jobs.length} SurveyScope jobs in ${organization} will be cancelled on ${deadline}`;
  const intro = single
    ? `This job in ${organization} hasn't been opened or worked on for over 60 days. It will be cancelled on ${deadline} unless someone opens it before then.`
    : `These jobs in ${organization} haven't been opened or worked on for over 60 days. They will be cancelled on ${deadline} unless someone opens them before then.`;
  const lines = jobs.map(
    (job) =>
      `${job.projectName}: ${job.jobLabel}, last active ${formatDate(job.lastActiveAt)}`
  );
  const keep =
    'To keep a job, take it from the Jobs page, or click Keep job next to it.';
  const safe =
    'Cancelling a job does not delete any annotations, observations, images or locations. You can launch it again from the survey whenever you like.';
  const list = `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;">${lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('')}</ul>`;
  return {
    subject,
    html: layout(
      escapeHtml(single ? 'An inactive job will be cancelled' : 'Inactive jobs will be cancelled'),
      paragraph(escapeHtml(intro)) +
        list +
        paragraph(escapeHtml(keep)) +
        paragraph(escapeHtml(safe)) +
        button('Open SurveyScope')
    ),
    text: [intro, lines.map((line) => `- ${line}`).join('\n'), keep, safe, APP_URL].join(
      '\n\n'
    ),
  };
}
