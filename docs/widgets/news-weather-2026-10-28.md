# Newsroom and forecast customization

Newsroom is a new look inside the existing News/RSS widget. Forecast customization extends the existing weather outlook. Both use the template builder’s current properties rail, floating text toolbar, resizing, and save/reopen transport. Existing widget variants retain their behavior.

## Editing

- Newsroom: choose Front Page, Broadcast, The Briefing, Headline Ribbon, or Scrolling Banner. Choose local ZIP/city, Local/National/International coverage, and multiple publishers. Leave sources unchecked for automatic variety. Select headline timing or banner speed; Appearance contains colors, background opacity, and text scale. Select a heading or headline for the existing font toolbar. Feed headline wording remains publisher supplied.
- Forecast: choose 2–5 days and Auto, Cards, Clean overlay, Horizontal strip, or Stacked list. Transparent background removes both the widget surface and day-card surfaces without fading text. Colors & fonts controls typography, high/low/detail/icon colors, and separate background/card opacities. Layout and typography persist when reopening a saved template.

## Live data and recovery

Forecast continues to use the existing NWS-backed forecast endpoint; no weather service migration is included.

News uses GDELT headline/link metadata with publisher credits. Search requests are shared across screens and locations where possible, coalesced, paced with a completion-relative gap, cached for ten minutes, and cooled down after rate limits. Last-good search results expire after one hour; their original fetched timestamp is retained and the widget shows Updates delayed.

When search is unavailable and no recent saved edition exists, the API uses GDELT’s official rolling article-index RSS feed, shared and cached for five minutes. It applies the selected publisher filters, matches the local city in headline text, and uses known English sections of multilingual outlets. This recent index covers a rolling fifteen-minute window and can have no matching local or selected-publisher stories. The widget reports Limited coverage instead of inventing stories or relabeling other cities’ headlines. This is a free indexed-news service, with variable coverage and upstream availability, rather than a guaranteed breaking-news wire.

No article bodies, publisher photographs or logos are copied. Metadata links keep their publisher origins. The data service does not grant rights to reuse article photographs.

Sources:
- https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- https://blog.gdeltproject.org/announcing-the-gdelt-article-list-rss-feed/
- https://gdeltproject.org/about.html#termsofuse

## Release scope

The PR explicitly reverses PR177’s Array.at polyfill and preserves the production rollback. It includes a small directory editor correction: automatic title fitting runs after saved font overrides have finished clearing. That path only runs when text styles change in the editor. Posters were recaptured for all 32 documents, with current source provenance.

No Android APK, player baseline, emergency handling, assigned playlist, customer content, or device cache is changed. This release does not resolve or hardware-qualify the G24/FUH incident.

## Validation

Local verification: production API/web preflight; targeted feed/parser and widget unit tests; eight native save/reopen editor flows across Chromium and WebKit in 4K landscape and portrait; 64 directory image and adaptive orientation cases, 32 direction/motion cases, and two title-reset cases; CSS, inset serialization, Taurus, widget-truth and poster provenance guards. GitHub CI and production smoke checks remain release gates.
