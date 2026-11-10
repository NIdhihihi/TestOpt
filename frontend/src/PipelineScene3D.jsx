import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

// Color palette encoding actual pipeline states
const PALETTE = {
  neutral: new THREE.Color(0x64748b), // Slate neutral
  changed: new THREE.Color(0x8b5cf6), // Violet / changed module
  impacted: new THREE.Color(0x38bdf8), // Sky blue / direct or transitive dependent
  highVal: new THREE.Color(0xf59e0b),  // Amber / high score or criticality
  lowVal: new THREE.Color(0x3b82f6),   // Blue / moderate score
  selected: new THREE.Color(0x10b981), // Emerald green / selected for execution
  failed: new THREE.Color(0xf43f5e),   // Rose red / regression failure caught
  dimmed: new THREE.Color(0x1e293b),   // Deep slate / dimmed in place
  edgeDefault: new THREE.Color(0x1e293b),
  edgeActive: new THREE.Color(0x38bdf8),
  white: new THREE.Color(0xffffff),
}

// Canonical 2.5D Isometric Camera Angle
const CANONICAL_VIEW = {
  theta: 0.28,  // Azimuth angle (~16 deg, preserves clear left-to-right flow)
  phi: 1.02,    // Elevation / polar angle (~58 deg, comfortable isometric perspective)
  r: 82,        // Camera distance from target
  tx: 0,
  ty: 3,
  tz: 0,
}

export default function PipelineScene3D({
  layout,
  phase = 0,
  paused = false,
  selectedId = null,
  activeFocus = null,
  onSelectNode,
  onResetView,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const tipRef = useRef(null)

  const [zoomPercent, setZoomPercent] = useState(100)

  // Camera target and smoothed current state
  const OtRef = useRef({ ...CANONICAL_VIEW })
  const ORef = useRef({ ...CANONICAL_VIEW })

  // Keep track of interaction / dirty state for on-demand rendering
  const isDirtyRef = useRef(true)
  const activePointersRef = useRef(new Map())
  const downRef = useRef(null)
  const pinchRef = useRef(0)
  const stageClockRef = useRef(0)
  const requestFrameRef = useRef(null)

  // Request a render tick (wake up loop when dirty)
  const requestRender = useCallback(() => {
    isDirtyRef.current = true
  }, [])

  // Smooth reset to the canonical 2.5D isometric view
  const resetCamera = useCallback(() => {
    OtRef.current = { ...CANONICAL_VIEW }
    requestRender()
    if (onResetView) onResetView()
  }, [requestRender, onResetView])

  const zoomIn = useCallback(() => {
    OtRef.current.r = clamp(OtRef.current.r / 1.2, 28, 150)
    requestRender()
  }, [requestRender])

  const zoomOut = useCallback(() => {
    OtRef.current.r = clamp(OtRef.current.r * 1.2, 28, 150)
    requestRender()
  }, [requestRender])

  // Center camera on a specific node or hub
  useEffect(() => {
    if (!activeFocus || !layout) return
    const targetHub = layout.hubs[activeFocus]
    const targetNode = layout.nodes.find((n) => n.id === activeFocus)
    const target = targetHub || targetNode
    if (target) {
      OtRef.current.tx = target.x
      OtRef.current.ty = target.y
      OtRef.current.tz = target.z
      OtRef.current.r = targetHub ? 42 : 32
      requestRender()
    }
  }, [activeFocus, layout, requestRender])

  // Main Three.js Scene Setup & Lifecycle
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas || !layout) return

    // 1. Renderer setup
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15

    // 2. Scene & Camera
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x0a0f1e, 90, 250)

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.5,
      400
    )

    // 3. Lighting
    const hemiLight = new THREE.HemisphereLight(0xaab6ff, 0x151a38, 0.75)
    scene.add(hemiLight)

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.1)
    sunLight.position.set(35, 65, 25)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(2048, 2048)
    const sc = sunLight.shadow.camera
    sc.left = -70
    sc.right = 70
    sc.top = 70
    sc.bottom = -70
    sc.near = 10
    sc.far = 170
    sunLight.shadow.bias = -0.0006
    scene.add(sunLight)

    const rimLight = new THREE.DirectionalLight(0x7b8cff, 0.45)
    rimLight.position.set(-45, 30, -30)
    scene.add(rimLight)

    // 4. Ground Light Pool & Shadow Plane
    const groundPoolCanvas = document.createElement('canvas')
    groundPoolCanvas.width = groundPoolCanvas.height = 512
    const ctx = groundPoolCanvas.getContext('2d')
    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
    grad.addColorStop(0, 'rgba(48, 60, 130, 0.45)')
    grad.addColorStop(0.55, 'rgba(26, 34, 82, 0.22)')
    grad.addColorStop(1, 'rgba(10, 15, 40, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 512, 512)

    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(groundPoolCanvas),
        transparent: true,
        depthWrite: false,
      })
    )
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.position.set(0, -0.02, 0)
    scene.add(groundMesh)

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.ShadowMaterial({ opacity: 0.45 })
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.set(0, 0.04, 0)
    shadowPlane.receiveShadow = true
    scene.add(shadowPlane)

    // Additive glow texture for selected & running halos
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = glowCanvas.height = 64
    const gctx = glowCanvas.getContext('2d')
    const ggrad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    ggrad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    ggrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)')
    ggrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    gctx.fillStyle = ggrad
    gctx.fillRect(0, 0, 64, 64)
    const glowTex = new THREE.CanvasTexture(glowCanvas)

    // 5. Geometries & Materials Cache
    const sphereG = new THREE.SphereGeometry(1, 20, 16)
    const hubG = new THREE.SphereGeometry(1, 32, 24)

    const createPhysMat = (colorHex, emissiveIntensity = 0.2) =>
      new THREE.MeshPhysicalMaterial({
        color: colorHex,
        roughness: 0.35,
        metalness: 0.08,
        clearcoat: 0.5,
        clearcoatRoughness: 0.3,
        emissive: colorHex,
        emissiveIntensity,
        transparent: true,
        opacity: 1,
      })

    // 6. Build Hub Meshes (Modules)
    const hubMeshMap = new Map()
    const pickables = []

    layout.hubList.forEach((hub) => {
      const hubMat = createPhysMat(hub.isChanged ? 0x8b5cf6 : 0x38bdf8, 0.25)
      const hubMesh = new THREE.Mesh(hubG, hubMat)
      hubMesh.scale.setScalar(hub.radius * 0.45)
      hubMesh.position.set(hub.x, hub.y, hub.z)
      hubMesh.castShadow = true
      hubMesh.userData = { type: 'hub', o: hub }
      scene.add(hubMesh)
      pickables.push(hubMesh)

      // Orbit ring around hub
      const ringMat = new THREE.MeshBasicMaterial({
        color: hub.isChanged ? 0x8b5cf6 : 0x243052,
        transparent: true,
        opacity: 0.8,
      })
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(hub.radius * 0.75, 0.06, 8, 48),
        ringMat
      )
      ring.rotation.x = Math.PI / 2
      ring.position.set(hub.x, hub.y, hub.z)
      scene.add(ring)

      // Circular pedestal on ground
      const platMat = new THREE.MeshStandardMaterial({
        color: 0x141c3e,
        roughness: 0.85,
        transparent: true,
        opacity: 0.8,
      })
      const plat = new THREE.Mesh(
        new THREE.CircleGeometry(hub.radius + 1.2, 48),
        platMat
      )
      plat.rotation.x = -Math.PI / 2
      plat.position.set(hub.x, 0.06, hub.z)
      plat.receiveShadow = true
      scene.add(plat)

      // Vertical pedestal stem connecting ground to elevated hub
      const stemMat = new THREE.MeshBasicMaterial({
        color: 0x243052,
        transparent: true,
        opacity: 0.65,
      })
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, hub.y, 6),
        stemMat
      )
      stem.position.set(hub.x, hub.y / 2, hub.z)
      scene.add(stem)

      hubMeshMap.set(hub.id, { hub, mesh: hubMesh, ring, plat, stem })
    })

    // 7. Build Node Meshes (Tests)
    const nodeMeshMap = new Map()
    layout.nodes.forEach((node) => {
      const nodeMat = createPhysMat(0x64748b, 0.15)
      const nodeMesh = new THREE.Mesh(sphereG, nodeMat)
      nodeMesh.scale.setScalar(node.radius)
      nodeMesh.position.set(node.x, node.y, node.z)
      nodeMesh.castShadow = true
      nodeMesh.userData = { type: 'test', o: node }
      scene.add(nodeMesh)
      pickables.push(nodeMesh)

      // Additive glow halo sprite
      const haloMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0x10b981,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
      const halo = new THREE.Sprite(haloMat)
      halo.position.set(node.x, node.y, node.z)
      scene.add(halo)

      nodeMeshMap.set(node.id, {
        node,
        mesh: nodeMesh,
        halo,
        currentColor: new THREE.Color(0x64748b),
        targetColor: new THREE.Color(0x64748b),
        emissive: 0.15,
        opacity: 1,
        haloOpacity: 0,
      })
    })

    // 8. Connect Tests to their Parent Hub via LineSegments
    const lineCount = layout.nodes.length + layout.crossLinks.length
    const linePositions = new Float32Array(lineCount * 6)
    const lineColors = new Float32Array(lineCount * 6)

    layout.nodes.forEach((n, idx) => {
      const hub = layout.hubs[n.hubId]
      if (hub) {
        linePositions[idx * 6] = hub.x
        linePositions[idx * 6 + 1] = hub.y
        linePositions[idx * 6 + 2] = hub.z
        linePositions[idx * 6 + 3] = n.x
        linePositions[idx * 6 + 4] = n.y
        linePositions[idx * 6 + 5] = n.z
      }
    })

    layout.crossLinks.forEach((cl, cIdx) => {
      const idx = layout.nodes.length + cIdx
      linePositions[idx * 6] = cl.from.x
      linePositions[idx * 6 + 1] = cl.from.y
      linePositions[idx * 6 + 2] = cl.from.z
      linePositions[idx * 6 + 3] = cl.to.x
      linePositions[idx * 6 + 4] = cl.to.y
      linePositions[idx * 6 + 5] = cl.to.z
    })

    const lineGeom = new THREE.BufferGeometry()
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
    lineGeom.setAttribute('color', new THREE.BufferAttribute(lineColors, 3))
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
    })
    const lineSegmentsMesh = new THREE.LineSegments(lineGeom, lineMat)
    scene.add(lineSegmentsMesh)

    // 9. Directed Dependency Bezier Tubes Between Hubs
    const edgeObjects = layout.edges.map((edge) => {
      const p0 = new THREE.Vector3(edge.p0.x, edge.p0.y, edge.p0.z)
      const p1 = new THREE.Vector3(edge.p1.x, edge.p1.y, edge.p1.z)
      const p2 = new THREE.Vector3(edge.p2.x, edge.p2.y, edge.p2.z)

      const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2)
      const tubeGeom = new THREE.TubeGeometry(curve, 28, 0.08, 6)
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0x243052,
        transparent: true,
        opacity: 0.85,
      })
      const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat)
      scene.add(tubeMesh)

      // Photon pulse travelling along the tube during stage 1 (Impact Analysis)
      const pulseMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      )
      pulseMesh.visible = false
      scene.add(pulseMesh)

      return { edge, curve, tubeMesh, pulseMesh }
    })

    // 10. Selected Node Focus Ring
    const selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    )
    selectionRing.visible = false
    scene.add(selectionRing)

    // Raycasting & Pointer Interaction
    const raycaster = new THREE.Raycaster()
    const mouseCoord = new THREE.Vector2()
    const tip = tipRef.current

    function getHit(clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      mouseCoord.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(mouseCoord, camera)
      const hits = raycaster.intersectObjects(pickables, false)
      return hits.length > 0 ? hits[0].object.userData.o : null
    }

    const onPointerDown = (e) => {
      canvas.setPointerCapture(e.pointerId)
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      downRef.current = { x: e.clientX, y: e.clientY, moved: 0 }
      canvas.classList.add('grabbing')
      isDirtyRef.current = true

      if (activePointersRef.current.size === 2) {
        const pts = [...activePointersRef.current.values()]
        pinchRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      }
    }

    const onPointerMove = (e) => {
      const p = activePointersRef.current.get(e.pointerId)
      if (p) {
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        p.x = e.clientX
        p.y = e.clientY
        if (downRef.current) {
          downRef.current.moved += Math.abs(dx) + Math.abs(dy)
        }

        // Two-finger pinch to zoom
        if (activePointersRef.current.size === 2) {
          const pts = [...activePointersRef.current.values()]
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          if (pinchRef.current > 0) {
            OtRef.current.r = clamp(
              (OtRef.current.r * pinchRef.current) / dist,
              28,
              150
            )
          }
          pinchRef.current = dist
        }
        // Right-click or Shift-drag to pan
        else if (e.buttons === 2 || e.shiftKey) {
          const s = OtRef.current.r * 0.0016
          const cosT = Math.cos(OtRef.current.theta)
          const sinT = Math.sin(OtRef.current.theta)
          OtRef.current.tx += -cosT * dx * s - sinT * dy * s
          OtRef.current.tz += sinT * dx * s - cosT * dy * s
        }
        // Left-click orbit (constrained to preserve left-to-right causal pipeline)
        else {
          OtRef.current.theta = clamp(
            OtRef.current.theta - dx * 0.005,
            -0.6, // Clamped azimuth: cannot flip behind
            0.9
          )
          OtRef.current.phi = clamp(
            OtRef.current.phi - dy * 0.005,
            0.4, // Clamped polar: cannot view from bottom
            1.25
          )
        }
        isDirtyRef.current = true
      } else {
        // Hover inspection
        const hitObj = getHit(e.clientX, e.clientY)
        if (hitObj && tip) {
          const rect = canvas.getBoundingClientRect()
          tip.style.display = 'block'
          tip.style.left = `${e.clientX - rect.left + 14}px`
          tip.style.top = `${e.clientY - rect.top + 14}px`
          tip.textContent = hitObj.testCount !== undefined
            ? `${hitObj.name} · ${hitObj.testCount} tests`
            : `${hitObj.name} · score ${hitObj.score != null ? hitObj.score.toFixed(2) : '—'}`
          canvas.style.cursor = 'pointer'
        } else if (tip) {
          tip.style.display = 'none'
          canvas.style.cursor = 'grab'
        }
      }
    }

    const onPointerUp = (e) => {
      activePointersRef.current.delete(e.pointerId)
      pinchRef.current = 0
      canvas.classList.remove('grabbing')

      if (downRef.current && downRef.current.moved < 6) {
        const hitObj = getHit(e.clientX, e.clientY)
        if (onSelectNode) onSelectNode(hitObj)
      }
      downRef.current = null
      isDirtyRef.current = true
    }

    const onWheel = (e) => {
      e.preventDefault()
      OtRef.current.r = clamp(
        OtRef.current.r * Math.exp(e.deltaY * 0.0012),
        28,
        150
      )
      isDirtyRef.current = true
    }

    const onContextMenu = (e) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)

    // Resize observer
    const resize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      isDirtyRef.current = true
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    // Tab visibility handling (freeze rendering on tab background)
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (requestFrameRef.current) {
          cancelAnimationFrame(requestFrameRef.current)
          requestFrameRef.current = null
        }
      } else {
        isDirtyRef.current = true
        renderLoop()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Main Render Loop (Render-on-demand)
    let lastTime = performance.now()

    function renderLoop() {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      if (!paused) {
        stageClockRef.current += dt
      }

      // Camera smooth interpolation
      const Ot = OtRef.current
      const O = ORef.current
      const camLerp = 1 - Math.exp(-dt * 9)
      const dDist = Math.abs(Ot.r - O.r)
      const dTheta = Math.abs(Ot.theta - O.theta)
      const dPhi = Math.abs(Ot.phi - O.phi)
      const dTarget = Math.hypot(Ot.tx - O.tx, Ot.ty - O.ty, Ot.tz - O.tz)

      // If camera is still moving or animation active, mark dirty
      if (dDist > 0.01 || dTheta > 0.001 || dPhi > 0.001 || dTarget > 0.01) {
        isDirtyRef.current = true
        for (const p in O) {
          O[p] += (Ot[p] - O[p]) * camLerp
        }
        setZoomPercent(Math.round((CANONICAL_VIEW.r / O.r) * 100))
      }

      const sinPhi = Math.sin(O.phi)
      camera.position.set(
        O.tx + O.r * sinPhi * Math.sin(O.theta),
        O.ty + O.r * Math.cos(O.phi),
        O.tz + O.r * sinPhi * Math.cos(O.theta)
      )
      camera.lookAt(O.tx, O.ty, O.tz)

      // Stage-specific Visual Targets (Determined purely by RTS phase)
      const kLerp = 1 - Math.exp(-dt * 7)
      const tmpCol = new THREE.Color()

      nodeMeshMap.forEach(({ node, mesh, halo, currentColor }, id) => {
        let tCol
        let tEm = 0.15
        let tOp = 1
        let tHalo = 0

        // Stage 0: Code change
        if (phase === 0) {
          tCol = PALETTE.neutral
          tOp = 0.8
        }
        // Stage 1: Impact analysis
        else if (phase === 1) {
          if (node.isLinked) {
            tCol = PALETTE.impacted
            tEm = 0.55
            tHalo = 0.25
          } else {
            tCol = PALETTE.dimmed
            tOp = 0.35
            tEm = 0.02
          }
        }
        // Stage 2: Test valuation
        else if (phase === 2) {
          if (!node.isLinked) {
            tCol = PALETTE.dimmed
            tOp = 0.3
          } else {
            tCol = (node.score ?? 0.5) >= 0.5 ? PALETTE.highVal : PALETTE.lowVal
            tEm = 0.65
            tHalo = 0.3
          }
        }
        // Stage 3: Test selection
        else if (phase === 3) {
          if (node.isSelected) {
            tCol = PALETTE.selected
            tEm = 0.95
            tHalo = 0.65
            tOp = 1
          } else {
            // DIM IN PLACE: Test was evaluated but bypassed under budget
            tCol = PALETTE.dimmed
            tOp = 0.3
            tEm = 0.02
          }
        }
        // Stage 4: Execution
        else if (phase === 4) {
          if (!node.isSelected) {
            tCol = PALETTE.dimmed
            tOp = 0.25
          } else if (node.isFailed) {
            tCol = PALETTE.failed
            tEm = 1.1
            tHalo = 0.8
          } else {
            tCol = PALETTE.selected
            tEm = 0.85
            tHalo = 0.5
          }
        }
        // Stage 5: Report
        else {
          if (!node.isSelected) {
            tCol = PALETTE.dimmed
            tOp = 0.25
          } else if (node.isFailed) {
            tCol = PALETTE.failed
            tEm = 0.9
            tHalo = 0.7
          } else {
            tCol = PALETTE.selected
            tEm = 0.7
            tHalo = 0.4
          }
        }

        currentColor.lerp(tCol, kLerp)
        mesh.material.color.copy(currentColor)
        mesh.material.emissive.copy(currentColor)
        mesh.material.emissiveIntensity = tEm
        mesh.material.opacity = tOp

        halo.material.color.copy(currentColor)
        halo.material.opacity = tHalo
        halo.scale.setScalar(node.radius * 6.5)

        // Update connecting line segments color
        const nIdx = layout.nodes.findIndex((n) => n.id === id)
        if (nIdx !== -1) {
          tmpCol.copy(currentColor).multiplyScalar(tOp < 0.5 ? 0.12 : 0.4)
          lineColors[nIdx * 6] = lineColors[nIdx * 6 + 3] = tmpCol.r
          lineColors[nIdx * 6 + 1] = lineColors[nIdx * 6 + 4] = tmpCol.g
          lineColors[nIdx * 6 + 2] = lineColors[nIdx * 6 + 5] = tmpCol.b
        }
      })
      lineGeom.attributes.color.needsUpdate = true

      // Update Hub Visuals
      hubMeshMap.forEach(({ hub, mesh, ring }) => {
        let hCol = hub.isChanged ? PALETTE.changed : hub.isAffected ? PALETTE.impacted : PALETTE.neutral
        let hEm = hub.isChanged && phase === 0
          ? 0.35 + 0.2 * Math.sin(stageClockRef.current * 4)
          : 0.25

        mesh.material.color.lerp(hCol, kLerp)
        mesh.material.emissive.lerp(hCol, kLerp)
        mesh.material.emissiveIntensity = hEm
        ring.material.color.lerp(hCol, kLerp)
      })

      // Update Bezier Edges & Traveling Photons
      edgeObjects.forEach(({ edge, curve, tubeMesh, pulseMesh }) => {
        const isActive = phase >= 1 && edge.isImpacted
        tubeMesh.material.color.lerp(isActive ? PALETTE.edgeActive : PALETTE.edgeDefault, kLerp)

        if (phase === 1 && edge.isImpacted && !paused) {
          pulseMesh.visible = true
          const tPulse = (stageClockRef.current * 0.75) % 1.0
          curve.getPoint(tPulse, pulseMesh.position)
          isDirtyRef.current = true
        } else {
          pulseMesh.visible = false
        }
      })

      // Update Focus Ring Position on Selected Element
      if (selectedId) {
        const selObj = layout.hubs[selectedId] || layout.nodes.find((n) => n.id === selectedId)
        if (selObj) {
          selectionRing.visible = true
          selectionRing.position.set(selObj.x, selObj.y, selObj.z)
          const ringScale = selObj.testCount !== undefined ? selObj.radius * 0.9 : 0.8
          selectionRing.scale.setScalar(ringScale)
          selectionRing.lookAt(camera.position)
        } else {
          selectionRing.visible = false
        }
      } else {
        selectionRing.visible = false
      }

      // Render Three.js frame
      renderer.render(scene, camera)

      // If active transitions or pulses are ongoing, keep loop alive
      if (!paused && (phase === 1 || phase === 0)) {
        isDirtyRef.current = true
      }

      if (isDirtyRef.current) {
        requestFrameRef.current = requestAnimationFrame(renderLoop)
      } else {
        requestFrameRef.current = null
      }
    }

    // Start loop
    isDirtyRef.current = true
    renderLoop()

    // Cleanup on unmount
    return () => {
      if (requestFrameRef.current) {
        cancelAnimationFrame(requestFrameRef.current)
      }
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)

      renderer.dispose()
      sphereG.dispose()
      hubG.dispose()
      lineGeom.dispose()
      glowTex.dispose()
    }
  }, [layout, phase, paused, selectedId, onSelectNode])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '540px',
        overflow: 'hidden',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'radial-gradient(ellipse at 55% 25%, #182247 0%, #0c1228 55%, #050814 100%)',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'grab',
        }}
        aria-label="3D pipeline architecture graph. Drag to rotate, scroll to zoom."
      />

      {/* Floating Canvas Controls: Reset View & Zoom */}
      <div
        style={{
          position: 'absolute',
          right: '16px',
          bottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          background: 'rgba(14, 20, 42, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '10px',
          backdropFilter: 'blur(8px)',
          zIndex: 5,
        }}
      >
        <button
          className="btn"
          onClick={resetCamera}
          title="Reset to canonical 2.5D view"
          style={{ padding: '4px 8px', fontSize: '12px' }}
        >
          Reset view
        </button>
        <button
          className="btn"
          onClick={zoomOut}
          title="Zoom out"
          style={{ padding: '4px 8px', fontSize: '13px' }}
        >
          −
        </button>
        <span
          style={{
            minWidth: '42px',
            textAlign: 'center',
            fontSize: '12px',
            color: '#94a3b8',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {zoomPercent}%
        </span>
        <button
          className="btn"
          onClick={zoomIn}
          title="Zoom in"
          style={{ padding: '4px 8px', fontSize: '13px' }}
        >
          +
        </button>
      </div>

      {/* Hover tooltip */}
      <div
        ref={tipRef}
        style={{
          position: 'absolute',
          display: 'none',
          pointerEvents: 'none',
          background: 'rgba(8, 12, 28, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '8px',
          padding: '5px 9px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 10,
          color: '#f8fafc',
          boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  )
}

