# ShopCart demo for TestOpt

1. Create one TestOpt project named ShopCart.
2. Upload the **v1-baseline** folder itself (the folder containing package.json). Prepare the automatic plan and approve it. All six test files should run and pass. Wait for COMPLETED and a ready baseline.
3. In the **same TestOpt project**, upload **v2-refactor**. Only src/discounts.js differs: a behavior-preserving coupon lookup refactor. Prepare a plan. Expected selection: discounts.test.js and checkout.test.js, with four unaffected files skipped. Approve: both should pass.
4. Optional: upload **v3-intentional-bug** to that same project. SAVE10 incorrectly grants 15 percent. The same two affected test files should run and fail, demonstrating real regression detection. This version is deliberately broken.

Do not upload this parent folder or the ZIP directly. If using the ZIP, extract it first. Select each version folder separately. No dependencies need installing.

Each good version contains six source modules and six test files with 22 test cases. Budget settings and evidence can affect planning; use the default 15-minute budget. If a complete passing baseline is unavailable, TestOpt should safely request broader validation rather than skip tests.

To run the example independently: open a terminal in v1-baseline, run `npm test`, then `npm run demo`.
