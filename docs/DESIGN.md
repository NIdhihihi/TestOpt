# TestOpt Design System

## Direction

Follow the four user-supplied HTML references: dashboard, test suite, data city, and run history. Preserve readable status and the real source-upload/approval/execution workflow.

## Existing visual language

- Space Grotesk with a system sans-serif fallback.
- #070b16 background, translucent dark cards, and a 200px sidebar.
- Cyan/green gradient actions and animated wireframe scenery.
- Violet/cyan/amber/orange pipeline stages, green success, pink failure, and amber warnings.
- Responsive test table/detail layouts, selectable comparison charts, and a full-screen Three.js source-module city.

## UX requirements

- Label forms and show clear errors.
- Include loading and empty states.
- Keep layouts responsive.
- Never rely on color alone for status.
- Respect reduced motion. WebGL failure retains the operational interface on a static background.
- Replay changes the visualization only; uploading/replaying never starts execution.
- Use real project versions, test scores, recorded failures, and incomplete-validation counts instead of the references' fabricated commits, churn, flakiness, and missed-failure metrics.
- Label time comparisons as estimates. Use measured durations in result details. Unknown values display a dash; skipped files have no assumed outcome.
- Show unsupported adapters, budget conflicts, missing coverage, and incomplete validation prominently.
- Keep manual catalog/CSV/simulation tools accessible under advanced Settings.
