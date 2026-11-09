import { useMemo, useState, useRef, useCallback } from 'react'
import { computePipelineLayout3D } from './layout3d.js'
import PipelineScene3D from './PipelineScene3D.jsx'
import PipelineSidebarHUD from './PipelineSidebarHUD.jsx'
import PipelineTableView from './PipelineTableView.jsx'

function shortName(filePath = '') {
  const parts = filePath.split('/')
  return parts.slice(-2).join('/') || filePath
}

function baseName(filePath = '') {
  return filePath.split('/').pop() || filePath
}

export default function VisualScene({
  city = false,
  viewMode = '3d',
  analysis,
  tests = [],
  changedFiles = [],
  changedModules = [],
  plan = null,
  timeBudget = null,
  workerCount = 2,
  algorithm = 'GREEDY',
  algorithmDetails = null,
  weights = null,
  coverageGap = [],
  isValidationComplete = false,
  fallbackReasons = [],
  baselineUsable = true,
  measuredSelectedDuration = null,
  realizedSavings = null,
  fullEstimate = null,
  selectedEstimate = null,
  savedEstimate = null,
  notice = '',
  phase = 0,
  paused = false,
}) {
  // If not on the pipeline view, render a clean, lightweight static backdrop.
  if (!city) {
    return <div className="scene backdrop" aria-hidden="true" />
  }

  if (viewMode === 'table') {
    return (
      <PipelineTableView
        tests={tests}
        changedFiles={changedFiles}
        changedModules={changedModules}
        timeBudget={timeBudget}
        workerCount={workerCount}
        algorithm={algorithm}
        algorithmDetails={algorithmDetails}
        weights={weights}
        coverageGap={coverageGap}
        isValidationComplete={isValidationComplete}
        measuredSelectedDuration={measuredSelectedDuration}
        realizedSavings={realizedSavings}
        fullEstimate={fullEstimate}
        selectedEstimate={selectedEstimate}
        savedEstimate={savedEstimate}
      />
    )
  }

  if (viewMode === '2d') {
    return (
      <DependencyGraphCanvas
        analysis={analysis}
        tests={tests}
        changedFiles={changedFiles}
        changedModules={changedModules}
        plan={plan}
        timeBudget={timeBudget}
        algorithm={algorithm}
        weights={weights}
        phase={phase}
        paused={paused}
      />
    )
  }

  return (
    <PipelineScene3DContainer
      analysis={analysis}
      tests={tests}
      changedFiles={changedFiles}
      changedModules={changedModules}
      plan={plan}
      timeBudget={timeBudget}
      workerCount={workerCount}
      algorithm={algorithm}
      algorithmDetails={algorithmDetails}
      weights={weights}
      coverageGap={coverageGap}
      isValidationComplete={isValidationComplete}
      fallbackReasons={fallbackReasons}
      baselineUsable={baselineUsable}
      measuredSelectedDuration={measuredSelectedDuration}
      realizedSavings={realizedSavings}
      fullEstimate={fullEstimate}
      selectedEstimate={selectedEstimate}
      savedEstimate={savedEstimate}
      notice={notice}
      phase={phase}
      paused={paused}
    />
  )
}

function PipelineScene3DContainer({
  analysis,
  tests = [],
  changedFiles = [],
  changedModules = [],
  plan = null,
  timeBudget = null,
  workerCount = 2,
  algorithm = 'GREEDY',
  algorithmDetails = null,
  weights = null,
  coverageGap = [],
  isValidationComplete = false,
  fallbackReasons = [],
  baselineUsable = true,
  measuredSelectedDuration = null,
  realizedSavings = null,
  fullEstimate = null,
  selectedEstimate = null,
  savedEstimate = null,
  notice = '',
  phase = 0,
  paused = false,
}) {
  const [selectedItem, setSelectedItem] = useState(null)
  const [activeFocus, setActiveFocus] = useState(null)

  const layout = useMemo(
    () =>
      computePipelineLayout3D({
        analysis,
        tests,
        changedFiles,
        changedModules,
      }),
    [analysis, tests, changedFiles, changedModules]
  )

  const handleSelectNode = useCallback((item) => {
    setSelectedItem(item)
    if (item?.id) {
      setActiveFocus(item.id)
    }
  }, [])

  const handleFocusItem = useCallback((id) => {
    setActiveFocus(id)
  }, [])

  return (
    <div
      className="pipeline-3d-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        display: 'grid',
        gridTemplateColumns: '340px minmax(0, 1fr)',
        gap: '16px',
        padding: '100px 20px 20px',
        background: '#070b16',
        boxSizing: 'border-box',
      }}
    >
      <PipelineSidebarHUD
        layout={layout}
        phase={phase}
        selectedItem={selectedItem}
        onSelectItem={handleSelectNode}
        onFocusItem={handleFocusItem}
        timeBudget={timeBudget}
        workerCount={workerCount}
        algorithm={algorithm}
        algorithmDetails={algorithmDetails}
        weights={weights}
        coverageGap={coverageGap}
        isValidationComplete={isValidationComplete}
        fallbackReasons={fallbackReasons}
        baselineUsable={baselineUsable}
        measuredSelectedDuration={measuredSelectedDuration}
        realizedSavings={realizedSavings}
        fullEstimate={fullEstimate}
        selectedEstimate={selectedEstimate}
        savedEstimate={savedEstimate}
        notice={notice}
      />
      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
        <PipelineScene3D
          layout={layout}
          phase={phase}
          paused={paused}
          selectedId={selectedItem?.id || null}
          activeFocus={activeFocus}
          onSelectNode={handleSelectNode}
          onResetView={() => {
            setActiveFocus(null)
            setSelectedItem(null)
          }}
        />
      </div>
    </div>
  )
}

function DependencyGraphCanvas({
  analysis,
  tests = [],
  changedFiles = [],
  changedModules = [],
  plan = null,
  timeBudget = null,
  algorithm = 'GREEDY',
  weights = null,
  phase = 0,
}) {
  const svgRef = useRef(null)
  const [transform, setTransform] = useState({ x: 60, y: 120, k: 0.9 })
  const [isPanning, setIsPanning] = useState(false)
  const [startPan, setStartPan] = useState({ x: 0, y: 0 })
  const [hoveredNode, setHoveredNode] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)

  // 1. Extract raw modules, tests, and dependencies safely
  const rawModules = useMemo(
    () => analysis?.modules || [],
    [analysis?.modules],
  )
  const rawDependencies = useMemo(
    () => analysis?.dependencies || [],
    [analysis?.dependencies],
  )
  const testList = useMemo(() => {
    if (tests.length > 0) return tests
    return (analysis?.tests || []).map((path) => ({ path, modules: [] }))
  }, [tests, analysis?.tests])

  // 2. Build graph data, detect cycles, and compute BFS impact traversal
  const graphData = useMemo(() => {
    const testPaths = new Set(testList.map((t) => t.path))
    const allNodeIds = new Set([...rawModules, ...testPaths, ...changedFiles])

    // Build adjacency: source -> targets (source imports target)
    // and reverse adjacency: target -> sources (target is imported by source)
    const outgoing = new Map()
    const incoming = new Map()
    allNodeIds.forEach((id) => {
      outgoing.set(id, new Set())
      incoming.set(id, new Set())
    })

    const edges = []
    const edgeKeySet = new Set()

    rawDependencies.forEach(({ source, target }) => {
      if (allNodeIds.has(source) && allNodeIds.has(target)) {
        const key = `${source}->${target}`
        if (!edgeKeySet.has(key)) {
          edgeKeySet.add(key)
          outgoing.get(source)?.add(target)
          incoming.get(target)?.add(source)
          edges.push({ source, target, key })
        }
      }
    })

    // Also connect tests to their covered modules if not explicitly in dependencies
    testList.forEach((test) => {
      ;(test.modules || []).forEach((mod) => {
        if (allNodeIds.has(mod)) {
          const key = `${test.path}->${mod}`
          if (!edgeKeySet.has(key)) {
            edgeKeySet.add(key)
            outgoing.get(test.path)?.add(mod)
            incoming.get(mod)?.add(test.path)
            edges.push({ source: test.path, target: mod, key, isTestCoverage: true })
          }
        }
      })
    })

    // Cycle detection: identify back-edges in directed dependency graph
    const cycleEdges = new Set()
    const cycleNodes = new Set()
    const visited = new Set()
    const inStack = new Set()

    function dfsCycle(node) {
      visited.add(node)
      inStack.add(node)
      const neighbors = outgoing.get(node) || new Set()
      neighbors.forEach((nbr) => {
        if (inStack.has(nbr)) {
          cycleEdges.add(`${node}->${nbr}`)
          cycleNodes.add(node)
          cycleNodes.add(nbr)
        } else if (!visited.has(nbr)) {
          dfsCycle(nbr)
        }
      })
      inStack.delete(node)
    }

    allNodeIds.forEach((node) => {
      if (!visited.has(node)) dfsCycle(node)
    })

    // BFS Transitive Impact Traversal from changedFiles:
    // When a module changes, impact propagates along reverse edges (to files that import it)
    const impactedNodes = new Set(changedFiles)
    const impactedEdges = new Set()
    const queue = [...changedFiles]
    const bfsSeen = new Set(changedFiles)

    while (queue.length > 0) {
      const current = queue.shift()
      const callers = incoming.get(current) || new Set()
      callers.forEach((caller) => {
        impactedEdges.add(`${caller}->${current}`)
        impactedNodes.add(caller)
        if (!bfsSeen.has(caller)) {
          bfsSeen.add(caller)
          queue.push(caller)
        }
      })
    }

    // Topological Column (Layer) Assignment with cycle tolerance
    const layers = new Map()
    // Tests are on the rightmost layer
    // Leaf modules (imported, but import little) on the left
    function computeLayer(node, depth = 0, path = new Set()) {
      if (path.has(node) || depth > 10) return 0 // cycle break
      if (layers.has(node)) return layers.get(node)
      path.add(node)

      const targets = outgoing.get(node) || new Set()
      let maxChildLayer = -1
      targets.forEach((target) => {
        if (!testPaths.has(target)) {
          const childLayer = computeLayer(target, depth + 1, new Set(path))
          if (childLayer > maxChildLayer) maxChildLayer = childLayer
        }
      })
      const myLayer = maxChildLayer + 1
      layers.set(node, myLayer)
      return myLayer
    }

    allNodeIds.forEach((id) => {
      if (!testPaths.has(id)) computeLayer(id)
    })

    // Find maximum source module layer
    let maxModuleLayer = 0
    layers.forEach((l) => {
      if (l > maxModuleLayer) maxModuleLayer = l
    })

    // Assign tests to the right of all modules
    testPaths.forEach((testPath) => {
      layers.set(testPath, maxModuleLayer + 1)
    })

    // Group nodes by layer
    const layerBuckets = new Map()
    allNodeIds.forEach((id) => {
      const layer = layers.get(id) || 0
      if (!layerBuckets.has(layer)) layerBuckets.set(layer, [])
      layerBuckets.get(layer).push(id)
    })

    // Calculate (x, y) coordinates for each node
    const COL_WIDTH = 250
    const ROW_HEIGHT = 80
    const nodeCoords = new Map()

    const sortedLayers = Array.from(layerBuckets.keys()).sort((a, b) => a - b)
    sortedLayers.forEach((layerIdx) => {
      const bucket = layerBuckets.get(layerIdx) || []
      // Sort: changed first, then impacted, then alphabetical
      bucket.sort((a, b) => {
        const aChanged = changedFiles.includes(a) ? -2 : impactedNodes.has(a) ? -1 : 0
        const bChanged = changedFiles.includes(b) ? -2 : impactedNodes.has(b) ? -1 : 0
        if (aChanged !== bChanged) return aChanged - bChanged
        return a.localeCompare(b)
      })

      const totalH = bucket.length * ROW_HEIGHT
      const startY = Math.max(80, 400 - totalH / 2)

      bucket.forEach((id, rowIdx) => {
        nodeCoords.set(id, {
          x: layerIdx * COL_WIDTH + 80,
          y: startY + rowIdx * ROW_HEIGHT,
        })
      })
    })

    return {
      allNodeIds: Array.from(allNodeIds),
      edges,
      cycleEdges,
      cycleNodes,
      impactedNodes,
      impactedEdges,
      nodeCoords,
      incoming,
      outgoing,
      testPaths,
      sortedLayers,
    }
  }, [rawModules, rawDependencies, testList, changedFiles])

  // Pan and Zoom handlers
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
    setTransform((prev) => ({
      ...prev,
      k: Math.max(0.3, Math.min(2.5, prev.k * zoomFactor)),
    }))
  }, [])

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.node-card, .graph-btn')) return
    setIsPanning(true)
    setStartPan({ x: e.clientX - transform.x, y: e.clientY - transform.y })
  }, [transform.x, transform.y])

  const handleMouseMove = useCallback((e) => {
    if (!isPanning) return
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y,
    }))
  }, [isPanning, startPan.x, startPan.y])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const resetView = useCallback(() => {
    setTransform({ x: 80, y: 120, k: 0.9 })
    setSelectedNode(null)
  }, [])

  const zoomIn = () => setTransform((t) => ({ ...t, k: Math.min(2.5, t.k * 1.2) }))
  const zoomOut = () => setTransform((t) => ({ ...t, k: Math.max(0.3, t.k / 1.2) }))

  const activeFocus = selectedNode || hoveredNode

  return (
    <div
      className="dependency-graph-root"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 60% 30%, #0d1527 0%, #060913 75%)',
        cursor: isPanning ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <defs>
          {/* Subtle background grid pattern */}
          <pattern
            id="graph-grid"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1" fill="#1e293b" opacity="0.6" />
          </pattern>

          {/* Standard dependency arrow marker */}
          <marker
            id="arrow-default"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#334155" />
          </marker>

          {/* Impacted dependency arrow marker (Cyan) */}
          <marker
            id="arrow-impacted"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#38bdf8" />
          </marker>

          {/* Changed module arrow marker (Purple) */}
          <marker
            id="arrow-changed"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#a855f7" />
          </marker>

          {/* Circular dependency arrow marker (Amber) */}
          <marker
            id="arrow-cycle"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#f59e0b" />
          </marker>
        </defs>

        {/* Blueprint background grid */}
        <rect width="100%" height="100%" fill="url(#graph-grid)" />

        {/* Transformed graph viewport */}
        <g
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}
        >
          {/* Layer Headers / Columns */}
          {graphData.sortedLayers.map((layerIdx, idx) => {
            const isTestCol = idx === graphData.sortedLayers.length - 1
            const colX = layerIdx * 250 + 80
            return (
              <g key={layerIdx} opacity={0.65}>
                <line
                  x1={colX + 90}
                  y1={20}
                  x2={colX + 90}
                  y2={850}
                  stroke="#1e293b"
                  strokeDasharray="4 6"
                />
                <text
                  x={colX + 90}
                  y={45}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="11"
                  fontWeight="600"
                  letterSpacing="1"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {isTestCol
                    ? 'CANDIDATE TEST SUITES'
                    : idx === 0
                      ? 'DIRECT SOURCE MODULES'
                      : `TRANSITIVE DEPENDENCIES (L${idx})`}
                </text>
              </g>
            )
          })}

          {/* Directed Edges */}
          {graphData.edges.map((edge) => {
            const srcCoord = graphData.nodeCoords.get(edge.source)
            const tgtCoord = graphData.nodeCoords.get(edge.target)
            if (!srcCoord || !tgtCoord) return null

            // Node card is 180px wide, 48px high
            const startX = srcCoord.x + 90
            const startY = srcCoord.y + 24
            const endX = tgtCoord.x + 90
            const endY = tgtCoord.y + 24

            const isCycle = graphData.cycleEdges.has(edge.key)
            const isImpacted = graphData.impactedEdges.has(edge.key)
            const isConnectedToFocus =
              activeFocus &&
              (edge.source === activeFocus || edge.target === activeFocus)

            // Dynamic edge styling based on pipeline phase and focus
            let strokeColor = '#1e293b'
            let marker = 'url(#arrow-default)'
            let strokeWidth = 1.5
            let strokeDasharray = 'none'
            let opacity = 0.55

            if (isCycle) {
              strokeColor = '#f59e0b'
              marker = 'url(#arrow-cycle)'
              strokeWidth = 2
              strokeDasharray = '4 3'
              opacity = 0.9
            } else if (isImpacted && phase >= 1) {
              strokeColor = '#38bdf8'
              marker = 'url(#arrow-impacted)'
              strokeWidth = 2.4
              strokeDasharray = '6 4'
              opacity = 1
            } else if (isConnectedToFocus) {
              strokeColor = '#94a3b8'
              strokeWidth = 2
              opacity = 0.95
            }

            // Smooth cubic bezier path between nodes
            const dx = Math.abs(endX - startX) * 0.55
            const pathData =
              isCycle && startX === endX
                ? `M ${startX} ${startY} C ${startX + 60} ${startY + 20}, ${endX + 60} ${endY - 20}, ${endX} ${endY}`
                : `M ${startX} ${startY} C ${startX - dx} ${startY}, ${endX + dx} ${endY}, ${endX} ${endY}`

            return (
              <path
                key={edge.key}
                d={pathData}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                opacity={opacity}
                markerEnd={marker}
                style={{
                  transition: 'stroke 0.2s ease, opacity 0.2s ease',
                  animation:
                    isImpacted && phase >= 1
                      ? 'edgeFlow 1.5s linear infinite'
                      : 'none',
                }}
              />
            )
          })}

          {/* Node Cards */}
          {graphData.allNodeIds.map((id) => {
            const coord = graphData.nodeCoords.get(id)
            if (!coord) return null

            const isTest = graphData.testPaths.has(id)
            const isChanged = changedFiles.includes(id)
            const isImpacted = graphData.impactedNodes.has(id)
            const isCycle = graphData.cycleNodes.has(id)

            const testObj = isTest ? testList.find((t) => t.path === id) : null
            const isSelected = testObj?.decision === 'Run'
            const testStatus = testObj?.result?.status || testObj?.status

            const isFocus = activeFocus === id
            const isConnectedToFocus =
              activeFocus &&
              (graphData.incoming.get(activeFocus)?.has(id) ||
                graphData.outgoing.get(activeFocus)?.has(id))

            // Background & Border colors based on Stage
            let bg = '#0d1527'
            let border = '#1e293b'
            let glow = 'none'

            if (isChanged && phase >= 0) {
              border = '#a855f7'
              bg = '#1c1033'
              glow = '0 0 14px rgba(168, 85, 247, 0.35)'
            } else if (isImpacted && phase >= 1) {
              border = '#38bdf8'
              bg = '#0b2038'
              glow = '0 0 12px rgba(56, 189, 248, 0.3)'
            }

            if (isTest) {
              if (phase >= 3) {
                if (isSelected) {
                  border = '#f97316'
                  bg = '#2a1708'
                } else {
                  border = '#334155'
                  bg = '#0f172a'
                }
              }
              if (phase >= 4 && testStatus) {
                if (testStatus === 'PASSED') {
                  border = '#10b981'
                  bg = '#06261c'
                  glow = '0 0 14px rgba(16, 185, 129, 0.3)'
                } else if (['FAILED', 'ERROR'].includes(testStatus)) {
                  border = '#f43f5e'
                  bg = '#2b0c16'
                  glow = '0 0 14px rgba(244, 63, 94, 0.35)'
                }
              }
            }

            if (isFocus) {
              border = '#f8fafc'
              glow = '0 0 20px rgba(248, 250, 252, 0.45)'
            } else if (activeFocus && !isConnectedToFocus) {
              bg = '#090d18'
              border = '#151d30'
            }

            const cardW = 180
            const cardH = isTest ? 54 : 48

            return (
              <g
                key={id}
                className="node-card"
                transform={`translate(${coord.x}, ${coord.y})`}
                onClick={() =>
                  setSelectedNode((prev) => (prev === id ? null : id))
                }
                onMouseEnter={() => setHoveredNode(id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Node Box */}
                <rect
                  width={cardW}
                  height={cardH}
                  rx="8"
                  ry="8"
                  fill={bg}
                  stroke={border}
                  strokeWidth={isFocus || isChanged ? 2 : 1.2}
                  style={{
                    filter: glow !== 'none' ? `drop-shadow(${glow})` : 'none',
                    transition: 'all 0.2s ease',
                  }}
                />

                {/* Node Status Indicator Pill / Dot */}
                <circle
                  cx="14"
                  cy={cardH / 2}
                  r="4.5"
                  fill={
                    isTest
                      ? testStatus === 'PASSED'
                        ? '#10b981'
                        : testStatus === 'FAILED'
                          ? '#f43f5e'
                          : isSelected
                            ? '#f97316'
                            : '#64748b'
                      : isChanged
                        ? '#a855f7'
                        : isImpacted
                          ? '#38bdf8'
                          : '#475569'
                  }
                />

                {/* Node Title (File Name) */}
                <text
                  x="26"
                  y={isTest ? 22 : 24}
                  fill="#f1f5f9"
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {baseName(id)}
                </text>

                {/* Node Subtitle / Meta Tag */}
                <text
                  x="26"
                  y={isTest ? 38 : 37}
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {isTest ? (
                    testStatus ? (
                      `${testStatus} · ${isSelected ? 'Selected' : 'Skipped'}`
                    ) : testObj?.score != null ? (
                      `Score: ${testObj.score.toFixed(3)} · ${testObj.decision || 'Candidate'}`
                    ) : (
                      'Candidate test file'
                    )
                  ) : isChanged ? (
                    'MODIFIED SOURCE'
                  ) : isImpacted ? (
                    'TRANSITIVE IMPACT'
                  ) : isCycle ? (
                    'CIRCULAR IMPORT'
                  ) : (
                    shortName(id)
                  )}
                </text>

                {/* Right Badge for Changed / Impacted / Score */}
                {isChanged && (
                  <g transform={`translate(${cardW - 32}, 8)`}>
                    <rect
                      width="24"
                      height="14"
                      rx="4"
                      fill="#a855f726"
                      stroke="#a855f7"
                      strokeWidth="0.8"
                    />
                    <text
                      x="12"
                      y="10"
                      textAnchor="middle"
                      fill="#d8b4fe"
                      fontSize="8"
                      fontWeight="700"
                    >
                      Δ
                    </text>
                  </g>
                )}

                {isCycle && !isChanged && (
                  <g transform={`translate(${cardW - 32}, 8)`}>
                    <rect
                      width="24"
                      height="14"
                      rx="4"
                      fill="#f59e0b26"
                      stroke="#f59e0b"
                      strokeWidth="0.8"
                    />
                    <text
                      x="12"
                      y="10"
                      textAnchor="middle"
                      fill="#fbbf24"
                      fontSize="8"
                      fontWeight="700"
                    >
                      ↻
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* Floating Canvas Controls */}
      <div
        className="graph-controls"
        style={{
          position: 'fixed',
          top: '100px',
          left: '260px',
          display: 'flex',
          gap: '6px',
          zIndex: 5,
        }}
      >
        <button
          className="btn graph-btn"
          onClick={zoomIn}
          title="Zoom In"
          style={{ padding: '6px 11px', fontSize: '13px' }}
        >
          +
        </button>
        <button
          className="btn graph-btn"
          onClick={zoomOut}
          title="Zoom Out"
          style={{ padding: '6px 11px', fontSize: '13px' }}
        >
          −
        </button>
        <button
          className="btn graph-btn"
          onClick={resetView}
          title="Fit Graph to Center"
          style={{ padding: '6px 11px', fontSize: '12px' }}
        >
          Fit View
        </button>
      </div>

      {/* Active Node Detail Inspector Card */}
      {activeFocus && (
        <div
          className="card graph-inspector"
          style={{
            position: 'fixed',
            top: '200px',
            right: '26px',
            width: '290px',
            zIndex: 10,
            padding: '16px',
            background: '#0d1424fa',
            borderColor: '#1e293b',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span
              className="eyebrow"
              style={{
                color: graphData.testPaths.has(activeFocus)
                  ? '#38bdf8'
                  : changedFiles.includes(activeFocus)
                    ? '#a855f7'
                    : '#94a3b8',
                marginBottom: '4px',
              }}
            >
              {graphData.testPaths.has(activeFocus)
                ? 'TEST SUITE NODE'
                : 'SOURCE MODULE NODE'}
            </span>
            {selectedNode === activeFocus && (
              <button
                onClick={() => setSelectedNode(null)}
                style={{
                  background: 'none',
                  border: 0,
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                Clear
              </button>
            )}
          </div>
          <h3
            style={{
              fontSize: '15px',
              wordBreak: 'break-all',
              marginBottom: '6px',
            }}
          >
            {activeFocus}
          </h3>
          <p
            style={{
              fontSize: '12px',
              color: '#94a3b8',
              lineHeight: 1.4,
              marginBottom: '12px',
            }}
          >
            {changedFiles.includes(activeFocus)
              ? 'Direct code change delta detected. Impact will propagate to callers and candidate tests.'
              : graphData.impactedNodes.has(activeFocus)
                ? 'Transitively impacted by changed files via import dependency chain.'
                : 'Unchanged module. Kept in baseline.'}
          </p>

          <div
            style={{
              fontSize: '11px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              borderTop: '1px solid #1e293b',
              paddingTop: '10px',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>Imports ({graphData.outgoing.get(activeFocus)?.size || 0}): </span>
              <span style={{ color: '#cbd5e1' }}>
                {Array.from(graphData.outgoing.get(activeFocus) || [])
                  .map(baseName)
                  .join(', ') || 'None'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Imported by ({graphData.incoming.get(activeFocus)?.size || 0}): </span>
              <span style={{ color: '#cbd5e1' }}>
                {Array.from(graphData.incoming.get(activeFocus) || [])
                  .map(baseName)
                  .join(', ') || 'None'}
              </span>
            </div>
            {graphData.cycleNodes.has(activeFocus) && (
              <div style={{ color: '#f59e0b', marginTop: '4px' }}>
                ⚠ Participates in a circular dependency cycle.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
