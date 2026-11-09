/**
 * Deterministic 2.5D Coordinate and Layout Engine for TestOpt Pipeline.
 * 
 * Computes reproducible 3D coordinates for modules, tests, dependency tubes,
 * and test-to-module links based on dependency depth and causal flow.
 */

export const LAYOUT_CONFIG = {
  LAYER_SPACING_X: 24,       // Horizontal spacing between dependency depth layers
  MODULE_SPACING_Z: 15,      // Spacing between modules within the same column layer
  HUB_ELEVATION_Y: 3.5,      // Height of module hubs above the ground plane
  BASE_HUB_RADIUS: 2.2,      // Base radius of module hub sphere
  MAX_INDIVIDUAL_TESTS: 20,  // Threshold: modules with > 20 tests support cluster summary
  GOLDEN_ANGLE: 2.39996323,  // Golden ratio angle in radians for even spherical distribution
};

/**
 * Computes deterministic 3D layout from analysis, tests, and changed files/modules.
 *
 * @param {Object} params
 * @param {Object} params.analysis - { modules: string[], dependencies: Array<{source, target}>, coverage?: Record<string, string[]> }
 * @param {Array<Object>} params.tests - Array of test objects ({ path, module, modules, score, decision, factors, reason, status })
 * @param {string[]} params.changedFiles - Array of changed file paths
 * @param {string[]} [params.changedModules] - Array of changed module paths or IDs
 * @returns {Object} Layout with hubs, nodes, edges, crossLinks, stats, and bounds
 */
export function computePipelineLayout3D({
  analysis,
  tests = [],
  changedFiles = [],
  changedModules = [],
}) {
  const rawModules = Array.isArray(analysis?.modules) ? analysis.modules : [];
  const rawDependencies = Array.isArray(analysis?.dependencies) ? analysis.dependencies : [];
  const coverageMap = analysis?.coverage || {};

  // 1. Identify changed modules: either explicitly given or matched against changedFiles
  const changedModuleSet = new Set([
    ...changedModules,
    ...changedFiles.filter((file) => rawModules.includes(file)),
  ]);

  // If no changed module explicitly matched, treat all changedFiles that resemble modules as changed
  if (changedModuleSet.size === 0 && changedFiles.length > 0) {
    changedFiles.forEach((file) => changedModuleSet.add(file));
  }

  // 2. Build adjacency maps:
  // source -> targets (source imports target)
  // target -> sources (target is imported by source - callers)
  const allModuleIds = new Set([...rawModules, ...changedModuleSet]);
  const outgoing = new Map(); // imports
  const incoming = new Map(); // callers / dependents

  allModuleIds.forEach((id) => {
    outgoing.set(id, new Set());
    incoming.set(id, new Set());
  });

  rawDependencies.forEach(({ source, target }) => {
    if (allModuleIds.has(source) && allModuleIds.has(target)) {
      outgoing.get(source)?.add(target);
      incoming.get(target)?.add(source);
    }
  });

  // 3. BFS Transitive Impact Traversal from changed modules.
  // When module B changes, all modules that import B (callers) are affected.
  const depthMap = new Map();
  const queue = [];
  const visited = new Set();

  changedModuleSet.forEach((modId) => {
    depthMap.set(modId, 0);
    queue.push({ id: modId, depth: 0 });
    visited.add(modId);
  });

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    const callers = incoming.get(id) || new Set();
    callers.forEach((caller) => {
      if (!visited.has(caller)) {
        visited.add(caller);
        depthMap.set(caller, depth + 1);
        queue.push({ id: caller, depth: depth + 1 });
      }
    });
  }

  // Modules not reached by BFS get depth = undefined (unaffected)
  // Assign unaffected modules to an unaffected layer at the end or side
  const affectedModules = [];
  const unaffectedModules = [];

  allModuleIds.forEach((id) => {
    if (depthMap.has(id)) {
      affectedModules.push(id);
    } else {
      unaffectedModules.push(id);
    }
  });

  // Find max affected depth
  let maxAffectedDepth = 0;
  depthMap.forEach((d) => {
    if (d > maxAffectedDepth) maxAffectedDepth = d;
  });

  // Unaffected modules are placed in Layer (maxAffectedDepth + 1)
  const unaffectedLayerIdx = maxAffectedDepth + 1;
  unaffectedModules.forEach((id) => {
    depthMap.set(id, unaffectedLayerIdx);
  });

  // Group modules by depth layer
  const layerBuckets = new Map();
  allModuleIds.forEach((id) => {
    const d = depthMap.get(id);
    if (!layerBuckets.has(d)) layerBuckets.set(d, []);
    layerBuckets.get(d).push(id);
  });

  // Sort modules inside each layer deterministically (changed first, then alphabetical)
  layerBuckets.forEach((bucket, d) => {
    bucket.sort((a, b) => {
      const aChanged = changedModuleSet.has(a) ? -1 : 0;
      const bChanged = changedModuleSet.has(b) ? -1 : 0;
      if (aChanged !== bChanged) return aChanged - bChanged;
      return a.localeCompare(b);
    });
  });

  // 4. Map tests to their primary module
  // A test covers modules listed in test.modules or coverageMap[test.path]
  const moduleTestsMap = new Map();
  allModuleIds.forEach((id) => moduleTestsMap.set(id, []));

  const unmappedTests = [];
  tests.forEach((test) => {
    const covered = (test.modules && test.modules.length > 0)
      ? test.modules
      : coverageMap[test.path] || (test.module ? [test.module] : []);

    const validCovered = covered.filter((m) => allModuleIds.has(m));

    if (validCovered.length > 0) {
      // Primary module is the one with lowest depth (closest to the change)
      let primary = validCovered[0];
      let minD = depthMap.get(primary) ?? 999;
      for (let i = 1; i < validCovered.length; i++) {
        const d = depthMap.get(validCovered[i]) ?? 999;
        if (d < minD) {
          minD = d;
          primary = validCovered[i];
        }
      }
      moduleTestsMap.get(primary)?.push({
        ...test,
        primaryModule: primary,
        allCoveredModules: validCovered,
      });
    } else {
      unmappedTests.push(test);
    }
  });

  // If there are unmapped tests, attach them to a virtual or last layer
  if (unmappedTests.length > 0) {
    const fallbackId = '__unmapped__';
    layerBuckets.set(unaffectedLayerIdx + 1, [fallbackId]);
    moduleTestsMap.set(fallbackId, unmappedTests);
    depthMap.set(fallbackId, unaffectedLayerIdx + 1);
  }

  // 5. Compute coordinates for Module Hubs
  const sortedLayerIndices = Array.from(layerBuckets.keys()).sort((a, b) => a - b);
  const totalLayers = sortedLayerIndices.length;
  const xCenterOffset = ((totalLayers - 1) * LAYOUT_CONFIG.LAYER_SPACING_X) / 2;

  const hubs = {};
  const hubList = [];

  sortedLayerIndices.forEach((layerIdx) => {
    const bucket = layerBuckets.get(layerIdx) || [];
    const count = bucket.length;
    const totalZ = (count - 1) * LAYOUT_CONFIG.MODULE_SPACING_Z;
    const posX = layerIdx * LAYOUT_CONFIG.LAYER_SPACING_X - xCenterOffset;

    bucket.forEach((modId, rowIdx) => {
      const posZ = count > 1 ? rowIdx * LAYOUT_CONFIG.MODULE_SPACING_Z - totalZ / 2 : 0;
      const posY = LAYOUT_CONFIG.HUB_ELEVATION_Y;

      const modTests = moduleTestsMap.get(modId) || [];
      const testCount = modTests.length;
      const radius = LAYOUT_CONFIG.BASE_HUB_RADIUS + Math.min(2.5, Math.sqrt(testCount) * 0.45);

      const isChanged = changedModuleSet.has(modId);
      const isAffected = depthMap.get(modId) !== undefined && depthMap.get(modId) <= maxAffectedDepth;

      const hub = {
        id: modId,
        name: modId.split('/').pop() || modId,
        fullPath: modId,
        layer: layerIdx,
        depth: depthMap.get(modId),
        isChanged,
        isAffected,
        testCount,
        radius,
        x: posX,
        y: posY,
        z: posZ,
        tests: modTests,
        dependsOn: Array.from(outgoing.get(modId) || []),
        affectedBy: Array.from(incoming.get(modId) || []),
        isClustered: testCount > LAYOUT_CONFIG.MAX_INDIVIDUAL_TESTS,
      };

      hubs[modId] = hub;
      hubList.push(hub);
    });
  });

  // 6. Compute coordinates for Tests (Nodes) around each Hub
  const nodes = [];
  const crossLinks = [];

  hubList.forEach((hub) => {
    const hubTests = hub.tests;
    const n = hubTests.length;
    const R = hub.radius * 1.55;

    hubTests.forEach((t, i) => {
      // Stable spherical distribution around hub
      const yRel = n > 1 ? 1 - (i / (n - 1)) * 2 : 0;
      const rRel = Math.sqrt(Math.max(0, 1 - yRel * yRel));
      const phi = i * LAYOUT_CONFIG.GOLDEN_ANGLE;
      const shell = R * (0.85 + ((i % 5) * 0.08));

      const offsetX = Math.cos(phi) * rRel * shell;
      const offsetY = yRel * shell * 0.75;
      const offsetZ = Math.sin(phi) * rRel * shell;

      const nx = hub.x + offsetX;
      const ny = Math.max(0.85, hub.y + offsetY);
      const nz = hub.z + offsetZ;

      const isSelected = t.decision === 'Run';
      const isSkipped = t.decision === 'Skip';
      const isFailed = t.status === 'FAILED' || t.result?.status === 'FAILED';

      const node = {
        id: t.path,
        name: t.path.split('/').pop() || t.path,
        fullPath: t.path,
        hubId: hub.id,
        hubName: hub.name,
        x: nx,
        y: ny,
        z: nz,
        radius: 0.32 + Math.min(0.2, (t.score || 0) * 0.2),
        score: t.score ?? null,
        factors: t.factors || null,
        reason: t.reason || '',
        decision: t.decision || 'Waiting',
        status: t.status || 'WAITING',
        executionTime: t.executionTime || 0.02,
        estimated: t.estimated || t.executionTime || 0.02,
        measuredTime: t.measuredTime ?? null,
        isLinked: hub.isAffected,
        isSelected,
        isSkipped,
        isFailed,
        isInfraError: t.isInfraError || t.status === 'ERROR' || t.result?.status === 'ERROR',
        isPass: t.isPass || t.status === 'PASSED' || t.result?.status === 'PASSED',
        historicalRunsCount: t.historicalRunsCount || 0,
        historicalPassRate: t.historicalPassRate ?? null,
        coverageAvailable: t.coverageAvailable ?? null,
        output: t.output || null,
        primaryModule: t.primaryModule || hub.id,
        rank: i / Math.max(1, n),
      };

      nodes.push(node);

      // Check cross links (if test covers other modules in addition to primary)
      (t.allCoveredModules || []).forEach((otherMod) => {
        if (otherMod !== hub.id && hubs[otherMod]) {
          crossLinks.push({
            testPath: t.path,
            from: { x: nx, y: ny, z: nz },
            to: { x: hubs[otherMod].x, y: hubs[otherMod].y, z: hubs[otherMod].z },
            targetHubId: otherMod,
          });
        }
      });
    });
  });

  // 7. Compute Directed Edges (Bezier Tubes) between Hubs
  const edges = [];
  rawDependencies.forEach(({ source, target }) => {
    const hubA = hubs[source];
    const hubB = hubs[target];
    if (hubA && hubB) {
      const dx = hubB.x - hubA.x;
      const dz = hubB.z - hubA.z;
      const dist = Math.hypot(dx, dz);

      // Arc height increases with distance to avoid intersecting pedestals
      const arcHeight = Math.min(6.5, 2.0 + dist * 0.12);
      const midX = (hubA.x + hubB.x) / 2;
      const midY = Math.max(hubA.y, hubB.y) + arcHeight;
      const midZ = (hubA.z + hubB.z) / 2;

      edges.push({
        id: `${source}->${target}`,
        source: hubA,
        target: hubB,
        p0: { x: hubA.x, y: hubA.y, z: hubA.z },
        p1: { x: midX, y: midY, z: midZ },
        p2: { x: hubB.x, y: hubB.y, z: hubB.z },
        isImpacted: hubA.isAffected && hubB.isAffected,
      });
    }
  });

  // 8. Stats summary for pipeline stages
  const stats = {
    totalModules: hubList.length,
    changedModulesCount: changedModuleSet.size,
    affectedModulesCount: affectedModules.length,
    totalTests: nodes.length,
    linkedTestsCount: nodes.filter((n) => n.isLinked).length,
    selectedTestsCount: nodes.filter((n) => n.isSelected).length,
    skippedTestsCount: nodes.filter((n) => n.isSkipped).length,
    failedTestsCount: nodes.filter((n) => n.isFailed).length,
    skippedPercent: nodes.length > 0
      ? Math.round((nodes.filter((n) => n.isSkipped).length / nodes.length) * 100)
      : 0,
  };

  return {
    hubs,
    hubList,
    nodes,
    edges,
    crossLinks,
    stats,
    layers: sortedLayerIndices.map((idx) => ({
      index: idx,
      isChangedLayer: idx === 0,
      x: idx * LAYOUT_CONFIG.LAYER_SPACING_X - xCenterOffset,
      moduleCount: (layerBuckets.get(idx) || []).length,
    })),
  };
}

