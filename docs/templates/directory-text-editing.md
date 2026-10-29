# Directory text and font controls

All 32 directory HTML layouts share the builder's native inline text editing helper. Click wording to type on the canvas; Enter or blur saves the field, Escape cancels. Plain-text paste preserves text without creating markup. The existing Properties panel always offers a Text area selector and one native input for visible labels, including the top left and top right labels. Building name and the compact location list remain directly editable. No separate settings screen or second font toolbar.

Canvas and Properties selections target the same existing bottom toolbar and `_styles` map. The board reports its real rendered font sizes through the existing source-checked frame bridge so the toolbar starts from the directory's fitted size. Explicit font sizes take precedence over adaptive-fit rules, including WebKit's variable-font-size cascade behavior. Clearing the size returns that field to automatic fitting. Saved styles are reapplied after pagination, changing content and reopening the template.

Private Brookfield copies use these same shared HTML URLs and a separate `directoryDocument`. Updating their rendering/editor requires no customer-row rewrite, dataset replacement or reinstallation. Landscape-source copies adapted to a portrait canvas receive the same behavior.

Regenerate embedded support after changing the helper/runtime:

```sh
node apps/web/scripts/sync-directory-text-edit.cjs
```

The script updates each directory's shared support and the existing installer asset digests; it does not write customer records. The original automatic pages, suite/name sorting, image library controls and rotation settings remain in the same Properties panel.

Verification: 24 focused native-editor/field-bridge/security tests; 64 native-4K editing, explicit font and automatic reset checks across 32 layouts in Chromium/WebKit; eight complete save/reopen builder flows spanning standard and Brookfield-style private documents, including an existing landscape-source 1080×1920 adaptation. Actual Brookfield source bindings were inspected read-only. Production evidence is recorded after deployment; browser save tests use isolated fixtures, not customer writes.
