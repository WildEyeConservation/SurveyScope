import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  OutOfTimeError,
  findImageIdsInPages,
  shuffle,
  timeBudget,
  type ImageIdPage,
} from './core';

function pagesOf(pages: string[][]): {
  fetchPage: ImageIdPage;
  calls: () => number;
} {
  let calls = 0;
  return {
    fetchPage: async (nextToken) => {
      calls++;
      const index = nextToken ? Number(nextToken) : 0;
      return {
        imageIds: pages[index],
        nextToken: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
    calls: () => calls,
  };
}

const noLimit = timeBudget(Infinity);
const ignore = async () => {};

test('reports each wanted image once across pages and ignores the rest', async () => {
  const { fetchPage } = pagesOf([['a', 'x', 'a'], ['y'], ['b', 'a', 'z']]);
  const reported: string[][] = [];
  const { found, scanned } = await findImageIdsInPages(
    ['a', 'b', 'c'],
    fetchPage,
    async (ids) => {
      reported.push(ids);
    },
    noLimit,
  );
  assert.deepEqual([...found].sort(), ['a', 'b']);
  assert.deepEqual(reported, [['a'], ['b']]);
  assert.equal(scanned, 7);
});

test('stops paging once every wanted image is found', async () => {
  const pages = pagesOf([['a'], ['b'], ['c'], ['d']]);
  const { found } = await findImageIdsInPages(
    ['a', 'b'],
    pages.fetchPage,
    ignore,
    noLimit,
  );
  assert.deepEqual([...found].sort(), ['a', 'b']);
  assert.equal(pages.calls(), 2);
});

test('hands off earlier matches before running out of time', async () => {
  let now = 0;
  const ensureTime = timeBudget(10, () => now);
  const { fetchPage } = pagesOf([['a'], ['b'], ['c'], ['d']]);
  const reported: string[] = [];
  await assert.rejects(
    findImageIdsInPages(
      ['a', 'b', 'c', 'missing'],
      async (nextToken) => {
        now += 6;
        return fetchPage(nextToken);
      },
      async (ids) => {
        reported.push(...ids);
      },
      ensureTime,
    ),
    OutOfTimeError,
  );
  assert.deepEqual(reported, ['a', 'b']);
});

test('timeBudget only throws after the deadline', () => {
  let now = 100;
  const ensureTime = timeBudget(100, () => now);
  ensureTime();
  now = 101;
  assert.throws(ensureTime, OutOfTimeError);
});

test('shuffle keeps every item', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const shuffled = shuffle([...items], () => 0);
  assert.deepEqual([...shuffled].sort(), items);
  assert.notDeepEqual(shuffled, items);
});
