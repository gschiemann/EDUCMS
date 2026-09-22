# Super Taco three-screen menu wall

The actual signage templates are three 3840 × 2160 HTML boards served by VenueOS. These `.educms-template.json` files are the CMS's portable import format: each creates one editable `EXTERNAL_HTML` template that points at its matching hosted board. The same three designs are registered as Restaurant/QSR system presets, so an operator can also select them directly from the gallery.

| Physical position | Import file | HTML board | Content |
|---|---|---|---|
| Left | `01-tacos.educms-template.json` | `25-super-taco-tacos.html` | Birria, street and super tacos |
| Center | `02-burritos-more.educms-template.json` | `26-super-taco-burritos.html` | Burritos, nachos, quesadillas and drinks |
| Right | `03-combo-spotlight.educms-template.json` | `27-super-taco-combos.html` | Three rotating combination plates |

In **Templates → Import**, import the three JSON files separately. Put each resulting template on its corresponding landscape screen, left to right. The two menu screens hold steady while the right screen advances combinations every eight seconds; that interval is an editable `carousel.intervalSeconds` field on the combo board.

All three boards use the same existing Toast connection for their mapped VenueOS location. In **Settings → POS → Toast**, enter the operator's Toast API endpoint, machine-client ID and secret, then add each store's restaurant GUID and map it to its VenueOS location. The first catalog sync runs on connection. Afterward, a five-minute check of Toast's lightweight menu metadata downloads the full catalog only when a store has published a newer menu; **Sync now** forces an update. Screens check their location's saved menu every 30 seconds. The boards classify incoming items by product name/category, prefer their default products when those are present, and then fill any free slots with other products in the same section. Names, base prices, descriptions, categories and Toast product images update on the boards. A product removed from the published Toast menu is hidden. The combo board rotates up to three available combination plates.

The starter products and prices are preview content from [Super Taco's public Toast ordering menu](https://order.toasttab.com/online/supertaco-calvine) for one location. Verify them before publishing an unconnected board; connected screens use each mapped store's own Toast price. The default logo and food photograph are local copies from [Super Taco's official site](https://www.supertacomex.com/). No Toast credentials are stored in these files.

The current connector polls Toast Menus V2 metadata; it does not claim immediate webhook updates, modifier-dependent prices, or stock/86 status. See [the Toast integration guide](../super-taco-toast.md) for those boundaries. The metadata cadence follows [Toast's guidance for integrations without the menus webhook](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistOrdering.html).
