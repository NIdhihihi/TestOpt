# E-Commerce Microservice (TestOpt Benchmark Sample)

A production-style modular Node.js ES module backend service designed specifically to demonstrate and benchmark **TestOpt Regression Test Selection (RTS)**, dependency graph analysis, and optimization algorithms.

---

## 🏗️ Architecture & Module Dependency Graph

Zero third-party runtime dependencies. Uses native Node.js 20+ ES modules, `node:crypto`, and the native Node test runner (`node:test`, `node:assert/strict`).

```
                    ┌─────────────────────────┐
                    │   src/utils/crypto.js   │ ◀────── test/crypto.test.js
                    └────────────┬────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
┌────────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐
│ src/auth/tokens.js │ │ src/auth/users.js │ │ src/notifications/        │
└──────────┬─────────┘ └─────────┬─────────┘ │ receipts.js               │
           │                     │           └─────────────┬─────────────┘
           ▼                     │                         │
┌───────────────────────────┐    │                         │
│ src/checkout/payments.js  │    │                         │
└──────────┬────────────────┘    │                         │
           │                     │                         │
           └───────────┬─────────┴─────────┐               │
                       ▼                   │               │
┌───────────────────────────┐              │               │
│ src/catalog/inventory.js  │              │               │
└──────────┬────────────────┘              │               │
           │                               │               │
           ▼                               ▼               │
┌───────────────────────────┐    ┌───────────────────┐     │
│     src/cart/cart.js      │───▶│src/checkout/      │     │
└──────────▲────────────────┘    │orders.js          │     │
           │                     └───────────────────┘     │
┌──────────┴────────────────┐                              │
│  src/catalog/pricing.js   │──────────────────────────────┘
└───────────────────────────┘
```

### Module Roles & Test Coverage

| Module | Source Path | Test Suite | Description |
| :--- | :--- | :--- | :--- |
| **Crypto Utils** | `src/utils/crypto.js` | `test/crypto.test.js` | SHA-256 hashing, CSPRNG tokens, and HMAC payload signing/verification. |
| **Auth Tokens** | `src/auth/tokens.js` | `test/tokens.test.js` | Stateless session token issuance and validation. |
| **User Directory** | `src/auth/users.js` | `test/users.test.js` | Customer authentication and credential checking. |
| **Catalog Pricing**| `src/catalog/pricing.js` | `test/pricing.test.js` | Subtotal, multi-tier promo code discounts, and regional sales tax. |
| **Inventory** | `src/catalog/inventory.js` | `test/inventory.test.js` | Multi-SKU warehouse availability, reservation locks, and restocking. |
| **Shopping Cart** | `src/cart/cart.js` | `test/cart.test.js` | State machine for cart items with real-time stock validation and totals. |
| **Payments** | `src/checkout/payments.js` | `test/payments.test.js` | Tokenized payment authorization, idempotency, and audit trails. |
| **Orders** | `src/checkout/orders.js` | `test/orders.test.js` | Full checkout orchestrator linking cart, inventory, payment, and user. |
| **Receipts** | `src/notifications/receipts.js`| `test/receipts.test.js` | Digital order confirmation generator with tamper-proof HMAC signatures. |

---

## ⚡ Standalone Verification

To run all 9 test suites natively in Node without TestOpt:

```bash
cd sample-projects/ecommerce-service
node --test test/*.test.js
```

All 27 subtests across all 9 suites will pass in ~15 milliseconds.

---

## 🧪 How to Verify TestOpt Regression Test Selection (RTS)

### Step 1: Upload the Folder into TestOpt
1. In the TestOpt dashboard, click **"Upload Project"** (or open the project drawer).
2. Point TestOpt to this folder: `sample-projects/ecommerce-service`.
3. TestOpt’s AST parser (`sourceAnalysis.js`) will:
   - Recognize the clean ES module topology.
   - Detect 8 source modules and 9 test suites.
   - Establish the baseline coverage matrix.

---

### Step 2: Test Real-World Scenarios

#### Scenario A: Deep Core Change (High Blast Radius)
- **Action**: Open `src/utils/crypto.js` and modify any hashing constant or logic.
- **Expected TestOpt RTS Behavior**:
  - **Selected Tests**: `test/crypto.test.js`, `test/tokens.test.js`, `test/payments.test.js`, `test/orders.test.js`, `test/receipts.test.js`.
  - **Skipped Tests**: `test/pricing.test.js`, `test/inventory.test.js`.
  - **Skip Reason**: No direct or transitive import edge from `src/utils/crypto.js` to pricing or inventory.
  - **UI Verification**: Look at the 3D graph (causal left-to-right columns) and Table view. Skipped tests clearly show the provenance disclaimer: *"Skipped: No execution result recorded for this commit."*

#### Scenario B: Leaf Feature Change (Targeted Blast Radius)
- **Action**: Open `src/catalog/pricing.js` and change `TAX_RATES.DEFAULT` from `0.05` to `0.07`.
- **Expected TestOpt RTS Behavior**:
  - **Selected Tests**: `test/pricing.test.js`, `test/cart.test.js`, `test/orders.test.js`, `test/receipts.test.js`.
  - **Skipped Tests**: `test/crypto.test.js`, `test/tokens.test.js`, `test/users.test.js`.
  - **Saved Execution Time**: TestOpt computes savings based on the isolated modules.

#### Scenario C: Constrained Time Budget (Optimizer Benchmarking)
- **Action**: In the TestOpt run settings, clamp the `Time Budget` to `50%` or `15ms`.
- **Expected TestOpt RTS Behavior**:
  - The optimizer activates **Knapsack 0/1 Dynamic Programming** or **Greedy Heap**.
  - Tests are ranked by:
    $$\text{Value} = 0.35 \times \text{Relevance} + 0.25 \times \text{Criticality} + 0.15 \times \text{FailureRate} + 0.25 \times \text{Coverage}$$
  - The Table View and 3D HUD expose the exact 4-factor math, showing why a high-criticality checkout test is selected over a low-criticality peripheral test when budget is tight.

---

## 🎨 Verifying the Multi-View Pipeline UI

In the TestOpt dashboard, toggle between the three visualization modes in the top toolbar:

1. **🧊 3D Pipeline Graph**:
   - Depth-layered topological columns ($X_0$: Changed Modules $\to X_1$: First-degree Callers $\to \dots \to X_n$: Unaffected).
   - Constrained 2.5D orbit (no upside-down disorientation, zero idle GPU burn).
   - Click any node or edge to inspect provenance in the HUD sidebar.
2. **🔀 2D Flow DAG**:
   - Clean SVG topological DAG for bird's-eye architectural overviews.
3. **📋 Table View**:
   - Full keyboard accessibility and text search.
   - Distinct badges separating `REGRESSION TEST FAILURE` from `INFRA ERROR`.
   - Complete execution evidence, factor breakdown, and foldable test logs.

