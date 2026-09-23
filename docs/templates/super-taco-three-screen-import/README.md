# Super Taco three-screen menu wall

The actual signage templates are three responsive HTML boards served by VenueOS. They render natively at 3840 × 2160 in landscape or 2160 × 3840 in portrait, with the same editable fields and Toast product bindings. These `.educms-template.json` files are the CMS's portable import format: each creates one editable `EXTERNAL_HTML` template that points at its matching hosted board. Both orientations are registered as Restaurant/QSR system presets, so an operator can also select them directly from the gallery.

| Physical position | Import file | HTML board | Content |
|---|---|---|---|
| Left | `01-tacos.educms-template.json` | `25-super-taco-tacos.html` | Birria, street and super tacos |
| Center | `02-burritos-more.educms-template.json` | `26-super-taco-burritos.html` | Burritos, nachos, quesadillas and drinks |
| Right | `03-combo-spotlight.educms-template.json` | `27-super-taco-combos.html` | Three rotating combination plates |

In **Templates → Import**, import the three JSON files separately. For portrait screens, use the matching `-portrait.educms-template.json` files. Put each resulting template on its corresponding screen, left to right. The two menu screens hold steady while the right screen advances combinations every eight seconds; that interval is an editable `carousel.intervalSeconds` field on the combo board.

All three boards use Toast as their menu source. In **Settings → POS → Toast**, enter the machine-client ID and secret. The API endpoint defaults to Toast's production endpoint, with an Advanced field if Toast gave you another one. Partner API credentials can discover their accessible stores; choose the stores for this account. Standard restaurant credentials may not permit discovery, in which case the form asks for the restaurant GUID from Toast's API access details. A single store maps automatically to the sole VenueOS location (or main account). Multiple stores map automatically only where location names match uniquely; finish any unmatched rows in the store mapping panel. Mapping a store refreshes its location prices immediately.

The first catalog sync runs on connection. Afterward, a five-minute check of Toast's lightweight menu metadata downloads the full catalog only when a store has published a newer menu; **Sync now** forces an update. Screens check their location's saved menu every 30 seconds. The boards find their starter products by name and fill unused slots with other items in the matching section. In the template builder, **Live menu → Toast products on this screen** shows each slot and lets you bind it to a specific Toast product ID. Explicit bindings survive Toast name changes; a removed or unavailable bound product hides its slot. Names, base prices, descriptions, categories and Toast product images update on the boards. The combo board rotates up to three available combination plates.

The starter products and prices are preview content from [Super Taco's public Toast ordering menu](https://order.toasttab.com/online/supertaco-calvine) for one location. Verify them before publishing an unconnected board; connected screens use each mapped store's own Toast price. The default logo and food photograph are local copies from [Super Taco's official site](https://www.supertacomex.com/). No Toast credentials are stored in these files.

The current connector polls Toast Menus V2 metadata; it does not claim immediate webhook updates, modifier-dependent prices, or stock/86 status. See [the Toast integration guide](../super-taco-toast.md) for those boundaries. The metadata cadence follows [Toast's guidance for integrations without the menus webhook](https://doc.toasttab.com/doc/cookbook/apiIntegrationChecklistOrdering.html).
