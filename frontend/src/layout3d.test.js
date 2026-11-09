import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePipelineLayout3D } from './layout3d.js';

test('computePipelineLayout3D produces completely deterministic coordinates', () => {
  const analysis = {
    modules: ['src/tokens.js', 'src/auth.js', 'src/session.js', 'src/cart.js'],
    dependencies: [
      { source: 'src/auth.js', target: 'src/tokens.js' },
      { source: 'src/session.js', target: 'src/tokens.js' },
      { source: 'src/cart.js', target: 'src/session.js' },
    ],
    coverage: {
      'test/tokens.test.js': ['src/tokens.js'],
      'test/auth.test.js': ['src/auth.js'],
      'test/cart.test.js': ['src/cart.js'],
    },
  };
  const tests = [
    { path: 'test/tokens.test.js', decision: 'Run', score: 0.9, factors: { relevance: 1, criticality: 0.8, failureRate: 0.2, marginalCoverage: 0.3 } },
    { path: 'test/auth.test.js', decision: 'Run', score: 0.7, factors: { relevance: 0.8, criticality: 0.7, failureRate: 0.1, marginalCoverage: 0.2 } },
    { path: 'test/cart.test.js', decision: 'Skip', score: 0.4, factors: { relevance: 0.4, criticality: 0.5, failureRate: 0.0, marginalCoverage: 0.1 } },
  ];
  const changedFiles = ['src/tokens.js'];

  const layout1 = computePipelineLayout3D({ analysis, tests, changedFiles });
  const layout2 = computePipelineLayout3D({ analysis, tests, changedFiles });

  assert.equal(layout1.hubList.length, layout2.hubList.length);
  assert.equal(layout1.nodes.length, layout2.nodes.length);
  assert.equal(layout1.edges.length, layout2.edges.length);

  // Assert exact floating-point coordinate equality between identical runs
  layout1.hubList.forEach((hub, i) => {
    const hub2 = layout2.hubList[i];
    assert.equal(hub.x, hub2.x);
    assert.equal(hub.y, hub2.y);
    assert.equal(hub.z, hub2.z);
    assert.equal(hub.depth, hub2.depth);
  });

  layout1.nodes.forEach((node, i) => {
    const node2 = layout2.nodes[i];
    assert.equal(node.x, node2.x);
    assert.equal(node.y, node2.y);
    assert.equal(node.z, node2.z);
  });
});

test('left-to-right causal pipeline: depth 0 is leftmost, depth 1 is to the right', () => {
  const analysis = {
    modules: ['src/tokens.js', 'src/auth.js', 'src/profile.js'],
    dependencies: [
      { source: 'src/auth.js', target: 'src/tokens.js' },
      { source: 'src/profile.js', target: 'src/auth.js' },
    ],
  };
  const changedFiles = ['src/tokens.js'];
  const layout = computePipelineLayout3D({ analysis, tests: [], changedFiles });

  const tokensHub = layout.hubs['src/tokens.js'];
  const authHub = layout.hubs['src/auth.js'];
  const profileHub = layout.hubs['src/profile.js'];

  assert.ok(tokensHub, 'tokens hub must exist');
  assert.ok(authHub, 'auth hub must exist');
  assert.ok(profileHub, 'profile hub must exist');

  assert.equal(tokensHub.depth, 0, 'tokens is changed (depth 0)');
  assert.equal(authHub.depth, 1, 'auth depends on tokens (depth 1)');
  assert.equal(profileHub.depth, 2, 'profile depends on auth (depth 2)');

  // tokens.x < auth.x < profile.x
  assert.ok(tokensHub.x < authHub.x, 'tokens hub is to the left of auth hub');
  assert.ok(authHub.x < profileHub.x, 'auth hub is to the left of profile hub');
});

test('handles cycles gracefully without infinite loop', () => {
  const analysis = {
    modules: ['src/a.js', 'src/b.js'],
    dependencies: [
      { source: 'src/a.js', target: 'src/b.js' },
      { source: 'src/b.js', target: 'src/a.js' },
    ],
  };
  const layout = computePipelineLayout3D({
    analysis,
    tests: [],
    changedFiles: ['src/a.js'],
  });

  assert.equal(layout.hubList.length, 2);
  assert.equal(layout.edges.length, 2);
});

test('computes edge bezier control points with positive arc height', () => {
  const analysis = {
    modules: ['src/a.js', 'src/b.js'],
    dependencies: [{ source: 'src/a.js', target: 'src/b.js' }],
  };
  const layout = computePipelineLayout3D({
    analysis,
    tests: [],
    changedFiles: ['src/b.js'],
  });

  assert.equal(layout.edges.length, 1);
  const edge = layout.edges[0];
  assert.ok(edge.p1.y > edge.p0.y, 'bezier control point p1.y is elevated above hub elevation');
});

