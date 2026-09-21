import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  MAX_VISIBLE,
  QUEUE_LIMIT,
  enqueueNotification,
  markExiting,
  queuedCount,
  removeNotification,
  visibleNotifications,
} from './notificationQueue.js';

const item = (key) => ({ key, name: key, state: 'ONLINE' });

describe('notificationQueue', () => {
  it('mantiene máximo 3 visibles y el resto en cola', () => {
    let list = [];
    for (let i = 0; i < 5; i += 1) {
      list = enqueueNotification(list, item(`n${i}`));
    }
    assert.equal(visibleNotifications(list).length, MAX_VISIBLE);
    assert.equal(visibleNotifications(list)[0].key, 'n0');
    assert.equal(queuedCount(list), 2);
  });

  it('al desbordar la cola descarta la más vieja en cola, no las visibles', () => {
    let list = [];
    for (let i = 0; i < MAX_VISIBLE + QUEUE_LIMIT + 2; i += 1) {
      list = enqueueNotification(list, item(`n${i}`));
    }
    assert.equal(list.length, MAX_VISIBLE + QUEUE_LIMIT);
    // Las 3 visibles siguen siendo las primeras.
    assert.deepEqual(
      visibleNotifications(list).map((n) => n.key),
      ['n0', 'n1', 'n2'],
    );
    // La cola conserva las últimas (n3 y n4 se descartaron al desbordar).
    assert.equal(list[MAX_VISIBLE].key, 'n5');
  });

  it('remove quita solo la indicada', () => {
    let list = [item('a'), item('b'), item('c')];
    list = removeNotification(list, 'b');
    assert.deepEqual(
      list.map((n) => n.key),
      ['a', 'c'],
    );
  });

  it('markExiting marca solo la indicada', () => {
    let list = [item('a'), item('b')];
    list = markExiting(list, 'a');
    assert.equal(list[0].exiting, true);
    assert.equal(list[1].exiting, undefined);
  });
});
