const os = require('os');
const v8 = require('v8');

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value)));
}

function cpuTotalMicros(usage) {
  return Math.max(0, finiteNumber(usage?.user) + finiteNumber(usage?.system));
}

function detectedVcpuCount() {
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus()?.length;
  return Math.max(1, Math.floor(finiteNumber(available, 1)));
}

class RuntimeMetricsSampler {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.cpuUsage = options.cpuUsage || (() => process.cpuUsage());
    this.memoryUsage = options.memoryUsage || (() => process.memoryUsage());
    this.heapStatistics = options.heapStatistics || (() => v8.getHeapStatistics());
    this.vcpuCount = Math.max(1, Math.floor(finiteNumber(options.vcpuCount, detectedVcpuCount())));
    this.sampleIntervalMs = Math.max(250, finiteNumber(options.sampleIntervalMs, DEFAULT_SAMPLE_INTERVAL_MS));
    this.lastAtMs = finiteNumber(this.now(), Date.now());
    this.lastCpuMicros = cpuTotalMicros(this.cpuUsage());
    this.currentCpuVcpu = 0;
    this.peakCpuVcpu = 0;
    this.currentHeapUsedBytes = 0;
    this.peakHeapUsedBytes = 0;
    this.heapLimitBytes = Math.max(1, finiteNumber(this.heapStatistics()?.heap_size_limit, 1));
    this.timer = null;
    this.sampleMemory();
    if (options.autoStart !== false) this.start();
  }

  sampleMemory() {
    const heapUsedBytes = Math.max(0, finiteNumber(this.memoryUsage()?.heapUsed));
    this.currentHeapUsedBytes = heapUsedBytes;
    this.peakHeapUsedBytes = Math.max(this.peakHeapUsedBytes, heapUsedBytes);
    this.heapLimitBytes = Math.max(1, finiteNumber(this.heapStatistics()?.heap_size_limit, this.heapLimitBytes));
  }

  sample() {
    const nowMs = finiteNumber(this.now(), Date.now());
    const currentCpuMicros = cpuTotalMicros(this.cpuUsage());
    const elapsedMicros = Math.max(1, (nowMs - this.lastAtMs) * 1_000);
    const usedCpuMicros = Math.max(0, currentCpuMicros - this.lastCpuMicros);
    this.currentCpuVcpu = clamp(usedCpuMicros / elapsedMicros, 0, this.vcpuCount);
    this.peakCpuVcpu = Math.max(this.peakCpuVcpu, this.currentCpuVcpu);
    this.lastAtMs = nowMs;
    this.lastCpuMicros = currentCpuMicros;
    this.sampleMemory();
    return this.snapshot();
  }

  snapshot() {
    const cpuUsageRatio = clamp(this.currentCpuVcpu / this.vcpuCount, 0, 1);
    const peakCpuUsageRatio = clamp(this.peakCpuVcpu / this.vcpuCount, 0, 1);
    const heapUsageRatio = clamp(this.currentHeapUsedBytes / this.heapLimitBytes, 0, 1);
    const peakHeapUsageRatio = clamp(this.peakHeapUsedBytes / this.heapLimitBytes, 0, 1);
    return {
      sampledAt: new Date(this.lastAtMs).toISOString(),
      cpu: {
        usageRatio: cpuUsageRatio,
        usagePercent: cpuUsageRatio * 100,
        usedVcpu: this.currentCpuVcpu,
        peakUsageRatio: peakCpuUsageRatio,
        peakUsagePercent: peakCpuUsageRatio * 100,
        peakVcpu: this.peakCpuVcpu,
        maxVcpu: this.vcpuCount,
      },
      heap: {
        usageRatio: heapUsageRatio,
        usagePercent: heapUsageRatio * 100,
        usedBytes: this.currentHeapUsedBytes,
        peakUsageRatio: peakHeapUsageRatio,
        peakUsagePercent: peakHeapUsageRatio * 100,
        peakBytes: this.peakHeapUsedBytes,
        maxBytes: this.heapLimitBytes,
      },
    };
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.sample(), this.sampleIntervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const runtimeMetricsSampler = new RuntimeMetricsSampler();

function getRuntimeMetrics() {
  return runtimeMetricsSampler.snapshot();
}

module.exports = {
  RuntimeMetricsSampler,
  detectedVcpuCount,
  getRuntimeMetrics,
};
