const assert = require('node:assert/strict');
const test = require('node:test');

const { RuntimeMetricsSampler } = require('../src/runtimeMetrics');

test('runtime metrics normalize process CPU against available vCPUs and retain peaks', () => {
  let nowMs = 0;
  let cpu = { user: 0, system: 0 };
  let heapUsed = 256;
  const sampler = new RuntimeMetricsSampler({
    autoStart: false,
    cpuUsage: () => cpu,
    heapStatistics: () => ({ heap_size_limit: 1_024 }),
    memoryUsage: () => ({ heapUsed }),
    now: () => nowMs,
    vcpuCount: 2,
  });

  nowMs = 1_000;
  cpu = { user: 900_000, system: 100_000 };
  heapUsed = 512;
  const busy = sampler.sample();

  assert.equal(busy.cpu.usedVcpu, 1);
  assert.equal(busy.cpu.usageRatio, 0.5);
  assert.equal(busy.cpu.usagePercent, 50);
  assert.equal(busy.cpu.maxVcpu, 2);
  assert.equal(busy.heap.usedBytes, 512);
  assert.equal(busy.heap.usageRatio, 0.5);
  assert.equal(busy.heap.maxBytes, 1_024);

  nowMs = 2_000;
  cpu = { user: 1_200_000, system: 200_000 };
  heapUsed = 384;
  const calmer = sampler.sample();

  assert.equal(calmer.cpu.usedVcpu, 0.4);
  assert.equal(calmer.cpu.usageRatio, 0.2);
  assert.equal(calmer.cpu.peakUsageRatio, 0.5);
  assert.equal(calmer.heap.usageRatio, 0.375);
  assert.equal(calmer.heap.peakBytes, 512);
  assert.equal(calmer.heap.peakUsageRatio, 0.5);
});

test('runtime metrics clamp CPU bursts to the detected vCPU maximum', () => {
  let nowMs = 0;
  let cpu = { user: 0, system: 0 };
  const sampler = new RuntimeMetricsSampler({
    autoStart: false,
    cpuUsage: () => cpu,
    heapStatistics: () => ({ heap_size_limit: 4_096 }),
    memoryUsage: () => ({ heapUsed: 1_024 }),
    now: () => nowMs,
    vcpuCount: 2,
  });

  nowMs = 1_000;
  cpu = { user: 5_000_000, system: 0 };
  const metrics = sampler.sample();

  assert.equal(metrics.cpu.usedVcpu, 2);
  assert.equal(metrics.cpu.usageRatio, 1);
  assert.equal(metrics.cpu.usagePercent, 100);
});
